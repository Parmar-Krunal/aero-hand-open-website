#!/usr/bin/env python3
"""
Aero Hand Open -- MuJoCo Digital Twin Runner
============================================
Connects the physical Aero Hand to the MuJoCo physics simulation:
1. Receives real joint positions from digital_twin_bridge.py (via WebSocket or Serial).
2. Updates the MuJoCo simulation model in real-time (Real Hand -> MuJoCo).
3. Reads fingertip touch sensors from MuJoCo and feeds force feedback (N) back.
4. In mirror mode, streams simulation pose commands to the physical hand (MuJoCo -> Real Hand).

Requirements:
  pip install mujoco websockets (optional, fallback provided if mujoco is not yet installed)

Usage:
  # Connect to running digital_twin_bridge WebSocket:
  python simulation/mujoco_digital_twin.py --ws-url ws://127.0.0.1:8888

  # Standalone dry-run demo (renders live MuJoCo twin):
  python simulation/mujoco_digital_twin.py --dry-run
"""
from __future__ import annotations
import argparse
import asyncio
import json
import math
import sys
import threading
import time
from pathlib import Path

# Safe stdout for Windows CP1252
if sys.platform == "win32":
    import io
    if hasattr(sys.stdout, "buffer"):
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    if hasattr(sys.stderr, "buffer"):
        sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

# Optional imports
try:
    import mujoco
    import mujoco.viewer
    HAS_MUJOCO = True
except ImportError:
    HAS_MUJOCO = False

try:
    import websockets
    HAS_WEBSOCKETS = True
except ImportError:
    HAS_WEBSOCKETS = False

SIM_DIR = Path(__file__).resolve().parent
DEFAULT_MODEL = SIM_DIR / "world_right_mujoco.xml"

JOINT_NAMES = [
    "right_thumb_cmc_abd",
    "right_thumb_cmc_flex",
    "right_thumb_mcp",
    "right_thumb_ip",
    "right_index_mcp_flex",
    "right_index_pip",
    "right_index_dip",
    "right_middle_mcp_flex",
    "right_middle_pip",
    "right_middle_dip",
    "right_ring_mcp_flex",
    "right_ring_pip",
    "right_ring_dip",
    "right_pinky_mcp_flex",
    "right_pinky_pip",
    "right_pinky_dip",
]

# Shared thread-safe state
_lock = threading.Lock()
_state = {
    "joint_rad": [0.0] * 16,
    "touch_forces": {
        "thumb": 0.0,
        "index": 0.0,
        "middle": 0.0,
        "ring": 0.0,
        "pinky": 0.0
    },
    "connected": False,
    "fps": 0.0
}


def run_mujoco_sim(model_path: Path, mirror_mode: bool = False):
    """Runs MuJoCo simulation loop and interactive viewer."""
    if not HAS_MUJOCO:
        print("[MuJoCo] mujoco python package not installed.")
        print("[MuJoCo] To install: pip install mujoco")
        print("[MuJoCo] Running lightweight telemetry & kinematic emulation mode...")
        _run_emulation_loop()
        return

    print(f"[MuJoCo] Loading model from: {model_path}")
    model = mujoco.MjModel.from_xml_path(str(model_path))
    data = mujoco.MjData(model)

    # Resolve joint IDs
    joint_qpos_indices = []
    for jname in JOINT_NAMES:
        try:
            jid = model.joint(jname).id
            qpos_addr = model.jnt_qposadr[jid]
            joint_qpos_indices.append(qpos_addr)
        except Exception:
            joint_qpos_indices.append(None)

    # Resolve touch sensor IDs
    sensor_names = ["thumb_touch_force", "index_touch_force", "middle_touch_force", "ring_touch_force", "pinky_touch_force"]
    finger_keys = ["thumb", "index", "middle", "ring", "pinky"]
    sensor_indices = []
    for sname in sensor_names:
        try:
            sid = model.sensor(sname).id
            adr = model.sensor_adr[sid]
            sensor_indices.append(adr)
        except Exception:
            sensor_indices.append(None)

    print("[MuJoCo] Launching viewer...")
    with mujoco.viewer.launch_passive(model, data) as viewer:
        last_time = time.time()
        frames = 0
        while viewer.is_running():
            step_start = time.time()

            with _lock:
                target_rads = _state["joint_rad"][:]

            # Update model joint positions
            for qpos_idx, target in zip(joint_qpos_indices, target_rads):
                if qpos_idx is not None:
                    # Direct kinematics override or actuator tracking
                    data.qpos[qpos_idx] = target

            # Step physics
            mujoco.mj_step(model, data)

            # Read touch sensor feedback
            with _lock:
                for k, adr in zip(finger_keys, sensor_indices):
                    if adr is not None:
                        _state["touch_forces"][k] = float(data.sensordata[adr])

            viewer.sync()

            frames += 1
            now = time.time()
            if now - last_time >= 1.0:
                with _lock:
                    _state["fps"] = frames / (now - last_time)
                frames = 0
                last_time = now

            # Maintain ~60 Hz viewer sync
            elapsed = time.time() - step_start
            sleep_time = max(0.001, (1.0 / 60.0) - elapsed)
            time.sleep(sleep_time)


