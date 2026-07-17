# Docked Ribbon Lite Menu and Resizable Workspace Design

**Status:** Approved design, self-reviewed, awaiting user written-spec review

**Target:** `codex/fix-v4-render-job-ui` and the Project V4 browser workspace

## Purpose

Turn the approved Docked Studio layout into a reusable industrial Web Digital
Twin workspace with a discoverable Menu Bar, a compact contextual command row,
and resizable Scene, Inspector, and Timeline areas.

The design borrows RobotStudio's activity-oriented navigation and docked work
areas without copying its full desktop Ribbon or implying unsupported ABB
Controller, RAPID, RobotWare, Add-In, or safety functionality.

This stage defines UI information architecture and command ownership. It does
not implement new Robot, STEP, Job, Collision, or OPC UA capabilities merely
because a future menu location is reserved for them.

The separately approved Viewport context-gesture and real 3D View Cube design
is a prerequisite work package. It must either land first or be the first
package in the eventual implementation plan. This specification does not treat
that documented behavior as already implemented.

## Research basis

The following official ABB references were used:

- [RobotStudio 2026.1 Operating Manual, revision BA](https://library.e.abb.com/public/e5b8383d22fd40ea9e2510cd23a8e911/3HAC032104-001_en_BA_Operating%20manual%20-%20RobotStudio.pdf)
- [RobotStudio Developer Center: Ribbon Area](https://developercenter.robotstudio.com/api/robotstudio/articles/Concepts/Appearances/RibbonElements.html)
- [RobotStudio Developer Center: Dockable Areas](https://developercenter.robotstudio.com/api/robotstudio/articles/Concepts/Appearances/DockableControls.html)

RobotStudio organizes work as Ribbon tabs, groups, and controls. File commands
use a Backstage-style application area, while Home, Modeling, Simulation,
Controller, and RAPID separate major activities. Its desktop workspace uses
dockable Tree, Properties, and horizontal output areas.

RobotSim adopts those structural principles but changes the vocabulary where
the product differs:

- `Project` replaces RobotStudio's desktop `File` Backstage.
- `Connectivity` replaces `Controller` because RobotSim exposes runtime source
  and OPC UA integration rather than RobotWare Controller administration.
- `Job` remains the project's established term for an ordered Pose sequence.
  It is not RobotStudio Fleet Management Jobs; UI help describes it as
  `Job - Pose sequence`.
- `RAPID` and `Add-Ins` are not shown until real corresponding capabilities
  exist.

## Approved decisions

- Keep the approved Docked Studio layout.
- Use a two-level `Menu Bar + Ribbon Lite` header instead of a full desktop
  Ribbon.
- Keep the first row stable and use the second row for the active menu or
  selected-target commands.
- Allow the Ribbon Lite row to collapse and remember the browser preference.
- Keep only Save, Start Job, and Cancel Active Robot Job as optional
  always-visible Quick Access commands in the first implementation. Pause,
  Resume, and Stop remain hidden until the executor has matching operator
  semantics.
- Keep the active Robot identity independent from the current Scene selection,
  so selecting an Object does not silently retarget or disable an active
  Robot's Job controls.
- Keep Project save state, Simulation state, Joint source, and Gateway state
  visible as compact status information rather than menu commands.
- Move creation, Theme, camera layers, and panel layout commands out of the
  current mixed top toolbar and into the relevant menus.
- Use one command definition for Menu Bar, Ribbon Lite, Context Menu, existing
  buttons, and future keyboard shortcuts.
- Resize and persist the left Sidebar width, right Inspector width, Bottom
  Workspace height, and the existing Scene-to-Job split.
- Keep layout preferences browser-local. They are not Project content and are
  not exported with a Workcell.
- Keep the central 3D Viewport as the dominant area.
- Do not show a command until its underlying service and error behavior are
  actually wired.

## Explicit exclusions

- No full RobotStudio Ribbon clone or Backstage clone.
- No RAPID editor, RobotWare configuration, Controller authentication,
  Controller installation, Backup/Restore, online deployment, or Add-In store.
- No Undo/Redo until a shared history contract exists.
- No Save As or Recent Projects until the Project persistence contract supports
  them.
- No OPC UA Client or Bridge option while the current Runtime Gateway rejects
  those modes.
- No STEP Import entry that routes through a legacy path forbidden by the V4
  production import graph.
- No Coordinate Frames menu command until the existing dialog is mounted in the
  V4 application flow.
- No physics Collision, Robot safety validation, or Controller-level motion
  guarantees.
- No changes to Project V4 schema solely for UI layout.
- No new UI framework, icon package, or second WebGL Canvas.

## 1. Confirmed current state

`AppShellV4` currently renders one `role="toolbar"` containing Project controls,
the Simulation label, Joint source, Add commands, and Theme. It is not a global
Menu Bar.

`ProjectMenuV4` directly owns Project actions, OPC UA Off or Server mode, and
Gateway presentation. Scene, Robot, Job, Timeline, camera, and Collision
commands are owned by separate feature components.

The left Scene and Job panes already have a browser-persisted vertical split.
The overall left width, Inspector width, and Bottom Workspace height remain
fixed by CSS. The Shell owns drawer state internally, so an external View menu
cannot yet control those areas.

The approved Viewport context-gesture and real 3D View Cube behavior remains
defined by
`docs/superpowers/specs/2026-07-17-viewport-context-viewcube-design.md`.
This design repositions those controls but does not change their interaction
contract.

## 2. Workspace anatomy

The desktop workspace has five stable regions:

1. Global Menu Bar and compact status row at the top.
2. Collapsible Ribbon Lite command row below it.
3. Resizable Scene and Job Sidebar on the left.
4. Central 3D Viewport with camera and frame overlays.
5. Resizable Inspector on the right and a tabbed Timeline and Collision
   workspace below the central Viewport.

The first-stage Bottom Workspace contains Timeline and Collision tabs and spans
the central Viewport column only. It does not run under the left or right dock,
avoiding the overlapping controls visible in the earlier wide-screen layout.
Events is capability-gated until an Events surface exists.

### Default desktop sizing

- Left Sidebar: existing 248 CSS-pixel default, adjustable from 220 to 420.
- Right Inspector: existing 320 CSS-pixel default, adjustable from 280 to 480.
- Bottom Workspace: 160 CSS-pixel default, adjustable from 120 CSS pixels to
  45 percent of the available workspace height.
- Scene-to-Job vertical split: existing 60 percent default and 35-to-75-percent
  range.

Each boundary has a visible but restrained resize affordance. Pointer resize
and keyboard Arrow adjustment use the same clamping rules. Double-clicking a
divider resets only that divider to its default. `View > Reset Layout` resets
all dock sizes, visibility, and Ribbon expansion after confirmation is not
required because it changes browser-local UI state only.

On a 1200-CSS-pixel-or-wider desktop, the central Viewport has a 480-CSS-pixel
minimum width after separators. Dragging a divider clamps only the active dock
against the other dock and that minimum; it never proportionally changes or
silently collapses the opposite dock. When stored widths cannot fit after a
window resize, the right dock is clamped first, then the left dock, until the
minimum Viewport width is restored.

## 3. Global Menu Bar

The desktop first row uses this fixed order:

```text
Project | Home | Model | Job | Simulation | Connectivity | View | Help
```

The current Project name is placed beside the RobotSim product mark, with save
state immediately following it. Compact Simulation, Joint source, and Gateway
status stay on the right. Status elements may open their relevant menu but do
not duplicate editable controls inline.

Start Job and Cancel Active Robot Job in Quick Access always address the
explicitly active Job and its bound Robot. They remain disabled, with a reason,
when no active Job is eligible. They never infer a different Robot from the
most recently selected Object.

Clicking a Robot in the Scene tree or a Job that is bound to a Robot makes that
Robot active. Selecting an Object does not clear the active Robot. Robot Home
targets the active Robot only, and Cancel targets only that Robot's running Job.
The global Simulation status reports the aggregate number of running Jobs;
Joint source reports the active Robot's source, or `No active Robot` when no
Robot has been established.

Active Robot is transient application UI state, not Project content or a layout
preference. Project New, Import, or replacement reconciles it to the first
eligible Robot in stable Project order. Removing the active Robot selects the
next eligible Robot, or clears the state when none remains. The active Job is
the selected Job bound to that Robot and is cleared when it no longer exists.

The Menu Bar follows desktop application behavior:

- One menu is active at a time.
- Click or Enter opens a menu below its trigger.
- Left and Right Arrow move between top-level menus while a menu is active.
- Up and Down Arrow, Home, End, Enter, and Space navigate and invoke commands.
- Escape closes and returns focus to the trigger.
- Pointerdown outside closes the menu without dimming or making the app inert.
- Disabled commands remain stable only when their presence explains current
  context; future unavailable product features remain hidden.
- Destructive commands retain their existing dedicated confirmation flows.

## 4. Menu information architecture

### Project

First implementation:

- New Project
- Save Project
- Import Project
- Export Project
- Samples > Dual-Robot Sample

Later, only after persistence support exists:

- Save As
- Recent Projects
- Asset Path management
- Portable package or Pack-and-Go equivalent

### Home

Home contains common selection and manipulation commands rather than every
object-specific setting:

- Focus Selection
- Rename
- Copy Pose, Paste Pose, Reset Pose
- Hide or Show
- Isolate and Show All
- Delete
- Robot Home, Open Gripper, and Close Gripper when a Robot is active

Capability-gated additions:

- Explicit Select mode after a shared tool-mode command exists
- Move and Rotate modes after a shared gizmo-mode command exists

Commands not valid for the current selection remain disabled with a concise
reason. Selection-specific commands are repeated in the Context Bar for faster
access but use the same command ID.

### Model

First implementation:

- Add Box
- Add Cylinder
- Add Group
- Move to Group and Remove from Group
- Edit Robot Base and Mount where already supported

Capability-gated additions:

- Import Object STEP
- Import Robot STEP
- Robot Geometry
- Mechanical and Kinematic configuration
- Coordinate Frames
- Tool and TCP configuration

Those later entries become visible only when the V4 workflow is connected. A
menu label must never route to a legacy importer or an unmounted dialog.

### Job

Job is the product-specific Pose-sequence workflow:

- New Job
- Save Current Pose
- Start Job
- Cancel Active Robot Job when that Robot is running
- Rename Job
- Duplicate Job
- Delete Job
- Open Timeline

Pose order, speed, and deletion remain Timeline-only operations in the first
implementation because Timeline steps are not independent selection targets.
They move into a Pose Context Bar only after a selected-step interaction
contract exists. `Run From Here`, Pause, Resume, and operator Reset are likewise
capability-gated until the Job runtime exposes those semantics.

The left Job pane remains the primary structure editor. The menu and Context
Bar provide discoverable and selection-sensitive shortcuts, not a second Job
editor.

### Simulation

First implementation:

- Start Active Job
- Cancel Active Robot Job
- Open Timeline
- Validate Geometry Collision
- Open Collision findings

Capability-gated additions:

- TCP Trace
- Attach Object
- Release Object
- Pause or Resume
- Stop with semantics distinct from Cancel
- Reset Active Robot or Reset All Simulation with an explicit scope
- Playback speed
- Simulation setup presets

Any future Simulation Reset is separate from Home View and Robot Home. Its
command label must state whether it resets the active Robot or all Simulation
state.

### Connectivity

First implementation reflects only the current Runtime Gateway contract:

- Runtime mode: Off or OPC UA Server
- Gateway status and endpoint details

Capability-gated additions:

- Open connection diagnostics
- Simulation, OPC UA Client, Server, or Bridge source selection
- Connect and Disconnect
- Joint and XYZRPY Mapping
- XML and XLSX Mapping import or export
- Subscription interpolation settings

Unsupported Client and Bridge modes are not offered as selectable items. A
Project imported with an unsupported persisted mode continues to show its
existing explicit unsupported-state presentation.

### View

- Show or Hide Scene and Job Sidebar
- Show or Hide Inspector
- Show or Hide Bottom Workspace
- Expand or Collapse Ribbon Lite
- Reset Layout
- Theme: System, Light, Dark
- Grid, World, MCP, Robot Base, and TCP visibility
- Home View
- Fit All
- Focus Selection
- Isometric, Top, Front, Right, Back, Left, and Bottom views
- Perspective or Orthographic only after the camera contract supports it

The real 3D World View Cube remains visible inside the Viewport and calls the
same camera commands as this menu.

### Help

- Keyboard and Mouse controls
- STEP Import limits and Robot Import model
- OPC UA Mapping guide when the corresponding workflow exists
- About and build information

Help content is concise and local to the deployed application. An empty Help
menu is not rendered.

## 5. Ribbon Lite and Context Bar

The second row shows one compact command group at a time. It is not a miniature
copy of every open Menu.

When a top-level menu is explicitly selected, the row shows that activity's
frequent commands. When the user selects a Scene or Job target, the row may
switch to the target Context Bar:

- Robot: Joint Jog, Home, Base Pose, TCP, Geometry, OPC Mapping, Hide.
- Object: XYZRPY, Parent, Group, Numeric Status, OPC Mapping, Hide, Delete.
- Job: Save Pose, Start, Cancel, Rename, Duplicate, Delete, Open Timeline.
- Empty Viewport: Add Object, Add Primitive, Fit All.

Target context wins only after an explicit target selection. Opening a global
menu temporarily previews its command group; closing the menu restores the
current target Context Bar.

Every listed Context Bar command still passes through the command's `visible`
gate. Geometry, Kinematics, OPC Mapping, or other future commands are absent
until their corresponding V4 workflow is operational.

The row uses icon and short-label commands. Icon-only Quick Access buttons have
tooltips and accessible labels. The row does not horizontally scroll; lower
priority commands move into a single `More` menu when space is insufficient.

## 6. Shared command contract

All command surfaces consume one presentation and execution contract. The
exact TypeScript split may change during implementation, but the semantic
contract is:

```ts
interface AppCommandV4 {
  readonly id: string
  readonly label: string
  readonly section: string
  readonly kind: 'action' | 'toggle' | 'radio'
  readonly visible: boolean
  readonly enabled: boolean
  readonly checked?: boolean
  readonly groupId?: string
  readonly disabledReason?: string
  readonly destructive?: boolean
  readonly shortcut?: string
  execute(): void | Promise<void>
}

interface AppCommandRuntimeV4 {
  readonly pendingCommandIds: ReadonlySet<string>
  readonly errorByCommandId: ReadonlyMap<string, string>
  invoke(commandId: string): Promise<void>
}
```

Requirements:

- A command ID has one enablement decision and one execution path.
- Command context carries both the current Scene selection and the explicitly
  active Robot and Job identities. Those identities are not derived from each
  other on every selection change.
- Toggle and radio commands expose checked state and group identity. Menus use
  `menuitemcheckbox` or `menuitemradio` rather than presenting stateful options
  as ordinary actions.
- Menu Bar, Ribbon Lite, Context Menu, existing buttons, and shortcuts do not
  call each other's DOM elements.
- The shared command runtime, not component-local flags, rejects duplicate
  invocation while pending and publishes the same pending or error state to
  every surface showing that command.
- Project loading, saving, importing, recovery-required, Simulation ownership,
  OPC UA ownership, and stale-selection checks remain authoritative.
- Global menus keep disabled positions stable for current-context commands.
  Context Menus omit irrelevant commands.
- Existing destructive confirmation services remain authoritative.
- Command presentation does not mutate Project state merely by opening a menu.

`App.tsx` remains the composition boundary for Project, Scene, Robot, Job,
camera, Collision, and Runtime Gateway command ports. Feature services retain
their domain behavior; the new command layer only coordinates presentation and
invocation.

## 7. Right-button and Context Menu relationship

The separate approved Viewport gesture contract remains unchanged:

- Movement below 5 CSS pixels is a context click.
- Movement at or above 5 CSS pixels is camera Pan and suppresses the menu.
- Right-button Pan never changes Scene selection.
- The Scene Context Menu is anchored and non-modal.

The new shared command layer replaces only how that menu obtains command
definitions. Gesture classification, target qualification, and focus behavior
remain owned by the existing Viewport design.

## 8. Responsive behavior

### Desktop, 1200 CSS pixels and wider

- Full Menu Bar, compact statuses, and Ribbon Lite are available.
- Left, right, and bottom dock sizes are independently adjustable.
- The central Viewport never receives a horizontal scrollbar.

### Compact desktop, 960 to 1199 CSS pixels

- The current compact-header breakpoint uses one `Menu` disclosure containing
  the same categories and commands.
- Ribbon Lite is collapsed by default but can be reopened.
- Status labels shorten before commands disappear.
- The left Sidebar remains docked and resizable against the same 480-CSS-pixel
  central Viewport minimum.
- The Inspector opens as an overlay drawer and does not participate in dock
  width calculations at this breakpoint.

### Narrow, below 960 CSS pixels

- Scene and Job Sidebar and Inspector become edge drawers.
- Bottom Workspace becomes a Bottom Sheet.
- One menu disclosure replaces the horizontal Menu Bar.
- Dock resize handles are hidden because those regions are overlays.
- Camera and Context commands remain available without covering the complete
  Viewport.

## 9. Browser-local layout state

The following values are stored as versioned browser preferences:

- Ribbon expanded state.
- Left Sidebar open state and width.
- Scene-to-Job split.
- Inspector open state and width.
- Bottom Workspace open state, selected tab, and height.
- Theme preference.

Invalid, missing, non-finite, or out-of-range values fall back to the approved
defaults. A future incompatible layout change increments the preference
version and migrates or safely resets the old values.

Project New, Import, Export, and Save never include these preferences. Layout
Reset does not change Robot Pose, Scene content, Job state, camera domain
settings, OPC UA configuration, or Project dirty state.

## 10. Component boundaries

### App command composition

Builds command definitions from current Project, selection, active Robot, Job,
Simulation, camera, Collision, and Runtime Gateway state. It owns no feature
domain mutation beyond calling the existing ports.

### App Shell

Owns Menu Bar and dock presentation, responsive mode, browser layout
preferences, separators, and Reset Layout. It does not own Robot, Job, Scene,
or OPC UA behavior.

### Menu and Ribbon components

Own menu focus, keyboard navigation, dismissal, overflow presentation, and
command pending feedback. They do not infer enablement or call domain services
directly.

### Feature components

Scene Explorer, Joint Inspector, Job List, Timeline, Collision panel, camera
overlay, and Context Menus consume shared commands where an equivalent command
exists. Feature-specific editors keep their specialized inputs and validation.

### Viewport

Retains Scene selection, camera gesture, View Cube, overlays, and render
ownership. It does not become a global menu state manager.

## 11. Implementation sequence

1. Complete and verify the separately approved Viewport context-gesture and
   real 3D View Cube work package.
2. Revise the current visual-copy and layout specification to permit the
   approved menus and two-level header.
3. Extract browser layout preferences and resizable dock state behind a Shell
   layout controller.
4. Introduce the shared command contract and shared execution runtime, then
   adapt current Project, Scene, Robot, Job, Simulation, camera, Collision, and
   Gateway actions.
5. Build the accessible desktop Menu Bar and compact-menu equivalent.
6. Build Ribbon Lite, Quick Access, and target Context Bar.
7. Connect View commands to dock visibility, size reset, Theme, frame layers,
   and camera actions.
8. Replace existing duplicate command handlers with shared command consumers
   one feature at a time.
9. Add capability-gated menu entries only as their V4 service flows become
   operational.
10. Verify behavior, accessibility, layout persistence, and visual regression in
   the user's in-app browser.

This order avoids a visual-only menu that duplicates or bypasses current domain
rules.

## 12. Verification

### Command behavior

- Every existing action exposed by a new menu calls the same service and
  produces the same Project, Simulation, or UI result as its existing surface.
- One input invokes one command exactly once.
- Disabled, pending, recovery-required, unsupported-mode, and stale-selection
  behavior is consistent across Menu Bar, Ribbon Lite, Context Menu, and
  existing controls.
- No menu entry calls a DOM `.click()` or reaches into a feature component.
- No hidden capability appears as a working command.

### Menu accessibility

- Desktop renders `menubar`, `menu`, and `menuitem` semantics.
- Toggle and exclusive-choice entries render `menuitemcheckbox` and
  `menuitemradio` with current checked state.
- Left, Right, Up, Down, Home, End, Enter, Space, Escape, and Tab behavior is
  covered by component tests.
- Closing restores focus according to the approved interaction contract.
- Menu opening does not dim the application or make unrelated controls inert.
- Focus-visible, Light, Dark, high zoom, and long-label states remain readable.

### Dock and responsive layout

- Pointer and keyboard resizing clamps to every documented limit.
- Reload restores valid sizes and open states.
- Invalid persisted values restore defaults.
- Reset Layout restores only browser UI preferences.
- Scene and Job panes retain their adjustable vertical split.
- 1440 by 900, the 1200-pixel breakpoint, the 960-pixel breakpoint, and 768 by
  1024 show no application-level horizontal scroll or overlapping panels.
- Long Project, Robot, Object, and Job names truncate without moving menu
  triggers or statuses.
- The Bottom Workspace stays under the central Viewport only.

### Regression gates

- Targeted App Shell, Project Menu, Scene Explorer, Context Menu, Joint
  Inspector, Job List, Timeline, camera, Collision, and Runtime Gateway tests
  pass.
- Lint, the complete Vitest suite, and production build pass.
- After the prerequisite Viewport work lands, the real 3D View Cube and
  right-button Pan classification remain operational. Robot Joint motion, Job
  execution, project persistence, and OPC UA Server behavior remain
  operational throughout.
- Browser verification is repeated in Light and Dark themes using the same
  viewport and Project state for before-and-after comparison.

## 13. Success criteria

- The approved Docked Studio layout has a discoverable, keyboard-accessible
  Menu Bar without sacrificing the central 3D Viewport.
- Every existing global action is reachable within two menu levels.
- Menu Bar, Ribbon Lite, Context Menu, existing buttons, and shortcuts share one
  command ID and execution path.
- Robot, Object, and Job selection exposes only relevant Context Bar commands.
- Unsupported RobotStudio-like functionality is not implied by visible UI.
- Left Sidebar, Inspector, Bottom Workspace, and Scene-to-Job split are
  adjustable, persistent, collapsible, and resettable.
- The layout remains usable without application-level scrolling at all approved
  desktop and narrow breakpoints.
- Light and Dark themes, View Cube, frame layers, Project operations, Robot
  Joint control, Job execution, Geometry Collision, and OPC UA Server mode
  remain stable.
