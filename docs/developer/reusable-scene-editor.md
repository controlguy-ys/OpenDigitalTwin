# Reusable Scene Editor

This guide defines the durable boundaries of the lightweight Project V3 Scene
Editor. It describes current behavior, not future vendor desktop software parity.

## Scene Entity hierarchy

`scene.entities` is the only durable owner of placement and visibility for the
active Robot and external Scene items. Every Entity stores an ID, kind, optional
parent, Local Pose, and persisted visibility. Geometry and status stay in their
Robot/Object/Equipment records and are referenced by the Scene Entity.

```text
MCP scene root (implicit)
├─ Robot, or Linear Axis
│  ├─ Robot (optional attachment)
│  └─ one Object or Group carriage (optional)
├─ Group
│  └─ Objects or built-in Equipment
└─ ungrouped Objects and Equipment
```

Rules enforced before publication:

- `parentId: null` means directly under the MCP Scene root.
- The single Linear Axis is MCP-relative and has no parent.
- The Robot is MCP-relative or a direct Linear Axis child.
- A Group is MCP-relative or the single Axis carriage.
- Objects are MCP-relative, Group children, or the direct Axis carriage.
- Groups cannot contain Groups; parent cycles and missing parents are invalid.
- The Axis has at most one carriage Entity and the one active Robot.
- An OPC UA-owned transform remains MCP-level until ownership changes to Manual.

Grouping, reparenting, ungrouping, and Robot attach/detach calculate a new Local
Pose from the prior World Pose. The visible Entity therefore does not jump.

Persisted Hide is inherited through ancestors. Isolate is a transient browser
view filter: it is cleared by Show All or reload and never enters Project V3.

## MCP, Local, and World transforms

The editor distinguishes storage, derivation, and display:

- **MCP:** the existing Scene root. A root Entity's Local Pose is MCP-relative.
- **Local:** the durable Pose relative to MCP, a Group, or the Linear Axis moving
  frame. This is what the Inspector edits.
- **World:** a derived, read-only Pose after composing MCP, parents, and any Axis
  translation. It is never a second persisted transform owner.

For a normal parent:

```text
EntityWorld = ParentWorld * EntityLocal
```

For an Axis child:

```text
MovingWorld = AxisBaseWorld * Translate(AxisDirection * CurrentPosition)
ChildWorld  = MovingWorld * ChildLocal
```

All domain distances are metres internally. The Inspector displays and accepts
millimetres. Rendering-coordinate adaptation remains below the Scene domain and
must not leak into Project records.

## Orientation convention

The normalized Quaternion in `localPose.quaternion` is authoritative. The UI
converts it to and from Roll/Pitch/Yaw degrees using intrinsic Z-Y-X. Euler
values are an input/display representation only; they are not accumulated as
the internal orientation state.

Project and UI code must use the shared quaternion/RPY helpers. A component must
not introduce a different Euler order or independently negate axes.

## Objects, STEP imports, and limits

One imported Object file is one whole STEP Asset. Its first Instance and Scene
Entity are published in the same Project mutation. Duplicate reuses the Asset
and creates only a new Instance/Entity. Box and Cylinder primitives use no STEP
bytes but consume general Asset/Instance and render budgets.

| Budget | Hard limit | Advisory threshold |
| --- | ---: | ---: |
| STEP Object Assets | 64 | 52 |
| Object Assets, all kinds | 256 | budget-specific |
| Object Instances | 256 | 205 |
| STEP bytes per Object Asset | 50 MiB | budget-specific |
| Triangles per Object Asset | 250,000 | budget-specific |
| Meshes / materials per Asset | 64 / 32 | budget-specific |
| Visible render items | 1,024 | budget-specific |
| Visible status overlays | 128 | presentation cull, not rejection |
| Project STEP bytes | 256 MiB | budget-specific |
| Visible Scene triangles | 1,500,000 | budget-specific |

The 64-Asset and 256-Instance exact boundaries are accepted. A 65th STEP Asset
is blocked before STEP parsing/source staging. A 257th Instance is rejected
without replacing the active revision. Threshold warnings do not block the
operation.

Robot import has a separate mapping contract: a new Robot currently requires
the seven `LINK00`-`LINK06` STEP mappings. The Object 64-STEP-Asset limit does
not change that Robot rule.

## Linear Axis limitation

Project V3 supports at most one manual Linear Axis. Direction is exactly X, Y,
or Z; min, max, home, and current positions are finite metres and must satisfy
`min <= home/current <= max`.