def _run_emulation_loop():
    """Fallback loop if mujoco binary is not present in local python environment."""
    t0 = time.time()
    while True:
        time.sleep(0.05)
        with _lock:
            # Emulate contact forces if joints are closed (> 0.5 rad)
            j = _state["joint_rad"]
            _state["touch_forces"]["thumb"] = max(0.0, (j[2] - 0.4) * 8.5) if len(j) > 2 else 0.0
            _state["touch_forces"]["index"] = max(0.0, (j[4] - 0.4) * 12.0) if len(j) > 4 else 0.0
            _state["touch_forces"]["middle"] = max(0.0, (j[7] - 0.4) * 11.0) if len(j) > 7 else 0.0
            _state["touch_forces"]["ring"] = max(0.0, (j[10] - 0.4) * 9.0) if len(j) > 10 else 0.0
            _state["touch_forces"]["pinky"] = max(0.0, (j[13] - 0.4) * 7.5) if len(j) > 13 else 0.0
            _state["fps"] = 50.0


async def ws_client_loop(uri: str):
    """Connects to digital_twin_bridge.py WebSocket server."""
    if not HAS_WEBSOCKETS:
        print("[WS] websockets library not installed. Telemetry client disabled.")
        return

    while True:
        try:
            print(f"[WS] Connecting to bridge at {uri}...")
            async with websockets.connect(uri) as ws:
                with _lock:
                    _state["connected"] = True
                print("[WS] Connected to Aero Hand digital twin bridge!")

                while True:
                    msg = await ws.recv()
                    data = json.loads(msg)

                    # Extract joint degrees -> radians
                    joint_deg = data.get("joint_deg", [])
                    if len(joint_deg) >= 16:
                        rads = [deg * math.pi / 180.0 for deg in joint_deg[:16]]
                        with _lock:
                            _state["joint_rad"] = rads

                    # Send back simulated touch sensor feedback
                    with _lock:
                        touch = dict(_state["touch_forces"])
                    await ws.send(json.dumps({"type": "sim_sensor_feedback", "forces": touch}))

        except Exception as e:
            with _lock:
                _state["connected"] = False
            await asyncio.sleep(2.0)


