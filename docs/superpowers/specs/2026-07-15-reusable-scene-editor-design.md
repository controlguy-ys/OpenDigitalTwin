# Reusable Scene Editor Design

**Status:** Approved design, awaiting implementation planning
**Target:** `codex/webdt-v3-next-stage` and the in-development Project V3 model

## Purpose

Turn the current Robot simulation into a reusable desktop Web workcell editor
without adding a general-purpose 3D engine. The result keeps one six-axis Robot,
adds simple Scene organization and one external linear axis, makes Robot Jobs
discoverable, and removes persistent false Collision findings for intentional
Robot mounting contact.

## Goals

- Group imported Objects and built-in Equipment in one-level Groups.
- Hide or show the complete Robot, individual Objects, Groups, and Linear Axis.
- Edit Robot, Object, and Group XYZ/Roll/Pitch/Yaw from a common Inspector.
- Mount the Robot and one user-selected carriage Object or Group on one Linear
  Axis whose direction is X, Y, or Z.
- Expose Robot Job creation in the permanently visible left Sidebar.
- Remove page-level scrolling and provide equivalent Light and Dark themes.
- Provide useful, target-specific right-click commands.
- Bound imported STEP Assets and Object Instances independently of existing
  byte, mesh, material, and triangle budgets.
- Model intentional Robot mounting contact explicitly instead of hard-coding an
  ABB-specific collision exception.

## Explicit exclusions

- Multiple Robots.
- Nested Groups or a general unrestricted Scene graph.
- Multi-selection and drag-and-drop hierarchy editing in this stage.
- More than one Robot Linear Axis or chained external axes.
- Arbitrary axis vectors; only X, Y, and Z are supported.
- OPC UA binding for the Linear Axis in this stage.
- Physics, motor dynamics, acceleration, jerk, or safety-rated collision.
- Automatic Robot base-link or mount-surface inference.
- Automatic STEP assembly splitting or AI-assisted mapping.
- A plug-in framework for Context Menu commands.
- Compatibility or adoption paths for superseded project formats.

## 1. Common Scene Entity model

Placement, hierarchy, and visibility have one authoritative owner. Robot
Mechanics, Object Asset metadata, status, and collision geometry remain in their
existing domain records and are referenced by ID.

```ts
type SceneEntityKind = 'robot' | 'object' | 'group' | 'linear-axis'

interface ScenePoseV1 {
  positionM: readonly [number, number, number]
  quaternion: readonly [number, number, number, number]
}

interface SceneEntityBaseV1 {
  id: string
  name: string
  kind: SceneEntityKind
  parentId: string | null
  localPose: ScenePoseV1
  visible: boolean
}
```

The stored Quaternion is authoritative. UI Roll/Pitch/Yaw values are degrees and
use the existing ZYX convention. Scale is not inherited through Groups or the
Linear Axis. Object Instance scale remains Object-owned; Robot, Group, and Axis
scale is fixed at one.

For this stage, `parentId: null` means the Entity is directly under the existing
MCP Scene root. World Pose is derived from MCP and the Entity hierarchy.

Entity payloads are discriminated:

- `robot` references the single active Robot configuration.
- `object` references an imported Object Instance or built-in Equipment record.
- `group` has no geometry payload.
- `linear-axis` owns its axis configuration and attachment references.

The Scene Entity state replaces duplicate placement and visibility ownership in
Robot and external-entity records while Project V3 is still under development.
No second transform is mirrored as another source of truth.

### Parent rules

- The Linear Axis is MCP-relative and cannot have a parent.
- The Robot parent is MCP or the Linear Axis.
- An Object parent is MCP, a Group, or the Linear Axis when it is the direct
  carriage visual.
- A Group parent is MCP or the Linear Axis when that Group is the carriage.
- A Group may contain Objects but never another Group.
- Parent cycles are rejected before mutation.
- The project contains at most one Linear Axis in this stage.
- The Linear Axis has at most one carriage Entity and the single Robot.

