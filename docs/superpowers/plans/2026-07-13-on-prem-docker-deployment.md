# On-Prem Docker Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a tested Docker Compose package that serves RobotSim through unprivileged Nginx and optionally runs the read-only OPC UA connector behind a same-origin WebSocket proxy.

**Architecture:** Build the Vite SPA in a pinned Node stage and serve only `dist/` from unprivileged Nginx. Resolve the browser gateway URL at runtime from `window.location`, proxy `/opcua` through Nginx to a separate profile-gated Node connector, and expose independent web/connector health checks. Validate deployment contracts statically and then exercise real Docker images and containers.

**Tech Stack:** Docker Engine 27, Docker Compose 2, Node 22 Alpine, nginxinc/nginx-unprivileged Alpine, React 19, TypeScript 6, Vitest 4, Playwright 1.61.

## Global Constraints

- Trusted on-premise LAN only; no public-internet exposure.
- OPC UA remains anonymous, `SecurityPolicy.None`, `MessageSecurityMode.None`, and read-only.
- One web service is always available; the connector is optional through Compose profile `opcua`.
- Containers run non-root, drop all capabilities, set `no-new-privileges`, use read-only root filesystems, and declare only required `tmpfs` paths.
- `WEB_PORT` defaults to `8080`; internal web port is `8080`, connector WebSocket port is `4841`, and connector health port is `8081`.
- The browser runtime default is same-origin `/opcua`; `VITE_OPCUA_GATEWAY_URL` remains an explicit build override.
- Preserve all existing local development and project export/import behavior.
- Use TDD for executable behavior and focused commits per task.

---

### Task 1: Runtime OPC UA Gateway URL

**Files:**
- Create: `src/features/joints/opcua-gateway-url.ts`
- Create: `src/features/joints/opcua-gateway-url.test.ts`
- Modify: `src/features/joints/OpcUaJointSource.ts`
- Modify: `src/features/joints/OpcUaJointSource.test.ts`

**Interfaces:**
- Produces: `resolveOpcUaGatewayUrl(override: string | undefined, location?: Pick<Location, 'protocol' | 'host'>): string`.
- Consumes: the helper when constructing the singleton `opcUaJointSource`.

- [ ] **Step 1: Write failing tests** proving explicit override wins, HTTP maps to `ws://host/opcua`, HTTPS maps to `wss://host/opcua`, and missing browser location falls back to `ws://127.0.0.1:4841`.
- [ ] **Step 2: Run** `npm run test:run -- src/features/joints/opcua-gateway-url.test.ts`; expect missing-module RED.
- [ ] **Step 3: Implement** the pure resolver, trim non-empty overrides, reject unsupported protocols by using the local fallback, and update the singleton without changing the injectable `OpcUaJointSource` constructor.
- [ ] **Step 4: Run** `npm run test:run -- src/features/joints && npm run lint && npm run build`; expect GREEN.
- [ ] **Step 5: Commit** as `feat: resolve OPC UA gateway from deployment origin`.

---

### Task 2: Connector Health and Testable Configuration

**Files:**
- Create: `middleware/opcua-config.mjs`
- Create: `middleware/opcua-config.test.ts`
- Modify: `middleware/opcua-connector.mjs`
- Modify: `middleware/opcua.config.json`
- Modify: `package.json`

**Interfaces:**
- Produces: `validateOpcUaConnectorConfig(value)`, `readOpcUaConnectorConfig(path)`, connector HTTP `GET /healthz`, and script `test:middleware`.
- Consumes: `OPCUA_CONFIG`, `OPCUA_HEALTH_PORT`, existing WebSocket and OPC UA polling behavior.

- [ ] **Step 1: Write failing tests** for valid config normalization and rejection of missing six joints, invalid ports, non-positive intervals, blank NodeIds, and non-finite scale/offset.
- [ ] **Step 2: Run** `npm run test:run -- middleware/opcua-config.test.ts`; expect missing-module RED.
- [ ] **Step 3: Implement** pure validation and file reading. Refactor the connector to use it, start a Node HTTP server on health port `8081`, return `200 text/plain` from `/healthz`, return `404` elsewhere, and close it during SIGINT/SIGTERM shutdown.
- [ ] **Step 4: Add** `healthPort: 8081` to the example config while allowing `OPCUA_HEALTH_PORT` to override it.
- [ ] **Step 5: Run** middleware tests plus existing OPC UA source tests and lint; expect GREEN.
- [ ] **Step 6: Commit** as `feat: add OPC UA connector health endpoint`.

