# Aero Hand Open website

This folder contains the Aero Hand Open website and the assets required by its
interactive CAD viewer, digital twin, and download links.

## Start the complete website locally

### Recommended: Docker Compose

Install Docker Desktop (Windows/macOS) or Docker Engine with the Compose plugin
(Linux), then clone this repository and open a terminal in the cloned folder:

```sh
git clone https://github.com/Parmar-Krunal/aero-hand-open-website.git
cd aero-hand-open-website
docker compose -f source-aero-hand-main/compose.yaml up --build
```

On Windows, the same command works in PowerShell. Wait for all three services
to start, then open <http://localhost:8765/simulation/index.html>. The site
includes the interactive CAD viewer and digital-twin/URDF viewer.

| Service | Local address |
| --- | --- |
| Website | <http://localhost:8765/simulation/index.html> |
| CAD viewer | <http://localhost:3245> |
| Digital-twin WebSocket | `ws://localhost:8888` |

Press Ctrl+C in the Compose terminal to stop the services. To start them in the
background, add `-d` to the `up --build` command; stop them later with:

```sh
docker compose -f source-aero-hand-main/compose.yaml down
```

The ports bind to the local machine only. This is a local demo stack, not a
public production deployment. The twin uses synthetic dry-run telemetry and
does not connect to physical hand hardware.

### Alternative: Windows Python launcher

Install Python 3.10 or newer, then double-click [`START_WEBSITE.bat`](./START_WEBSITE.bat).
It checks dependencies, builds the website, starts all three local services,
and opens the preview. Keep its window open while using the site; press Ctrl+C
there to stop the services. If a healthy full stack is already running, a new
launch reuses it.

## Share or download the project

Anyone can clone or download this repository from GitHub. For a reproducible
complete local setup, use the Docker Compose command above; it builds the image
and starts the website, CAD viewer, and synthetic twin together. Copilot
repository guidance is in [`.github/copilot-instructions.md`](./.github/copilot-instructions.md).
Downloading the source does not publish the running services to the internet.

## Build and validate

From `source-aero-hand-main`, compile the website with:

```powershell
python simulation\build_website.py
```

Run the HTML/DOM consistency validator with:

```powershell
python simulation\site_src\validate_site.py
```

The editable HTML, CSS, and JavaScript are in
[`site_src`](./source-aero-hand-main/simulation/site_src); the compiler writes
the production pages to `simulation\index.html` and
`simulation\aero_hand_website.html`.

## Website assets

The remaining hardware, firmware, and simulation files are retained only where
the website links to them or its local services load them. Project licensing
information is in [`LICENSE.md`](./source-aero-hand-main/LICENSE.md).
