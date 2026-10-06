#!/usr/bin/env python3
"""
Aero Hand Open — Intelligent Service Supervisor & Runner
=========================================================
Manages the complete local development ecosystem:
  1. Checks that ports 8765, 3245, 8888 are available.
  2. Verifies Python dependencies (websockets, cadgen==0.7.10).
  3. Recompiles the website bundle with build_website.py.
  4. Launches and monitors:
     - Local HTTP Web Server (port 8765)
     - 3D CAD Parametric Engine (port 3245)
     - Digital Twin WebSocket Bridge (port 8888)
  5. Performs active health-check polling on all three services.
  6. Opens the workspace index after all three services are ready.
  7. Provides an interactive console menu with auto-cleanup on exit.
"""

from __future__ import annotations
import atexit
import signal
import socket
import subprocess
import sys
import time
import webbrowser
from pathlib import Path

# Safe stdout on Windows
if sys.platform == "win32":
    import io
    if hasattr(sys.stdout, "buffer"):
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    if hasattr(sys.stderr, "buffer"):
        sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

# Colors & Formatting
ANSI_CYAN = "\033[36m"
ANSI_GREEN = "\033[32m"
ANSI_YELLOW = "\033[33m"
ANSI_RED = "\033[31m"
ANSI_BOLD = "\033[1m"
ANSI_DIM = "\033[2m"
ANSI_RESET = "\033[0m"

# Locate workspace root and main package directory
CURRENT_FILE = Path(__file__).resolve()
SIM_DIR = CURRENT_FILE.parent
MAIN_DIR = SIM_DIR.parent
ROOT_DIR = MAIN_DIR.parent if (MAIN_DIR.parent / "source-aero-hand-main").exists() else MAIN_DIR

LOGS_DIR = SIM_DIR / "logs"
LOGS_DIR.mkdir(parents=True, exist_ok=True)

CHILD_PROCESSES: list[subprocess.Popen] = []
LOG_HANDLES: list = []


def print_banner():
    banner = f"""{ANSI_CYAN}{ANSI_BOLD}
╔═══════════════════════════════════════════════════════════════════╗
║          AERO HAND OPEN — ADVANCED CAD & TWIN SUPERVISOR          ║
╚═══════════════════════════════════════════════════════════════════╝{ANSI_RESET}"""
    print(banner)


def cleanup_all_ports():
    print(f"\n{ANSI_BOLD}[1/5] Checking required ports...{ANSI_RESET}")
    port_labels = {8765: "Website", 3245: "CAD viewer", 8888: "Digital twin"}
    occupied = [port for port in port_labels if is_port_open(port)]
    if occupied:
        details = ", ".join(f"{port_labels[port]} ({port})" for port in occupied)
        raise RuntimeError(
            f"Required port(s) already in use: {details}. Stop the process using "
            "those ports, then run START_WEBSITE.bat again."
        )
    for port, label in port_labels.items():
        print(f"  {ANSI_GREEN}✓ {label} port {port} is available{ANSI_RESET}")


def verify_dependencies():
    print(f"\n{ANSI_BOLD}[2/5] Verifying Python dependencies...{ANSI_RESET}")

    # Check websockets
    try:
        import websockets  # noqa: F401
        print(f"  {ANSI_GREEN}✓ websockets is installed{ANSI_RESET}")
    except ImportError:
        print(f"  {ANSI_YELLOW}• Installing missing 'websockets' package...{ANSI_RESET}")
        subprocess.run(
            [sys.executable, "-m", "pip", "install", "websockets", "-q"],
            check=True,
        )
        import websockets  # noqa: F401

    # Check cadgen
    try:
        res = subprocess.run(["cadgen", "--version"], capture_output=True, text=True)
    except FileNotFoundError:
        res = None
    if res is None or res.returncode != 0:
        print(f"  {ANSI_YELLOW}• Installing 'cadgen==0.7.10'...{ANSI_RESET}")
        subprocess.run(
            [sys.executable, "-m", "pip", "install", "cadgen==0.7.10", "-q"],
            check=True,
        )
        res = subprocess.run(["cadgen", "--version"], capture_output=True, text=True)
    if res.returncode != 0:
        raise RuntimeError(f"cadgen is unavailable: {res.stderr.strip()}")
    print(f"  {ANSI_GREEN}✓ cadgen CLI is available: {res.stdout.strip()}{ANSI_RESET}")


def compile_website():
    print(f"\n{ANSI_BOLD}[3/5] Recompiling website bundle...{ANSI_RESET}")
    build_script = SIM_DIR / "build_website.py"
    if not build_script.exists():
        raise FileNotFoundError(f"Website build script not found: {build_script}")
    res = subprocess.run(
        [sys.executable, str(build_script)],
        cwd=str(MAIN_DIR),
        capture_output=True,
        text=True,
    )
    if res.returncode != 0:
        raise RuntimeError(f"Website build failed:\n{res.stdout}{res.stderr}")
    print(f"  {ANSI_GREEN}✓ Website bundle compiled successfully{ANSI_RESET}")


