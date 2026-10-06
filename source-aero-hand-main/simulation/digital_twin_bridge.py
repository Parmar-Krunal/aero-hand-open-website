#!/usr/bin/env python3
# Copyright 2025 TetherIA, Inc.  (additions for digital twin bridge)
#
# Licensed under the Apache License, Version 2.0.
#
# digital_twin_bridge.py — Bidirectional Gazebo Digital Twin Bridge
# =================================================================
# Reads joint positions from the real Aero Hand (USB serial, 921 600 baud)
# and publishes them to Gazebo Sim via gz topic.
#
# Simultaneously reads sensor data (FSR / force) from an optional Arduino
# sensor board (9600 baud) and forwards those readings to Gazebo custom
# sensor topics AND prints them into the live terminal dashboard.
#
# Optional "mirror" mode: Gazebo joint commands → real hand  (teleop from sim)
#
# Requirements:
#   pip install pyserial gz-python   # gz-python only on Linux/Mac with Gazebo installed
#   Gazebo Harmonic + gz CLI must be on PATH (Linux/Mac only for Gazebo Sim backend)
#   On Windows: bridge publishes to a JSON WebSocket instead (see --ws flag)
#
# Usage:
#   # Real-to-Gazebo (default)
#   python digital_twin_bridge.py --port COM3 --hand right
#
#   # With FSR sensor board on second serial port
#   python digital_twin_bridge.py --port COM3 --sensor-port COM4 --hand right
#
#   # Mirror mode (Gazebo → real hand, use sliders in Gazebo GUI to drive real hand)
#   python digital_twin_bridge.py --port COM3 --hand right --mirror
#
#   # WebSocket mode (Windows / no Gazebo CLI)
#   python digital_twin_bridge.py --port COM3 --ws --ws-port 8888
#
#   # Dry-run (no real hardware, logs what would be sent)
#   python digital_twin_bridge.py --dry-run --hand right

from __future__ import annotations
import argparse
import json
import math
import shutil
import subprocess
import sys
import threading
import time
import struct
import queue
from pathlib import Path
from typing import Optional

# ── Optional deps (graceful degradation) ──────────────────────────────────
try:
    import serial
    HAS_SERIAL = True
except ImportError:
    HAS_SERIAL = False

try:
    import asyncio
    import websockets  # type: ignore
    HAS_WS = True
except ImportError:
    HAS_WS = False

# ── Repo paths ─────────────────────────────────────────────────────────────
ROOT = Path(__file__).resolve().parents[1]
SDK_SRC = ROOT / "sdk" / "src"
if str(SDK_SRC) not in sys.path:
    sys.path.insert(0, str(SDK_SRC))

# ── Optional SDK math (only needed for hardware control/dashboard) ──────────
CONSTANTS = None
ACT_TO_JOINTS = None
JOINTS_TO_ACT = None


def _load_sdk():
    global CONSTANTS, ACT_TO_JOINTS, JOINTS_TO_ACT
    try:
        from aero_open_sdk.aero_hand_constants import AeroHandConstants
        from aero_open_sdk.actuations_to_joints import ActuationsToJointsModelCompact
        from aero_open_sdk.joints_to_actuations import JointsToActuationsModel
    except ModuleNotFoundError as exc:
        if exc.name and exc.name.startswith("aero_open_sdk"):
            raise RuntimeError(
                "The Aero Hand Python SDK is required for hardware control and "
                "the terminal dashboard. Install the SDK before using these modes."
            ) from exc
        raise

    CONSTANTS = AeroHandConstants()
    ACT_TO_JOINTS = ActuationsToJointsModelCompact()
    JOINTS_TO_ACT = JointsToActuationsModel()

# 16 URDF joint names in order (matches play_sdk_sequence.py)
JOINT_ORDER = (
    "thumb_cmc_abd", "thumb_cmc_flex", "thumb_mcp", "thumb_ip",
    "index_mcp_flex",  "index_pip",  "index_dip",
    "middle_mcp_flex", "middle_pip", "middle_dip",
    "ring_mcp_flex",   "ring_pip",   "ring_dip",
    "pinky_mcp_flex",  "pinky_pip",  "pinky_dip",
)

