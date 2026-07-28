---
name: opcua-runtime-diagnostics
description: Diagnose configured OpenDigitalTwin OPC UA Runtime Gateway health, readiness, endpoint state, and mapping faults through read-only checks. Use for Runtime Gateway connection or integration diagnosis; preserve saved Project configuration and never issue external OPC UA writes.
---

1. Read `AGENTS.md` and the active Project V5 Runtime Gateway configuration before diagnosing an endpoint.
2. Run `npm run build:gateway`, then start or check the configured Gateway without changing persisted Project configuration.
3. Inspect these exact read-only endpoints: `/healthz`, `/readyz`, `/runtime/status`, and `/runtime/integration-diagnostics`.
4. Correlate the active Project revision, Browser publisher lease, endpoint connection state, subscriptions, mapping quality, and reported errors.
5. For disconnect/reconnect diagnosis, preserve the saved Project configuration and ownership metadata; report the observed lifecycle state and bounded recovery guidance.
6. Never issue an external OPC UA write, physical PLC action, Robot action, or persisted Project configuration change.