Every reparent operation is atomic. Grouping, ungrouping, attaching, and
detaching calculate the new Local Pose from the previous World Pose so the
visible Object or Robot does not jump.

## 2. Groups and visibility

Groups are created empty from the Scene Objects pane. An Object is assigned with
the Object Context Menu's **Move to Group** submenu. This stage deliberately
does not add multi-selection.

Group operations:

- Rename.
- Edit Local XYZ/RPY.
- Hide or show.
- Move a member into or out of the Group.
- Use the Group as the Linear Axis carriage.
- `Ungroup`, which removes only the Group and preserves every member World Pose.
- `Delete Group and Contents`, which requires confirmation and removes the Group
  and its members.

A Group used as the carriage cannot be ungrouped or deleted until detached.

An Object whose Transform source is OPC UA must remain MCP-level. **Move to
Group** and **Set as Carriage** require switching that Object to Manual Transform
ownership first. The Scene Entity Local Pose remains the persisted Manual
fallback; OPC UA bindings and source selection do not become another stored
Manual transform.

Persisted `visible` is separate from transient `Isolate`. Effective visibility
is the logical AND of the Entity and all ancestors. Hidden geometry does not
render, participate in Geometry Collision, or show a numeric status overlay.
Its stored transform, status, and child visibility remain unchanged.

- **Hide** is saved with the project.
- **Isolate** is session-only.
- **Show All** clears only transient Isolate suppression.
- Hiding the Robot hides the complete Robot while retaining Joint values and
  configuration.

## 3. Transform Inspector

The same Transform Inspector component serves Robot, Object, Group, and Linear
Axis placement.

- Ungrouped Entities show `Relative to: MCP`.
- Group members show `Relative to: <Group name>`.
- Axis children show `Relative to: <Axis name>`.
- Editable values are Local X/Y/Z in millimetres and Roll/Pitch/Yaw in degrees.
- Calculated World XYZ/RPY is visible but read-only.
- Invalid and non-finite values are rejected without partially changing the
  Entity.

Robot Mechanics no longer owns Base placement. Joint origins, axes, limits,
Home, velocity, Flange, TCP, and Geometry mappings remain Robot-owned.

## 4. Linear Axis

The Linear Axis is a deterministic moving Frame, not a physical motor.

```ts
interface LinearAxisConfigurationV1 {
  direction: 'x' | 'y' | 'z'
  minPositionM: number
  maxPositionM: number
  homePositionM: number
  currentPositionM: number
  carriageEntityId: string | null
  robotEntityId: string | null
}
```

All four position values must be finite. `min <= home <= max` and
`min <= current <= max` are required. Out-of-range UI input remains uncommitted
and identifies the allowed range.

```text
MovingWorld = AxisBaseWorld * Translate(Direction * CurrentPosition)
ChildWorld  = MovingWorld * ChildLocal
```

The user imports fixed rail and carriage geometry as ordinary Objects. The
fixed rail stays MCP-relative. The user selects one Object or one Group as the
moving carriage and separately attaches the Robot. If a Group is the carriage,
its member Objects remain Group-local.

Simulation provides a slider, numeric position, and **Move Home** action. A
small scalar source interface separates the Axis model from its Manual source
so a later read-only OPC UA source can supply one position without changing
Scene math. No OPC UA Node configuration or subscription UI is implemented now.

Axis motion invalidates Robot and carriage World matrices and triggers Geometry
Collision refresh. It does not invoke physics or move fixed rail geometry.

## 5. Robot Jobs and Pose Timeline

Project V3 already models `simulation.jobs` and `activeJobId`. This work exposes
that existing model instead of creating another Job representation.

The left Sidebar is vertically split:

- **Scene Objects** on top.
- **Robot Jobs** on the bottom.

The default split is 60/40. A divider may be dragged within conservative bounds,
and the user's split preference is stored in the browser, not the project.

The Robot Jobs pane always displays **+ New Job**, the Job list, Pose count, and
the active Job. Context commands are Rename, Duplicate, and Delete. Deleting a
Job requires confirmation. A project may contain zero Jobs; **Save Pose** is
disabled until a Job exists and points the user to **+ New Job**.