# 5 FSR channels (one per fingertip: thumb, index, middle, ring, pinky)
FSR_NAMES = ("thumb_fsr", "index_fsr", "middle_fsr", "ring_fsr", "pinky_fsr")
FSR_MAX_RAW = 1023.0  # 10-bit ADC on Arduino

# Protocol constants (mirror of aero_hand.py)
GET_POS  = 0x22
GET_CURR = 0x24
GET_VEL  = 0x23
GET_TEMP = 0x25
_UINT16_MAX = 65535

# ── Shared state (thread-safe) ─────────────────────────────────────────────
_lock = threading.Lock()
_state: dict = {
    "joint_deg":  [0.0] * 16,   # 16 joint angles in degrees (from real hand)
    "actuation_deg": [0.0] * 7, # 7 actuator values in degrees
    "current_ma": [0.0] * 7,
    "temp_c":     [0.0] * 7,
    "fsr_n":      [0.0] * 5,    # finger-tip normal force estimate in Newtons
    "fsr_raw":    [0] * 5,      # raw ADC 0-1023
    "timestamp":  0.0,
    "hz":         0.0,
}

_gz_cmd_queue: queue.Queue = queue.Queue(maxsize=32)   # joint deg list → Gazebo
_real_cmd_queue: queue.Queue = queue.Queue(maxsize=32) # joint deg list → real hand (mirror)

# ─────────────────────────────────────────────────────────────────────────
# SECTION 1: Serial framing helpers (mirrors aero_hand.py internals)
# ─────────────────────────────────────────────────────────────────────────

def _build_frame(opcode: int, values: Optional[list[int]] = None) -> bytes:
    """Build a 16-byte fixed frame. values = 7 uint16 (or zeros)."""
    vs = values or [0] * 7
    return struct.pack("<BB7H", opcode, 0, *vs)

def _parse_response(raw: bytes) -> Optional[list[float]]:
    """Parse a 16-byte response frame. Returns 7 float values or None."""
    if len(raw) < 16:
        return None
    try:
        parts = struct.unpack("<BB7H", raw[:16])
        return list(parts[2:])   # 7 uint16 values
    except struct.error:
        return None

def _uint16_to_deg(raw: list[float], lower: tuple, upper: tuple) -> list[float]:
    """Denormalize uint16 → degrees using known limits."""
    return [
        raw[i] / _UINT16_MAX * (upper[i] - lower[i]) + lower[i]
        for i in range(7)
    ]

def _expand_7_to_16(q7: list[float]) -> list[float]:
    """Expand 7 compact joints → 16 URDF joints (same mapping as SDK)."""
    return [
        q7[0], q7[1], q7[2], q7[2],
        q7[3], q7[3], q7[3],
        q7[4], q7[4], q7[4],
        q7[5], q7[5], q7[5],
        q7[6], q7[6], q7[6],
    ]

# ─────────────────────────────────────────────────────────────────────────
# SECTION 2: Real hand reader thread
# ─────────────────────────────────────────────────────────────────────────