---

### Task 3: Web Image, Nginx, Compose, and Static Contracts

**Files:**
- Create: `.dockerignore`
- Create: `Dockerfile`
- Create: `deploy/nginx.conf`
- Create: `middleware/Dockerfile`
- Create: `compose.yaml`
- Create: `scripts/deployment/validate-deployment.mjs`
- Create: `scripts/deployment/validate-deployment.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: scripts `deploy:validate`, `deploy:build`, and `deploy:smoke`; images `robotsim-web` and `robotsim-opcua-connector`.
- Consumes: Vite `dist/`, root lockfile, Nginx variable-based connector upstream, and mounted JSON configuration.

- [ ] **Step 1: Write failing static contract tests** that call `validateDeploymentFiles(root)` and assert required files, multi-stage pinned Node build, unprivileged Nginx, SPA fallback, `/healthz`, `/opcua` Upgrade proxy, immutable asset caching, connector profile, read-only config mount, non-root users, capability drops, read-only filesystems, health checks, limits, and no privileged/host-network/Docker-socket settings.
- [ ] **Step 2: Run** `npm run test:run -- scripts/deployment/validate-deployment.test.ts`; expect missing-module RED.
- [ ] **Step 3: Implement** the pure deployment validator with actionable errors, then add the Docker/Nginx/Compose files satisfying the contract. Use `node:22-alpine` and `nginxinc/nginx-unprivileged:1.27-alpine`; expose only host `${WEB_PORT:-8080}:8080`.
- [ ] **Step 4: Configure** Nginx Docker DNS (`127.0.0.11`) and variable target `http://opcua-connector:4841` so web-only startup succeeds without resolving the optional service at config load.
- [ ] **Step 5: Add** package scripts and run `npm run deploy:validate`, `docker compose config`, `docker compose --profile opcua config`, and focused tests.
- [ ] **Step 6: Commit** as `feat: package RobotSim for Docker Compose`.

---

### Task 4: Real Container Smoke Test and Operator Documentation

**Files:**
- Create: `scripts/deployment/smoke-deployment.mjs`
- Create: `docs/operator/docker-deployment.md`
- Modify: `README.md`
- Modify: `docs/progress/2026-07-13-short-term-mvp-implementation.md`
- Modify: `docs/superpowers/plans/2026-07-13-on-prem-docker-deployment.md`

**Interfaces:**
- Produces: one deterministic smoke command that builds, starts, probes, and tears down a uniquely named Compose project.
- Consumes: Docker CLI, Compose, web `/healthz`, connector `/healthz`, and existing Playwright SPA behavior.

- [ ] **Step 1: Write smoke-script argument/unit tests** for unique project naming, cleanup-on-failure, web-only command order, and optional connector-profile command order by injecting a command runner and HTTP probe.
- [ ] **Step 2: Run** focused smoke tests and verify RED before implementing the orchestration module.
- [ ] **Step 3: Implement** `smokeDeployment({ includeOpcUa, run, fetch, port })`: build images, run `nginx -t`, start Compose, wait with bounded polling for web health, load `/`, optionally check connector health from its container, and always execute `docker compose down --volumes --remove-orphans`.
- [ ] **Step 4: Run real gates:** `npm run deploy:validate`, `npm run deploy:smoke`, `npm run deploy:smoke -- --opcua`, and confirm cleanup leaves no project containers.
- [ ] **Step 5: Document** prerequisites, web-only and profile commands, configuration mount, health checks, logs, update, rollback, `.wdtwin` backup, shutdown, resource tuning, trusted-LAN boundary, and OPC UA failure behavior.
- [ ] **Step 6: Run final gates:** `npm run verify`, `npm run test:e2e`, `npm audit --audit-level=high`, `docker compose config`, both smoke modes, and `git diff --check`.
- [ ] **Step 7: Commit** as `docs: verify on-prem Docker deployment`.

## Self-Review

- Spec coverage: web build, SPA routing, runtime WebSocket resolution, optional connector, health separation, hardening, operator workflow, and Docker-backed verification are assigned to explicit tasks.
- Scope: TLS, authentication, secure OPC UA, writes, Kubernetes, server-side project storage, and public-internet deployment remain excluded.
- Placeholder scan: every step names concrete files, interfaces, commands, and expected behavior.
- Type consistency: the URL resolver, connector config validator, deployment validator, and smoke runner each expose one testable boundary used by the next task.