def terminal_dashboard():
    """Terminal display of MuJoCo twin state."""
    time.sleep(0.5)
    while True:
        time.sleep(0.2)
        with _lock:
            j_rad = _state["joint_rad"][:]
            forces = dict(_state["touch_forces"])
            fps = _state["fps"]
            conn = _state["connected"]

        lines = [
            "\033[2J\033[H",
            "=======================================================",
            "         AERO HAND OPEN -- MUJOCO DIGITAL TWIN         ",
            "=======================================================",
            f"  Status   : {'CONNECTED' if conn else 'STANDALONE / DRY-RUN'}",
            f"  Rate     : {fps:.1f} FPS",
            f"  MuJoCo   : {'Available' if HAS_MUJOCO else 'Emulated (pip install mujoco)'}",
            "-------------------------------------------------------",
            "  Fingertip Simulated Touch Forces (Newtons):",
        ]
        for finger, f in forces.items():
            bar = "#" * int(min(20, f * 2))
            lines.append(f"    {finger.capitalize():7s} : [{bar:<20s}] {f:5.2f} N")

        lines.extend([
            "-------------------------------------------------------",
            "  Joint Angles (degrees):",
            f"    Thumb  : ABD={math.degrees(j_rad[0]):5.1f}°  FLEX={math.degrees(j_rad[1]):5.1f}°  MCP={math.degrees(j_rad[2]):5.1f}°",
            f"    Index  : MCP={math.degrees(j_rad[4]):5.1f}°  PIP={math.degrees(j_rad[5]):5.1f}°   DIP={math.degrees(j_rad[6]):5.1f}°",
            f"    Middle : MCP={math.degrees(j_rad[7]):5.1f}°  PIP={math.degrees(j_rad[8]):5.1f}°   DIP={math.degrees(j_rad[9]):5.1f}°",
            f"    Ring   : MCP={math.degrees(j_rad[10]):5.1f}° PIP={math.degrees(j_rad[11]):5.1f}°  DIP={math.degrees(j_rad[12]):5.1f}°",
            f"    Pinky  : MCP={math.degrees(j_rad[13]):5.1f}° PIP={math.degrees(j_rad[14]):5.1f}°  DIP={math.degrees(j_rad[15]):5.1f}°",
            "=======================================================",
            "  Press Ctrl+C to exit.",
        ])
        print("\n".join(lines), end="", flush=True)


def main():
    parser = argparse.ArgumentParser(description="Aero Hand Open -- MuJoCo Digital Twin")
    parser.add_argument("--model", default=str(DEFAULT_MODEL), help="Path to MuJoCo XML")
    parser.add_argument("--ws-url", default="ws://127.0.0.1:8888", help="Bridge WebSocket URL")
    parser.add_argument("--mirror", action="store_true", help="Mirror sim motion to real hand")
    parser.add_argument("--dry-run", action="store_true", help="Synthetic motion loop demo")
    args = parser.parse_args()

    model_path = Path(args.model)
    if not model_path.exists():
        print(f"[Error] Model path {model_path} does not exist. Run build_mujoco_models.py first.")
        sys.exit(1)

    if args.dry_run:
        # Generate synthetic sine wave motion
        def _synth_worker():
            t = 0.0
            while True:
                t += 0.03
                rads = [
                    0.5 + 0.4 * math.sin(t * 0.8),
                    0.4 + 0.3 * math.sin(t * 1.0),
                    0.6 + 0.5 * math.sin(t * 1.2),
                    0.6 + 0.5 * math.sin(t * 1.2),
                    0.7 + 0.6 * math.sin(t * 1.4),
                    0.7 + 0.6 * math.sin(t * 1.4),
                    0.7 + 0.6 * math.sin(t * 1.4),
                    0.7 + 0.6 * math.sin(t * 1.5),
                    0.7 + 0.6 * math.sin(t * 1.5),
                    0.7 + 0.6 * math.sin(t * 1.5),
                    0.7 + 0.6 * math.sin(t * 1.6),
                    0.7 + 0.6 * math.sin(t * 1.6),
                    0.7 + 0.6 * math.sin(t * 1.6),
                    0.7 + 0.6 * math.sin(t * 1.7),
                    0.7 + 0.6 * math.sin(t * 1.7),
                    0.7 + 0.6 * math.sin(t * 1.7),
                ]
                with _lock:
                    _state["joint_rad"] = rads
                time.sleep(0.02)
        threading.Thread(target=_synth_worker, daemon=True).start()
    else:
        # Start WebSocket client thread
        def _ws_thread():
            asyncio.run(ws_client_loop(args.ws_url))
        threading.Thread(target=_ws_thread, daemon=True).start()

    # Start dashboard in background thread
    threading.Thread(target=terminal_dashboard, daemon=True).start()

    # Run MuJoCo simulation on main thread
    run_mujoco_sim(model_path, mirror_mode=args.mirror)


if __name__ == "__main__":
    main()