class HandReaderThread(threading.Thread):
    """Continuously polls the real Aero Hand and updates _state."""

    def __init__(self, port: str, baudrate: int = 921600, rate_hz: float = 50.0):
        super().__init__(daemon=True, name="HandReader")
        self.port = port
        self.baudrate = baudrate
        self.period = 1.0 / rate_hz
        self._ser: Optional["serial.Serial"] = None
        self.running = True

    def _open(self):
        self._ser = serial.Serial(
            self.port, self.baudrate, timeout=0.025, write_timeout=0.025
        )
        self._ser.reset_input_buffer()
        self._ser.reset_output_buffer()
        print(f"[HandReader] Opened {self.port} @ {self.baudrate} baud")

    def _query(self, opcode: int) -> Optional[list[float]]:
        try:
            self._ser.write(_build_frame(opcode))
            raw = self._ser.read(16)
            return _parse_response(raw)
        except Exception as e:
            print(f"[HandReader] query 0x{opcode:02X} error: {e}")
            return None

    def run(self):
        if not HAS_SERIAL:
            print("[HandReader] pyserial not installed — install with: pip install pyserial")
            return
        try:
            self._open()
        except Exception as e:
            print(f"[HandReader] Failed to open {self.port}: {e}")
            return

        tick_count = 0
        t_start = time.perf_counter()

        while self.running:
            t0 = time.perf_counter()

            pos_raw  = self._query(GET_POS)
            curr_raw = self._query(GET_CURR)

            if pos_raw is not None:
                act_deg = _uint16_to_deg(
                    pos_raw,
                    CONSTANTS.actuation_lower_limits,
                    CONSTANTS.actuation_upper_limits,
                )
                # Convert 7 actuations → 7 compact joint estimates
                try:
                    compact7 = ACT_TO_JOINTS.compact_joint_positions(act_deg)
                except Exception:
                    compact7 = act_deg  # fallback: raw actuations
                j16 = _expand_7_to_16(compact7)

                with _lock:
                    _state["actuation_deg"] = act_deg
                    _state["joint_deg"]     = j16
                    _state["timestamp"]     = time.time()

                # Push to Gazebo publisher queue
                if not _gz_cmd_queue.full():
                    _gz_cmd_queue.put_nowait(j16)

            if curr_raw is not None:
                ma = [v * 6.5 for v in curr_raw]  # 1 unit = 6.5 mA
                with _lock:
                    _state["current_ma"] = ma

            tick_count += 1
            elapsed = time.perf_counter() - t_start
            if elapsed > 0:
                with _lock:
                    _state["hz"] = tick_count / elapsed

            sleep_t = self.period - (time.perf_counter() - t0)
            if sleep_t > 0:
                time.sleep(sleep_t)

    def stop(self):
        self.running = False
        if self._ser and self._ser.is_open:
            self._ser.close()

# ─────────────────────────────────────────────────────────────────────────
# SECTION 3: FSR / Force Sensor reader thread
# ─────────────────────────────────────────────────────────────────────────
# Expected Arduino serial format (one line per sample, 10 Hz min):
#   FSR:512,341,280,190,420
# Where each value is a 10-bit ADC reading (0-1023) for
#   thumb, index, middle, ring, pinky respectively.
#
# FSR force estimation: Interlink 402 datasheet approximation
#   Force(N) ≈ ADC_raw / 1023 * FSR_MAX_N
#
FSR_MAX_N = 15.0  # Interlink 402 ~15 N full scale at 3.3V divider


class SensorReaderThread(threading.Thread):
    """Reads FSR / force sensor board (Arduino) over a separate serial port."""

    def __init__(self, port: str, baudrate: int = 9600):
        super().__init__(daemon=True, name="SensorReader")
        self.port = port
        self.baudrate = baudrate
        self.running = True

    def run(self):
        if not HAS_SERIAL:
            return
        try:
            ser = serial.Serial(self.port, self.baudrate, timeout=1.0)
            print(f"[SensorReader] Opened {self.port} @ {self.baudrate} baud (FSR)")
        except Exception as e:
            print(f"[SensorReader] Failed to open {self.port}: {e}")
            return

        while self.running:
            try:
                line = ser.readline().decode(errors="ignore").strip()
                if not line.startswith("FSR:"):
                    continue
                parts = line[4:].split(",")
                if len(parts) < 5:
                    continue
                raw = [max(0, min(FSR_MAX_RAW, float(p))) for p in parts[:5]]
                force_n = [r / FSR_MAX_RAW * FSR_MAX_N for r in raw]
                with _lock:
                    _state["fsr_raw"]  = [int(r) for r in raw]
                    _state["fsr_n"]    = force_n
            except Exception as e:
                print(f"[SensorReader] Parse error: {e}")

    def stop(self):
        self.running = False

# ─────────────────────────────────────────────────────────────────────────
# SECTION 4: Gazebo publisher thread
# ─────────────────────────────────────────────────────────────────────────

