# Aero Hand Open website

This folder contains the Aero Hand Open website and the assets required by its
interactive CAD viewer, digital twin, and download links.

## Run locally

1. Install Python 3.10 or newer and make sure `python` is on `PATH`.
2. Run [`START_WEBSITE.bat`](./START_WEBSITE.bat).
3. The launcher builds the site, starts the local CAD and telemetry services,
   opens the website in your browser, and keeps the preview running until you
   press Ctrl+C in the launcher window.

The launcher reports the website port (8765), CAD viewer port (3245), and
digital-twin WebSocket port (8888). The URDF hand viewer is inside the website's
Digital Twin section. Running the launcher again reuses the preview when all
three Aero Hand services are already healthy. Close the original launcher
window to stop services started by that window.

The site can also be opened directly at
[`source-aero-hand-main/simulation/index.html`](./source-aero-hand-main/simulation/index.html).
Interactive CAD and live telemetry require the local services started by the
batch launcher.

## Share or download the project

After this folder is published to GitHub, others can clone or download it. On
Windows, they can start the local demo by running `START_WEBSITE.bat`; Python,
the `websockets` package, and `cadgen==0.7.10` are required. The launcher checks
the required ports (8765, 3245, and 8888), starts the website, CAD viewer, and
synthetic digital-twin services, and opens the preview. Press Ctrl+C in the
launcher window to stop them.

The viewer endpoints bind to the local machine. This project is intended for a
local preview; sharing the repository does not publish those running services
to the internet.

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
