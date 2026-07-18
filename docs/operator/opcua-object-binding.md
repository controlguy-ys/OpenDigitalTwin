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
leaves Status manual, and **Take Manual Control** returns only the transform to
manual ownership while retaining a configured OPC UA Status binding.

## Configure an Object

1. Select a Box, Cylinder, or imported STEP Object and open its Inspector.
2. Expand **OPC UA Pose Binding** and provide the external endpoint URL and a
   whole-number publishing interval of at least 50 ms.
3. Select `m` or `mm` for X/Y/Z. `m` is passed through; `mm` is multiplied by
   `0.001` before the project stores metres. Roll, Pitch, and Yaw are degrees.
4. Enter all six Node IDs, and optionally a Status Node ID, then choose **Bind
   OPC UA Pose**.

The Project switches from Off to Client when needed; if it was Server, it
switches to Bridge so Robot Actual Server values remain available. The Gateway
connects outward to the supplied endpoint. It does not expose those Object nodes
from its own Server namespace.

## Ownership and runtime behavior

While the Object transform is OPC UA-owned, the Inspector's manual XYZ/RPY
fields and the viewport move gizmo are disabled. The displayed transform is the
latest runtime pose. Choose **Take Manual Control** deliberately to remove the
transform binding and restore manual fields/gizmo placement.

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
- The browser connects to the Gateway over same-origin `/runtime/`, including
  the `/runtime/ws` WebSocket. In Docker, Nginx proxies that WebSocket upgrade.
- Docker must be able to route from `runtime-gateway` to the external OPC UA
  Server. The published `4840` port is needed only for Server/Bridge inbound
  Robot Actual clients, not for Client-only outbound connections.

This feature never writes OPC UA values, calls OPC UA methods, starts motion,
transfers to a PLC, or provides a safety function. Authentication,
authorization, TLS, signing/encryption, certificate trust workflows, and
public-internet hardening remain out of scope.