class GazeboPublisherThread(threading.Thread):
    """Drains _gz_cmd_queue and publishes joint angles to Gazebo via gz CLI."""

    def __init__(self, hand: str = "right", dry_run: bool = False):
        super().__init__(daemon=True, name="GazeboPublisher")
        self.hand = hand
        self.model = f"aero_hand_open_{hand}"
        self.dry_run = dry_run
        self.running = True
        self._gz: Optional[str] = None

    def _find_gz(self) -> bool:
        gz = shutil.which("gz")
        if gz:
            self._gz = gz
            return True
        print("[GazeboPublisher] 'gz' CLI not found — Gazebo publishing disabled.")
        print("  Install Gazebo Harmonic and source its setup.bash")
        return False

    def _publish_joint(self, joint_name: str, deg: float):
        topic = f"/model/{self.model}/joint/{self.hand}_{joint_name}/0/cmd_pos"
        rad   = math.radians(deg)
        if self.dry_run:
            return
        try:
            subprocess.run(
                [self._gz, "topic", "-t", topic, "-m", "gz.msgs.Double",
                 "-p", f"data: {rad:.8f}"],
                capture_output=True, timeout=0.1
            )
        except subprocess.TimeoutExpired:
            pass

    def _publish_sensor(self, finger_idx: int, force_n: float):
        topic = f"/model/{self.model}/sensor/{FSR_NAMES[finger_idx]}/force"
        if self.dry_run:
            return
        try:
            subprocess.run(
                [self._gz, "topic", "-t", topic, "-m", "gz.msgs.Double",
                 "-p", f"data: {force_n:.4f}"],
                capture_output=True, timeout=0.1
            )
        except subprocess.TimeoutExpired:
            pass

    def run(self):
        if not self._find_gz() and not self.dry_run:
            return

        while self.running:
            try:
                j16 = _gz_cmd_queue.get(timeout=0.1)
            except queue.Empty:
                continue

            # Publish all 16 joints
            for joint, deg in zip(JOINT_ORDER, j16):
                self._publish_joint(joint, deg)

            # Publish FSR sensor data (best-effort)
            with _lock:
                fsr_n = _state["fsr_n"][:]
            for i, fn in enumerate(fsr_n):
                self._publish_sensor(i, fn)

    def stop(self):
        self.running = False

# ─────────────────────────────────────────────────────────────────────────
# SECTION 5: Mirror thread  (Gazebo → real hand)
# ─────────────────────────────────────────────────────────────────────────

class MirrorThread(threading.Thread):
    """Subscribes to Gazebo joint state topic and sends commands to real hand."""

    def __init__(self, port: str, hand: str = "right", baudrate: int = 921600):
        super().__init__(daemon=True, name="MirrorThread")
        self.port = port
        self.hand = hand
        self.baudrate = baudrate
        self.running = True
        self._gz: Optional[str] = None
        self._ser = None

    def run(self):
        if not HAS_SERIAL:
            return
        self._gz = shutil.which("gz")
        if not self._gz:
            print("[Mirror] gz CLI not found — mirror mode disabled")
            return
        try:
            self._ser = serial.Serial(self.port, self.baudrate, timeout=0.025, write_timeout=0.025)
        except Exception as e:
            print(f"[Mirror] Failed to open {self.port}: {e}")
            return

        print(f"[Mirror] Gazebo → real hand on {self.port}")
        model = f"aero_hand_open_{self.hand}"
        topic = f"/model/{model}/joint_state"

        while self.running:
            # Poll Gazebo joint_state topic (one-shot echo)
            try:
                result = subprocess.run(
                    [self._gz, "topic", "-e", "-n", "1", "-t", topic],
                    capture_output=True, text=True, timeout=0.3
                )
                if result.returncode == 0 and result.stdout.strip():
                    self._apply_joint_state(result.stdout)
            except subprocess.TimeoutExpired:
                pass
            time.sleep(0.02)

    def _apply_joint_state(self, raw_text: str):
        """Very simple proto-text parser: finds 'position:' floats in order."""
        vals = []
        for line in raw_text.splitlines():
            if "position:" in line:
                try:
                    vals.append(float(line.split("position:")[-1].strip()))
                except ValueError:
                    pass
        if len(vals) >= 7:
            deg7 = [math.degrees(v) for v in vals[:7]]
            if not _real_cmd_queue.full():
                _real_cmd_queue.put_nowait(deg7)
            # Send immediately
            act = JOINTS_TO_ACT.hand_actuations(
                [max(CONSTANTS.joint_lower_limits[i],
                     min(deg7[i] if i < 7 else 0, CONSTANTS.joint_upper_limits[i]))
                 for i in range(16)][:16]
            )
            norm = [
                int(max(0, min(_UINT16_MAX,
                    (act[i] - CONSTANTS.actuation_lower_limits[i])
                    / (CONSTANTS.actuation_upper_limits[i] - CONSTANTS.actuation_lower_limits[i])
                    * _UINT16_MAX
                )))
                for i in range(7)
            ]
            frame = _build_frame(0x11, norm)
            try:
                self._ser.write(frame)
            except Exception as e:
                print(f"[Mirror] Serial write error: {e}")

    def stop(self):
        self.running = False
        if self._ser and self._ser.is_open:
            self._ser.close()