Selecting a Job updates `activeJobId` and displays only that Job's Poses in the
bottom Timeline. Existing Pose capture, ordering, deletion, outgoing speed,
duration, easing, and playback behavior remain unchanged. Existing V3 limits of
32 Jobs, 256 Poses per Job, and 2,048 total Poses remain in force.

## 6. Application shell and themes

The desktop work area uses a fixed grid and has no document-level scroll:

- Top command bar.
- Split Scene Objects and Robot Jobs Sidebar.
- Central 3D Viewport.
- Target-specific right Inspector.
- Full-width bottom rail.

The top bar retains Project, Add, Joint Source, quality, and Theme. Import STEP,
Import Robot, primitive creation, and Group creation move under **Add**. Robot
Mechanics, Geometry, and Coordinate Frame editors move to the selected Robot or
Frame Inspector rather than occupying permanent top-bar buttons.

The Inspector uses target-specific tabs so only one compact form is open at a
time. Tree, Job list, Inspector, and Timeline may scroll internally. Timeline
horizontal scrolling never creates a page scrollbar.

The bottom rail has mutually exclusive **Timeline** and **Collision** tabs. They
are never rendered side by side. Collision shows its current Finding count in a
badge and uses the complete rail width when opened.

Light/Dark defaults to the OS preference on first visit. A manual choice is
remembered in browser storage. Theme choice, divider position, open tabs, and
drawer state are user preferences and are not project content. Both themes use
the same semantic design tokens and layout.

## 7. Context-aware right-click menu

Commands not valid for the selected Entity are not displayed.

### Object

- Focus in View, Rename, Duplicate.
- Copy Transform, Paste Transform, Reset Transform.
- Move to Group.
- Set as Carriage when eligible.
- Hide, Isolate, Delete.

### Group

- Focus in View, Rename.
- Copy Transform, Paste Transform, Reset Transform.
- Ungroup.
- Set as Carriage when eligible.
- Hide, Isolate.
- Delete Group and Contents.

### Robot

- Focus in View.
- Copy Base Transform, Paste Base Transform, Reset Base Transform.
- Attach to Linear Axis or Detach.
- Hide, Isolate.
- Open Mechanics, Geometry, or Collision settings.

### Linear Axis

- Focus in View, Rename, Open Axis Settings.
- Move Home.
- Set or clear Carriage.
- Attach or detach Robot.
- Hide, Isolate, Delete when detached.

Delete and destructive Group commands require confirmation. Keyboard shortcuts
are limited to existing or obvious editor actions: F for Focus, H for Hide, F2
for Rename, Ctrl+D for Duplicate, Escape to clear selection, and Delete for an
eligible selected Entity.

## 8. Collision Mount Contact

The current collision core special-cases only
`robot-link:LINK00|workcell:workbench`. That assumption is not reusable for a
custom Robot or a different support. A fresh default session produces no
Finding, but a different base/body mapping or saved project policy can expose an
intentional support contact. The new model removes the Robot-specific hard-code.

Robot placement stores an explicit mount-contact configuration:

```ts
interface RobotMountContactV1 {
  baseLinkId: RobotLinkId
  mountSurfaceCollisionEntityId: CollisionEntityId | null
}
```

The user chooses both values. The mount surface references a stable Collision
participant such as `workcell:workbench` or an Object collision Entity. A
geometry-free Group is not a valid surface. A carriage Group therefore requires
selecting one member Object as the mount surface.

The derived Base Link/Mount Surface Pair is classified as `mount-contact` and:

- is omitted from Collision and Near-miss Findings;
- is not inserted into user `ignoredPairKeys`;
- is shown in the Robot Collision Inspector;
- updates immediately when either selection changes; and
- survives project Save/Load.

Adjacent Robot Links remain excluded by Robot topology. User Ignored Pairs
remain a separate project policy for intentional non-mount overlap. If the Base
Link or mount surface is missing, no implicit Pair is ignored; the Inspector
reports incomplete mount setup and normal Collision reporting continues.

