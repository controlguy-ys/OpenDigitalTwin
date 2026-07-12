# Fixed Coordinate Frames

## Hierarchy

The workcell uses one fixed chain:

```text
World
└─ MCP
   ├─ Robot Base → Joints → Flange → TCP → Gripper / held Object
   └─ Object Instances
```

MCP means Machine-Centric Point: the shared origin and orientation of the
machine workcell. Moving MCP carries the Robot and all non-held Objects while
their MCP-local values remain unchanged.

## Editing

Open **Coordinate Frames** in the top bar. Select a frame and enter position in
millimetres and rotation as Roll, Pitch, Yaw in degrees.

| Frame | Reference | Editable |
| --- | --- | --- |
| World | fixed application root | No |
| MCP | World | Yes |
| Robot Base | MCP | Yes |
| Flange | derived from the six joints | No |
| TCP | Flange | Yes |

Press **Apply frame** to commit an edit. Object XYZ/RPY values in the Equipment
Inspector are relative to MCP. The Robot Base fields retain the existing
workbench compatibility mount, so they act as an additional MCP-local base
offset rather than replacing that mount.

## Coordinate convention

- Internal length: metres; UI length: millimetres.
- Internal angle: radians; UI angle: degrees.
- Right-handed, Z-up coordinates.
- Quaternion storage order: `[x, y, z, w]`.
- RPY conversion order: extrinsic ZYX representation (`yaw`, then `pitch`, then
  `roll` in matrix composition).
- A stored transform is `T_parent_child`: a child pose expressed in its parent.

## Runtime and persistence

The Flange follows forward kinematics. TCP is a local offset under Flange, so
the gripper, grasp sensor, and held Object follow TCP without changing joint
angles. On release, the rendered world pose is converted once to MCP-local
coordinates before it is stored.

MCP, Robot Base, TCP, and Object local transforms are included in Save, Export,
and Import. Identity MCP/TCP preserves older V1 project placement.

## Current limits

This release supports one World, one MCP, one six-axis Robot, and one TCP. It
does not provide frame reparenting, multiple named TCPs, inverse kinematics,
Cartesian jogging, or OPC UA writes.