# ─────────────────────────────────────────────────────────────────────────
# SECTION 6: WebSocket server (Windows / no Gazebo)
# ─────────────────────────────────────────────────────────────────────────

async def _ws_handler(websocket, path=None):
    """Stream current state to every connected WebSocket client at ~30 Hz and receive mirror commands."""
    client_addr = getattr(websocket, "remote_address", "web-client")
    print(f"[WS] Client connected: {client_addr}")

    async def _send_loop():
        while True:
            with _lock:
                payload = {
                    "t":           _state["timestamp"],
                    "hz":          round(_state["hz"], 1),
                    "joint_deg":   [round(v, 3) for v in _state["joint_deg"]],
                    "actuation_deg": [round(v, 3) for v in _state["actuation_deg"]],
                    "current_ma":  [round(v, 2)  for v in _state["current_ma"]],
                    "fsr_raw":     _state["fsr_raw"][:],
                    "fsr_n":       [round(v, 3)  for v in _state["fsr_n"]],
                }
            await websocket.send(json.dumps(payload))
            await asyncio.sleep(1 / 30)

    async def _recv_loop():
        try:
            async for raw_msg in websocket:
                try:
                    data = json.loads(raw_msg)
                    if data.get("type") == "joint_command":
                        j_deg = data.get("joint_deg")
                        if isinstance(j_deg, list):
                            with _lock:
                                for idx, val in enumerate(j_deg[:16]):
                                    _state["joint_deg"][idx] = float(val)
                except Exception:
                    pass
        except Exception:
            pass

    try:
        await asyncio.gather(_send_loop(), _recv_loop())
    except Exception:
        pass
    finally:
        print(f"[WS] Client disconnected: {client_addr}")



def _run_ws_server(host: str, port: int):
    import asyncio
    async def _serve():
        async with websockets.serve(_ws_handler, host, port):
            print(f"[WS] WebSocket server running on ws://{host}:{port}")
            await asyncio.Future()
    asyncio.run(_serve())


# ─────────────────────────────────────────────────────────────────────────
# SECTION 7: Terminal dashboard
# ─────────────────────────────────────────────────────────────────────────

JOINT_NAMES_SHORT = [
    "T_ABD", "T_FLX", "T_MCP", "T_IP",
    "I_MCP", "I_PIP", "I_DIP",
    "M_MCP", "M_PIP", "M_DIP",
    "R_MCP", "R_PIP", "R_DIP",
    "P_MCP", "P_PIP", "P_DIP",
]
FINGER_EMOJIS = ["👍", "☝️", "🖕", "💍", "🤙"]


def _bar(val: float, vmin: float, vmax: float, width: int = 20) -> str:
    frac = max(0.0, min(1.0, (val - vmin) / max(1e-6, vmax - vmin)))
    filled = int(frac * width)
    return "[" + "█" * filled + "░" * (width - filled) + f"] {val:6.1f}"