## 9. Import and runtime limits

The current geometry budgets remain authoritative:

- 50 MiB and 250,000 triangles per Object STEP Asset.
- 64 meshes and 32 materials per Asset.
- 256 MiB raw STEP bytes per project.
- 1,500,000 visible Scene triangles.

Additional count limits are:

- 64 unique imported Object STEP Assets.
- 256 total Object Instances, including STEP and primitive Instances.

Duplicating an Object reuses the Asset and increments only Instance count.
Hiding an Object removes its triangles from the visible budget but not its raw
source bytes or Instance count. Import and Duplicate surfaces show a warning at
80 percent of any applicable hard budget. A rejected operation displays current
usage and the exact limit and makes no persistent change.

## 10. Persistence and transactions

Project content includes:

- Scene Entities, hierarchy, Local Poses, and persisted visibility.
- Linear Axis configuration and attachment references.
- Robot Base Link and mount-surface reference.
- Jobs, active Job, and their Poses.
- Existing Object Asset, status, OPC UA, Robot Mechanics, Geometry, Frame, and
  Collision policy data.

Theme, Isolate, panel split, open tabs, selection, and Transform previews are
not project content.

Save validates all references, parent rules, attachment rules, limits, and
mount-contact eligibility before publishing a new Project V3 revision. Load
hydrates and validates the complete candidate before replacing the active
project. Failure retains the previous active project and its Scene runtime.

## 11. Error handling

- Invalid parent, nested Group, cycle, or duplicate attachment: reject before
  mutation.
- Attached Axis, Robot, Carriage, or Group deletion: block and identify the
  required Detach action.
- Invalid Axis limits or position: retain the last committed value.
- Missing Scene Entity or payload reference on load: reject the candidate
  project atomically.
- Import or Instance cap exceeded: report current usage and limit.
- Failed Attach, Detach, or Ungroup: retain both the previous parent and World
  Pose.
- Incomplete Mount Contact: report a setup diagnostic and apply no implicit
  collision exemption.

## 12. Verification and success criteria

### Domain and Store

- Parent validation rejects cycles and nested Groups.
- Group, Ungroup, Attach, and Detach preserve World Pose within numeric tolerance.
- Effective visibility follows Entity and ancestor visibility without mutating
  child settings.
- Linear Axis X, Y, and Z calculations are correct at Min, Home, and Max.
- Axis and hierarchy mutations are atomic on validation or persistence failure.
- Save/Load round-trips Entities, Jobs, Axis attachments, visibility, and Mount
  Contact without adding another transform owner.

### Collision

- Configured Base Link/Mount Surface contact yields no Finding and does not
  modify `ignoredPairKeys`.
- A different Robot Link contacting the same surface still yields a Finding.
- Missing Mount Contact configuration applies no automatic exemption.
- Axis movement refreshes Robot and carriage Collision proxies.
- Hidden Robot, Object, Group, or Axis descendants do not participate.

### UI

- Scene Objects and Robot Jobs are both visible at the same time on the target
  desktop layout.
- **+ New Job** is visible without opening another dialog or drawer.
- Selecting a Job displays only its Poses in Timeline.
- Timeline and Collision never share the bottom rail simultaneously.
- The document has no vertical or horizontal scrollbar; only the intended Tree,
  Job, Inspector, and Timeline containers scroll.
- Every Entity type displays only its valid Context Menu commands.
- Object, Group, and Robot XYZ/RPY edits display their reference frame and a
  read-only World Pose.
- Light/Dark choice and Sidebar split persist locally but are absent from the
  project archive.

### Limits

- The 64th imported STEP Asset and 256th Object Instance are accepted.
- The next Asset or Instance is rejected before persistence.
- Asset reuse through Duplicate does not consume another STEP Asset slot.
- An 80-percent warning does not block an otherwise valid operation.

### Regression gates

- Existing Joint simulation, Job speed/order/delete, Object status, project
  revision storage, STEP Import, and Geometry Collision suites remain green.
- Production build, lint, CAD validation, and the project Save/Load browser E2E
  checks pass.