The operator creates the Axis from **Add > Linear Axis**. The initial Axis is a
manual X Axis with a 0 to 2 metre range and zero home/current position. Its
context menu opens Axis settings, moves it Home, assigns or clears one carriage,
and attaches or detaches the Robot. Ownership-changing actions require explicit
confirmation and World pose is preserved for attach/detach.

The Axis is a deterministic moving coordinate frame, not a physical motor.
There is no mass, force, acceleration, drive model, axis chain, second Axis, or
OPC UA Axis subscription UI in this stage. A small scalar source boundary keeps
later read-only integration possible without changing Scene transform math.

## Mount-contact semantics

The Project stores an explicit Robot base Link and optional mount-surface
collision Entity. If both references are valid, that one derived pair is
evaluated and reported as mount contact, separately from collision and
near-miss findings. It is not inserted into user ignored pairs.

An incomplete or invalid mount configuration exempts nothing. Adjacent Robot
Link topology exclusions and user ignored pairs remain separate policies.

The Robot Inspector exposes the durable configuration directly. The base Link
is selected from `LINK00` through `LINK06`; the mount surface is selected from
the currently registered non-Robot collision surfaces. Save may intentionally
publish an incomplete configuration, while Clear publishes no mount contact.

## Context actions and operator feedback

The right-click menu is type-specific. Robot actions cover focus, base pose,
Axis attachment, visibility/isolation, and Robot configuration. Object actions
cover focus, rename/duplicate, pose, grouping/carriage, visibility/isolation,
and deletion. Group actions operate on the Group or its contents. Axis actions
cover focus, naming/settings, Home, carriage, Robot attachment, visibility, and
deletion when detached. Empty space offers only Group/Box/Cylinder creation and
Fit All. Actions invalid for the selected type or attachment state are omitted.
Paste remains visible but disabled when no transform is copied or OPC UA owns
the transform. Destructive deletion, Ungroup with children, and OPC UA-to-Manual
ownership changes require confirmation; ordinary visibility, manual carriage,
and Robot attachment actions do not.

The Axis carriage chooser lists Groups and Manual-owned Objects only. Choosing
`Set as Carriage` directly on an OPC UA-owned Object first offers the explicit
OPC UA-to-Manual confirmation. The chooser uses the same modal lifecycle as
confirmation dialogs: portal rendering, background inertness, initial focus,
Tab/Shift+Tab trapping, Escape, opener-focus restoration, and in-dialog errors.

Warnings and operation failures are delivered through a transient UI feedback
store and rendered with `role="status"` or `role="alert"`. Starting an operation
clears the prior message; a warning emitted by that operation remains until the
operator dismisses it or starts another operation. Feedback never enters the
Project snapshot, revision store, source blobs, or `.wdtwin` archive.

## Project content versus browser preferences

Project V3 Save/Export/Import/reload includes:

- Scene hierarchy, Local Poses, and persisted visibility;
- Robot sources, mechanics, Geometry, base Entity, Jobs, and Poses;
- Object Assets/Instances and built-in Equipment state;
- Linear Axis configuration and attachment references;
- mount contact, collision policy, Frames, and OPC UA bindings.

Browser-local state includes:

- Light/Dark/System theme;
- camera position/orientation, pivot, projection, and zoom;
- coordinate-layer visibility and Pose/Gizmo frame display choices;
- drawer state, sidebar split, active bottom tab, selection, and Isolate.

Home View changes only camera state. Browser preferences must never be added to
the Project snapshot or `.wdtwin` archive.

## Mutation and failure boundary

Durable editor commands must go through `ProjectMutationService` via the Scene
or Job command services. A command builds and validates a complete detached
candidate, commits its required source ownership, then publishes one revision.
Errors retain the previous pointer and published Scene runtime; no component may
write a parallel durable transform or visibility store.

## Deliberately excluded

- Multi-Robot scenes and Robot-to-Robot coordination.
- Nested Groups, multi-selection, and arbitrary hierarchy depth.
- IK, Cartesian jog, path authoring, dynamics, physics response, acceleration,
  jerk, and safety-rated validation.
- Automatic STEP assembly splitting, semantic Joint extraction, or mesh
  simplification/repair through an AI/API conversion service.
- More than one Linear Axis, axis chaining, or a physical drive model.
- OPC UA writes, controller commands, credentials/certificates, and internet
  exposure.

Geometry Proxy Collision is a deterministic geometric planning aid. It is not a
physics engine, vendor controller software/vendor safety system replacement, or safety function.