def is_port_open(port: int, host: str = "127.0.0.1") -> bool:
    try:
        with socket.create_connection((host, port), timeout=0.6):
            return True
    except (OSError, ConnectionRefusedError):
        return False


def start_services():
    global CHILD_PROCESSES, LOG_HANDLES
    print(f"\n{ANSI_BOLD}[4/5] Starting daemons and servers...{ANSI_RESET}")

    # 1. CAD Viewer
    cad_log = open(LOGS_DIR / "cad_viewer.log", "w", encoding="utf-8")
    LOG_HANDLES.append(cad_log)
    print(f"  • Starting CAD Viewer Engine (port 3245)...")
    proc_cad = subprocess.Popen(
        ["cadgen", "viewer", "--port", "3245", "--host", "127.0.0.1"],
        stdout=cad_log,
        stderr=cad_log,
        cwd=str(MAIN_DIR)
    )
    CHILD_PROCESSES.append(proc_cad)

    # 2. Digital Twin Bridge
    twin_log = open(LOGS_DIR / "digital_twin.log", "w", encoding="utf-8")
    LOG_HANDLES.append(twin_log)
    print(f"  • Starting Digital Twin Telemetry Bridge (port 8888)...")
    proc_twin = subprocess.Popen(
        [
            sys.executable,
            str(SIM_DIR / "digital_twin_bridge.py"),
            "--dry-run",
            "--ws",
            "--no-dashboard",
        ],
        stdout=twin_log,
        stderr=twin_log,
        cwd=str(MAIN_DIR)
    )
    CHILD_PROCESSES.append(proc_twin)

    # 3. HTTP Server
    http_log = open(LOGS_DIR / "http_server.log", "w", encoding="utf-8")
    LOG_HANDLES.append(http_log)
    print(f"  • Starting Local Web Server (port 8765)...")
    proc_http = subprocess.Popen(
        [sys.executable, "-m", "http.server", "8765"],
        stdout=http_log,
        stderr=http_log,
        cwd=str(ROOT_DIR)
    )
    CHILD_PROCESSES.append(proc_http)


def wait_for_services(timeout_sec: float = 12.0) -> bool:
    print(f"\n{ANSI_BOLD}[5/5] Performing active health-check verification...{ANSI_RESET}")
    start = time.time()
    ready = {"http": False, "cad": False, "twin": False}

    while time.time() - start < timeout_sec:
        if not ready["http"] and is_port_open(8765):
            ready["http"] = True
            print(f"  {ANSI_GREEN}✓ [ONLINE] Web Server on http://localhost:8765{ANSI_RESET}")

        if not ready["cad"] and is_port_open(3245):
            ready["cad"] = True
            print(f"  {ANSI_GREEN}✓ [ONLINE] CAD Studio Engine on http://127.0.0.1:3245{ANSI_RESET}")

        if not ready["twin"] and is_port_open(8888):
            ready["twin"] = True
            print(f"  {ANSI_GREEN}✓ [ONLINE] Digital Twin Telemetry on ws://127.0.0.1:8888{ANSI_RESET}")

        if all(ready.values()):
            return True

        time.sleep(0.4)

    # Report any offline
    for s, ok in ready.items():
        if not ok:
            print(f"  {ANSI_YELLOW}! [WARNING] {s.upper()} service did not respond within {timeout_sec}s (check logs/){ANSI_RESET}")
    return all(ready.values())


def stop_all_services():
    global CHILD_PROCESSES, LOG_HANDLES
    print(f"\n{ANSI_YELLOW}Stopping background services...{ANSI_RESET}")
    for proc in CHILD_PROCESSES:
        try:
            if proc.poll() is None:
                if sys.platform == "win32":
                    subprocess.run(f"taskkill /F /T /PID {proc.pid}", shell=True, capture_output=True)
                else:
                    proc.terminate()
        except Exception:
            pass
    CHILD_PROCESSES.clear()

    for handle in LOG_HANDLES:
        try:
            handle.close()
        except Exception:
            pass
    LOG_HANDLES.clear()

    print(f"{ANSI_GREEN}All services cleanly stopped.{ANSI_RESET}\n")


# Register clean exit
atexit.register(stop_all_services)


def sig_handler(signum, frame):
    stop_all_services()
    sys.exit(0)


signal.signal(signal.SIGINT, sig_handler)
signal.signal(signal.SIGTERM, sig_handler)


