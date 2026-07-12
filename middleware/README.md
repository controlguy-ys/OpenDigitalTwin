# OPC UA Connector MVP

This middleware is an OPC UA **client** and a browser-facing WebSocket gateway.
It performs read-only polling for six joint-angle nodes and optional numeric
equipment status nodes.

The short-term build intentionally supports only:

- anonymous OPC UA sessions;
- `SecurityPolicy.None`;
- `MessageSecurityMode.None`;
- read-only `Value` attribute polling;
- WebSocket output on `ws://127.0.0.1:4841` by default.

Edit `opcua.config.json` with the server endpoint and NodeIds, then run:

```powershell
npm run middleware:opcua
```

Set `OPCUA_CONFIG` to use another JSON config path. Set
`VITE_OPCUA_GATEWAY_URL` before building the web client when the gateway URL is
not `ws://127.0.0.1:4841`.
