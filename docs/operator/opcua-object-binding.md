# Object OPC UA Live Binding

## Purpose and scope

An Object is a generic SpatialEntity: a Box, Cylinder, or imported STEP asset.
While its transform owner is `manual`, use the Object Inspector's local XYZ/RPY
fields or the move gizmo to place it. This is visualization configuration, not
Robot or PLC control.

In **Client** or **Bridge** mode, the Object Inspector can make an external OPC
UA endpoint own an Object transform. It creates a read-only subscription for six
OPC UA `Double` nodes:

| Field | Project target |
| --- | --- |
| X, Y, Z | Object position |
| Roll, Pitch, Yaw | Object orientation in degrees |

An optional `Double` Status node supplies the Object's numeric status overlay.
Status ownership is separate from transform ownership: binding no Status node
leaves Status manual, and confirmed **Take Manual Ownership** removes conflicting
read mappings in the selected ownership scope.

## Configure an Endpoint and Binding

1. Open **Connectivity > OPC UA Settings**. Add or edit the shared Client
   Endpoint once, including its URL, publishing interval, reconnect policy, and
   enabled state. Choose Client or Bridge in this dialog; menu clicks do not
   change runtime role.
2. Open **Connectivity > Connection Monitor** and confirm the intended Endpoint
   has an active Session and Subscription. The compact header polls every 10
   seconds; an open monitor polls every 2 seconds.
3. Right-click a Box, Cylinder, or imported STEP Object and choose **Open
   Binding**, or open **Connectivity > Binding Overview** and select its moving
   frame or numeric Status target.
4. Select the shared Endpoint and enter a stable Node Address as Namespace URI,
   Identifier type, and Identifier. A pasted `ns=N;...` address is accepted only
   while a matching Browse Session is active and is immediately resolved to the
   current Namespace URI.
5. For Object Pose, map six source leaf paths to the fixed Project destinations
   X, Y, Z, Roll, Pitch, and Yaw. Project position is metres and orientation is
   degrees. Save applies the Mapping and source ownership in one Project
   mutation.

The same editor supports Object Status, Robot Joints, Robot frames, and Robot
Status. Removing a Mapping does not silently claim Manual ownership. Use the
separate, confirmed **Take Manual Ownership** action when manual control is
intended; it removes conflicting read mappings and changes ownership atomically.

## Run the bundled ObjectPos demo Server

The repository includes a deterministic local OPC UA Server that mirrors the
B&R `Sample6X:ObjectPos[0..19]` structure used by the bulk binding command. Run
the Server, Gateway, and web application in separate terminals:

```powershell
npm run demo:opcua-server

npm run build:gateway
npm run runtime:gateway

npm run dev -- --host 127.0.0.1 --port 5173
```

In the application, configure `opc.tcp://127.0.0.1:4840` as a shared Endpoint
in **OPC UA Settings**, then create Object moving-frame mappings from **Binding
Overview**. The demo Server's Namespace URI is
`http://br-automation.com/OpcUa/PLC/PV/`; its current namespace index is not a
persisted contract. XYZ is millimetres at the source and RPY is degrees. It is
an anonymous Security Policy None endpoint for local testing, not a production
security configuration.

## Ownership and runtime behavior

While the Object transform is OPC UA-owned, the Inspector's manual XYZ/RPY
fields and the viewport move gizmo are disabled. The displayed transform is the
latest runtime pose. Choose **Take Manual Ownership** deliberately to remove
conflicting read mappings and restore manual fields/gizmo placement.

The six pose leaves form one coherent mapping. The Client converts RPY to the
project quaternion and the browser samples the retained poses with deterministic
shortest-quaternion interpolation. Arrival sequence and timestamps are checked;
out-of-order data is ignored. On bad quality or an invalid value, the latest
valid pose/status remains visible while its reported quality/status code changes.
If updates stop, the retained value becomes `STALE` after the greater of one
second or three publishing intervals, with `BadNoCommunication`.

The optional Status mapping is independent: it retains its latest valid numeric
value and has its own quality/staleness state. A transform bind without Status
does not take Status ownership.

## Modes, networking, and safety

- **Client** creates outbound, read-only OPC UA subscriptions for configured
  mappings.
- **Bridge** runs the Client plus the read-only Server namespace for Robot
  Actual Joint values.
- If another OPC UA Server already owns the Gateway's configured Server port,
  use **Client** mode. Bridge also starts the Robot Actual Server and cannot
  share one TCP listen port with the external Server.
- The browser connects to the Gateway over same-origin `/runtime/`, including
  the `/runtime/ws` WebSocket. In Docker, Nginx proxies that WebSocket upgrade.
- Docker must be able to route from `runtime-gateway` to the external OPC UA
  Server at host port `4840`. The separately published Gateway Server port
  `4841` is used only for Server/Bridge inbound Robot Actual clients.

This feature never writes OPC UA values, calls OPC UA methods, starts motion,
transfers to a PLC, or provides a safety function. Authentication,
authorization, TLS, signing/encryption, certificate trust workflows, and
public-internet hardening remain out of scope.

An endpoint being connected does not prove mapped values are readable. If the
Server returns `BadUserAccessDenied`, the Binding remains saved and ownership
stays OPC UA-controlled, but the Object retains its latest valid pose/status.
Grant read access to the mapped variables or return the Object to manual control;
do not treat a connected Gateway indicator as a successful live-value test.
