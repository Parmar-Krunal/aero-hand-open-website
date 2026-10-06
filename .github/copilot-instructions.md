# Repository instructions for GitHub Copilot

## Starting the complete local demo

When asked to download, run, preview, or start this project, clone the public
repository if it is not already present, then start all services together with
Docker Compose from its root:

```sh
git clone https://github.com/Parmar-Krunal/aero-hand-open-website.git
cd aero-hand-open-website
docker compose -f source-aero-hand-main/compose.yaml up --build
```

On Windows, ensure Docker Desktop is running before starting containers. If
`docker compose` fails because the Compose plugin is missing (for example,
`unknown shorthand flag: 'f' in -f`), use the standalone executable:

```powershell
docker-compose -f source-aero-hand-main\compose.yaml up --build
```

Do not start only the static website or only one service. This Compose file
starts the website (port 8765), CAD viewer (port 3245), and synthetic
digital-twin WebSocket (port 8888). Once started, open
<http://localhost:8765/simulation/index.html>. Keep the terminal attached to
view service logs; Ctrl+C stops the stack. For detached startup, add `-d` and
later stop the stack with:

```sh
docker compose -f source-aero-hand-main/compose.yaml down
```

When using standalone Compose, replace `docker compose` with `docker-compose`
in the stop command as well.

If Docker is unavailable, on Windows run `START_WEBSITE.bat` instead. It
requires Python 3.10+, `websockets`, and `cadgen==0.7.10`; the launcher installs
missing Python packages and starts the full local stack.

Before starting, check whether the required ports are already occupied. If this
project's complete healthy stack is already running, reuse it rather than
starting duplicates or killing processes. If a port is occupied by an
unrecognized service, report the conflict and ask the user to resolve it.

These services are configured for local use only. The digital twin uses
synthetic dry-run data and does not connect to physical hardware. Do not imply
that downloading or running this repository deploys it publicly.

## Project boundaries

- Preserve the website's links to the CAD viewer and digital-twin WebSocket.
- Keep `source-aero-hand-main/compose.yaml` and its Dockerfile in sync when
  changing service commands, dependencies, or ports.
- The website source is in `source-aero-hand-main/simulation/site_src/`.
  Rebuild generated website pages with
  `python source-aero-hand-main/simulation/build_website.py`.
- Do not delete engineering assets used by the website, CAD viewer, URDF
  viewer, or download links.
