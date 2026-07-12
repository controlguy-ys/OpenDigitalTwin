# Docker On-Prem Deployment

## Prerequisites

- Docker Engine 27 or newer.
- Docker Compose v2.
- A trusted factory LAN. This package does not configure TLS, authentication,
  secure OPC UA, or public-internet protection.

## Web-only deployment

```powershell
docker compose up -d --build web
docker compose ps
Invoke-WebRequest http://127.0.0.1:8080/healthz
```

Open `http://<docker-host>:8080/`. Change the published port when required:

```powershell
$env:WEB_PORT = '9080'
docker compose up -d --build web
```

The Web container serves the SPA and remains usable in Simulation mode without
the OPC UA profile.

## Web plus OPC UA Connector

Copy [`middleware/opcua.config.json`](../../middleware/opcua.config.json) to an
operator-owned location and edit:

- `endpointUrl`;
- exactly six ordered `J1` through `J6` NodeIds;
- scale and offset for each joint;
- optional Object status mappings;
- sampling and reconnect intervals.

The endpoint is resolved from inside the Connector container. On Docker
Desktop, use `host.docker.internal` to reach an OPC UA server running on the
Docker host. For another factory device, use its LAN DNS name or IP address.
Do not use `127.0.0.1` unless the OPC UA server is in the same container.

```powershell
$env:OPCUA_CONFIG_PATH = 'C:\RobotSim\opcua.config.json'
docker compose --profile opcua up -d --build --wait
docker compose --profile opcua ps
```

The browser connects to the same-origin `/opcua` path. Nginx upgrades and
proxies that connection to the Connector, so no browser-side host address is
baked into the image. An explicit `VITE_OPCUA_GATEWAY_URL` build override
remains available for special deployments.

## Health and diagnostics

Web health is independent from PLC availability:

```powershell
Invoke-WebRequest http://127.0.0.1:8080/healthz
docker compose --profile opcua logs --tail 200 web
docker compose --profile opcua logs --tail 200 opcua-connector
docker compose --profile opcua ps
```

- Web `healthy`, Connector omitted: Simulation mode is available; OPC UA mode
  cannot connect.
- Connector `healthy`, OPC UA server unavailable: the process retries and the
  browser receives BAD joint quality. The container remains healthy.
- Connector restarting: inspect configuration validation, read-only mount, and
  NodeId errors in its logs.
- `/opcua` returns a gateway error when the optional Connector is not running;
  `/healthz` and the rest of the application remain available.

## Validation before deployment

```powershell
npm run deploy:validate
docker compose config --quiet
docker compose --profile opcua config --quiet
npm run deploy:smoke
npm run deploy:smoke:opcua
```

The smoke commands use a unique Compose project, build the images, run
`nginx -t`, wait for service health, probe the application, and always remove
their containers and network.

## Updating and rollback

Before replacement, export every required browser project as `.wdtwin`. Project
state lives in each browser's IndexedDB and is not a server-side Docker volume.

```powershell
git pull --ff-only
docker compose --profile opcua build --pull
docker compose --profile opcua up -d --wait
```

For rollback, check out the previously validated Git revision, rebuild, and
start the same profile. Import the `.wdtwin` archive in the browser if its local
storage was cleared or a different workstation is used.

## Resource tuning

The checked-in defaults bound CPU, memory, and process counts. Increase limits
in an operator-maintained Compose override only after measuring STEP scene
complexity and browser performance. The browser performs rendering and stores
projects locally; the Nginx container does not process uploaded STEP bodies.

## Shutdown

```powershell
docker compose --profile opcua down
```

Add `--volumes` only when intentionally removing Compose-managed temporary
state. Export `.wdtwin` files before clearing browser data or retiring a client
workstation.

## Safety boundary

The Connector performs OPC UA reads only. This package does not start Robot
motion, transfer to a PLC, write variables, implement a safety function, or
make the application suitable for public-internet exposure.