def _dashboard(dry_run: bool, ws_mode: bool):
    """Render a simple terminal dashboard every 0.25 s."""
    import os
    CLEAR = "\033[2J\033[H"
    BOLD  = "\033[1m"
    CYAN  = "\033[36m"
    GREEN = "\033[32m"
    AMBER = "\033[33m"
    RED   = "\033[31m"
    RST   = "\033[0m"

    while True:
        time.sleep(0.25)
        with _lock:
            j  = _state["joint_deg"][:]
            ma = _state["current_ma"][:]
            fn = _state["fsr_n"][:]
            fr = _state["fsr_raw"][:]
            hz = _state["hz"]

        lines = [CLEAR]
        lines.append(f"{BOLD}{CYAN}╔═══════════════════════════════════════════════════╗{RST}")
        lines.append(f"{BOLD}{CYAN}║     Aero Hand Open — Digital Twin Bridge           ║{RST}")
        lines.append(f"{BOLD}{CYAN}╚═══════════════════════════════════════════════════╝{RST}")
        tag = "[DRY-RUN]" if dry_run else ("[WS-MODE]" if ws_mode else "[GAZEBO]")
        lines.append(f"  Mode: {AMBER}{tag}{RST}   Poll rate: {GREEN}{hz:.1f} Hz{RST}\n")

        lines.append(f"{BOLD}  Joint Positions (degrees){RST}")
        lines.append("  " + "─" * 52)
        for i, (name, deg) in enumerate(zip(JOINT_NAMES_SHORT, j)):
            ul = CONSTANTS.joint_upper_limits[i]
            bar = _bar(deg, 0, ul, 18)
            lines.append(f"  {name:8s} {bar}°")

        lines.append(f"\n{BOLD}  Fingertip FSR Force{RST}")
        lines.append("  " + "─" * 52)
        for i, (em, name, raw, force) in enumerate(zip(FINGER_EMOJIS, FSR_NAMES, fr, fn)):
            color = RED if force > 10 else (AMBER if force > 5 else GREEN)
            bar = _bar(force, 0, FSR_MAX_N, 18)
            lines.append(f"  {em} {name:12s} {color}{bar} N{RST}  (raw={raw})")

        lines.append(f"\n{BOLD}  Actuator Currents{RST}")
        lines.append("  " + "─" * 52)
        act_names = list(CONSTANTS.actuation_names)
        for name, c in zip(act_names, ma):
            color = RED if abs(c) > 800 else GREEN
            lines.append(f"  {name:22s} {color}{c:+7.1f} mA{RST}")

        lines.append("\n  Press Ctrl+C to stop.")
        print("\n".join(lines), end="", flush=True)

# ─────────────────────────────────────────────────────────────────────────
# SECTION 8: Entry point
# ─────────────────────────────────────────────────────────────────────────

if sys.platform == "win32":
    import io
    if hasattr(sys.stdout, "buffer"):
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    if hasattr(sys.stderr, "buffer"):
        sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