def interactive_menu():
    site_path = (
        "/source-aero-hand-main/simulation/index.html"
        if (ROOT_DIR / "source-aero-hand-main" / "simulation" / "index.html").exists()
        else "/simulation/index.html"
    )
    web_url = f"http://localhost:8765{site_path}"
    entry_url = "http://localhost:8765/index.html?services=ready"
    print(f"\n{ANSI_CYAN}{ANSI_BOLD}═══════════════════════════════════════════════════════════════════{ANSI_RESET}")
    print(f"  {ANSI_BOLD}AERO HAND OPEN IS RUNNING LIVE!{ANSI_RESET}")
    print(f"{ANSI_CYAN}═══════════════════════════════════════════════════════════════════{ANSI_RESET}")
    print(f"  • Web Application   : {ANSI_GREEN}{web_url}{ANSI_RESET}")
    print(f"  • 3D CAD Viewport   : {ANSI_GREEN}{web_url}#cad-viewer{ANSI_RESET}")
    print(f"  • CAD Engine Server : {ANSI_GREEN}http://127.0.0.1:3245/{ANSI_RESET}")
    print(f"  • Digital Twin WS   : {ANSI_GREEN}ws://127.0.0.1:8888{ANSI_RESET}")
    print(f"  • Diagnostic Logs   : {ANSI_DIM}{LOGS_DIR}{ANSI_RESET}")
    print(f"{ANSI_CYAN}═══════════════════════════════════════════════════════════════════{ANSI_RESET}")
    print(f"  {ANSI_BOLD}Controls:{ANSI_RESET}")
    print(f"    [{ANSI_BOLD}O{ANSI_RESET}] Re-open in browser       [{ANSI_BOLD}C{ANSI_RESET}] Open CAD Viewer")
    print(f"    [{ANSI_BOLD}B{ANSI_RESET}] Rebuild website bundle   [{ANSI_BOLD}R{ANSI_RESET}] Restart all services")
    print(f"    [{ANSI_BOLD}Q{ANSI_RESET}] Stop all services & exit")
    print(f"{ANSI_CYAN}═══════════════════════════════════════════════════════════════════{ANSI_RESET}\n")

    # Open browser
    try:
        webbrowser.open(entry_url)
    except Exception:
        pass

    while True:
        try:
            cmd = input(f"{ANSI_CYAN}Enter command [O/C/B/R/Q]: {ANSI_RESET}").strip().upper()
            if cmd == "Q":
                break
            elif cmd == "O":
                print(f"Opening {entry_url}...")
                webbrowser.open(entry_url)
            elif cmd == "C":
                cad_url = "http://127.0.0.1:3245/?file=Aero_Hand_Open_Right.step"
                print(f"Opening CAD Viewer {cad_url}...")
                webbrowser.open(cad_url)
            elif cmd == "B":
                compile_website()
            elif cmd == "R":
                print(f"{ANSI_YELLOW}Restarting all services...{ANSI_RESET}")
                stop_all_services()
                cleanup_all_ports()
                start_services()
                if wait_for_services():
                    print(f"{ANSI_GREEN}Services restarted successfully.{ANSI_RESET}")
                    webbrowser.open(entry_url)
                else:
                    print(f"{ANSI_RED}Services did not restart successfully.{ANSI_RESET}")
                    stop_all_services()
        except (KeyboardInterrupt, EOFError):
            break


def preview_mode():
    site_path = (
        "/source-aero-hand-main/simulation/index.html"
        if (ROOT_DIR / "source-aero-hand-main" / "simulation" / "index.html").exists()
        else "/simulation/index.html"
    )
    entry_url = "http://localhost:8765/index.html?services=ready"
    print(f"\n{ANSI_GREEN}All website, CAD, and digital-twin services are running.{ANSI_RESET}")
    print(f"  Website:     http://localhost:8765{site_path}")
    print("  CAD viewer:  http://127.0.0.1:3245/")
    print("  Twin socket: ws://127.0.0.1:8888")
    print("  URDF viewer: Digital Twin section in the website preview")
    print("Press Ctrl+C to stop all services.")
    webbrowser.open(entry_url)

    while True:
        failed = [proc for proc in CHILD_PROCESSES if proc.poll() is not None]
        if failed:
            raise RuntimeError(
                "A website service stopped unexpectedly; check the simulation/logs folder."
            )
        time.sleep(1)


def main():
    import argparse

    parser = argparse.ArgumentParser(description="Run the Aero Hand Open website services.")
    parser.add_argument(
        "--preview",
        action="store_true",
        help="Open the website preview and keep all local services running until Ctrl+C.",
    )
    args = parser.parse_args()

    print_banner()
    cleanup_all_ports()
    verify_dependencies()
    compile_website()
    start_services()
    if not wait_for_services():
        stop_all_services()
        raise RuntimeError("Not all required services started; check the simulation/logs folder.")
    if args.preview:
        preview_mode()
    else:
        interactive_menu()


if __name__ == "__main__":
    main()