def main():
    parser = argparse.ArgumentParser(
        description="Aero Hand Open -- Bidirectional Gazebo Digital Twin Bridge",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Stream real hand -> Gazebo (50 Hz)
  python digital_twin_bridge.py --port COM3 --hand right

  # With FSR sensor board
  python digital_twin_bridge.py --port COM3 --sensor-port COM4

  # Mirror mode: Gazebo sliders -> real hand
  python digital_twin_bridge.py --port COM3 --mirror

  # WebSocket mode (no Gazebo, use with digital twin viewer HTML)
  python digital_twin_bridge.py --port COM3 --ws

  # Dry run (no hardware attached)
  python digital_twin_bridge.py --dry-run
""",
    )
    parser.add_argument("--port",        default="",    help="Real hand serial port (e.g. COM3 or /dev/ttyACM0)")
    parser.add_argument("--baudrate",    type=int, default=921600)
    parser.add_argument("--hand",        choices=("right", "left"), default="right")
    parser.add_argument("--rate",        type=float, default=50.0, help="Poll rate Hz (default 50)")
    parser.add_argument("--sensor-port", default="",    help="FSR/force sensor Arduino port")
    parser.add_argument("--sensor-baud", type=int, default=9600)
    parser.add_argument("--mirror",      action="store_true", help="Enable Gazebo -> real hand mirroring")
    parser.add_argument("--ws",          action="store_true", help="Start WebSocket server (no Gazebo needed)")
    parser.add_argument("--ws-host",     default="127.0.0.1")
    parser.add_argument("--ws-port",     type=int, default=8888)
    parser.add_argument("--dry-run",     action="store_true", help="No hardware, no Gazebo -- log only")
    parser.add_argument("--no-dashboard", action="store_true", help="Run without the terminal dashboard")
    args = parser.parse_args()

    if not args.dry_run and not args.port:
        parser.error("--port is required unless --dry-run is set")
    if not args.dry_run or not args.no_dashboard:
        _load_sdk()

    print("=" * 55)
    print("  Aero Hand Open -- Digital Twin Bridge")
    print("=" * 55)
    print(f"  Hand      : {args.hand}")
    print(f"  Port      : {args.port or 'N/A (dry-run)'}")
    print(f"  Rate      : {args.rate} Hz")
    print(f"  Sensor    : {args.sensor_port or 'none'}")
    print(f"  Mirror    : {args.mirror}")
    print(f"  WebSocket : {args.ws} ({args.ws_host}:{args.ws_port})")
    print(f"  Dry-run   : {args.dry_run}")
    print("=" * 55)

    threads = []

    # 1. Real hand reader
    if not args.dry_run and args.port:
        reader = HandReaderThread(args.port, args.baudrate, args.rate)
        reader.start()
        threads.append(reader)
    else:
        # Synthetic data for dry-run (sine-wave demo)
        def _synthetic():
            t = 0.0
            while True:
                t += 0.02
                j7 = [
                    45.0 * abs(math.sin(t * 0.4)),          # thumb_abd
                    30.0 * abs(math.sin(t * 0.5)),           # thumb_flex
                    50.0 * abs(math.sin(t * 0.6)),           # thumb_mcp
                    40.0 * abs(math.sin(t * 0.7)),           # index
                    45.0 * abs(math.sin(t * 0.8)),           # middle
                    45.0 * abs(math.sin(t * 0.9)),           # ring
                    45.0 * abs(math.sin(t * 1.0)),           # pinky
                ]
                j16 = _expand_7_to_16(j7)
                with _lock:
                    _state["joint_deg"]  = j16
                    _state["actuation_deg"] = j7
                    _state["current_ma"] = [50.0 * math.sin(t + i) for i in range(7)]
                    _state["fsr_n"]  = [5.0 * abs(math.sin(t * 0.3 + i)) for i in range(5)]
                    _state["fsr_raw"]= [int(v / FSR_MAX_N * FSR_MAX_RAW) for v in _state["fsr_n"]]
                    _state["hz"]     = 50.0
                if not _gz_cmd_queue.full():
                    _gz_cmd_queue.put_nowait(j16)
                time.sleep(0.02)
        th = threading.Thread(target=_synthetic, daemon=True, name="Synthetic")
        th.start()
        threads.append(th)

    # 2. FSR sensor reader
    if args.sensor_port:
        sensor = SensorReaderThread(args.sensor_port, args.sensor_baud)
        sensor.start()
        threads.append(sensor)

    # 3. Gazebo publisher
    if not args.ws:
        gz_pub = GazeboPublisherThread(hand=args.hand, dry_run=args.dry_run)
        gz_pub.start()
        threads.append(gz_pub)

    # 4. Mirror thread
    if args.mirror and not args.dry_run:
        mirror = MirrorThread(args.port, args.hand, args.baudrate)
        mirror.start()
        threads.append(mirror)

    # 5. WebSocket server
    if args.ws:
        if not HAS_WS:
            print("[WS] websockets not installed — run: pip install websockets")
        else:
            ws_thread = threading.Thread(
                target=_run_ws_server,
                args=(args.ws_host, args.ws_port),
                daemon=True, name="WSServer"
            )
            ws_thread.start()
            threads.append(ws_thread)

    # 6. Dashboard (blocking in main thread)
    try:
        if args.no_dashboard:
            threading.Event().wait()
        else:
            _dashboard(dry_run=args.dry_run, ws_mode=args.ws)
    except KeyboardInterrupt:
        print("\n\nShutting down digital twin bridge…")
        for t in threads:
            if hasattr(t, "stop"):
                t.stop()


if __name__ == "__main__":
    main()
