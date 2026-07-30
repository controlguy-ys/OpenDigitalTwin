# OpenDigitalTwin UI V6 Design Contract

## Boundary

UI V6 consumes Project V5. UI V6 does not imply Project schemaVersion 6.

The canonical Project remains `schemaVersion: 5`. V6 is an application-shell
generation which uses the V5 browser resources, mutation service, and Runtime
Gateway contracts without a V6 project schema, migration path, or dual
persistence. Project revisions, leases, idempotency, atomic publication,
Runtime Epoch, active Runtime Bundle, OPC UA endpoint/mapping/interpolation,
and ownership rules remain V5 authorities.

Unsupported capabilities stay absent.

Runtime session state is not restored after reload.

This includes active Jobs, runtime subscriptions, transient dialogs, selection,
and Main View maximize state. Browser-local preferences may retain only theme,
panel sizes, panel visibility, and Toolbox collapse state.

## Information architecture

The persistent header contains the brand, active Project name, save state,
menus (`Project`, `Home`, `Model`, `Job`, `Simulation`, `Connectivity`,
`View`, `Help`), quick Save/Start/Cancel actions, and compact
Simulation/Live, Gateway, and OPC UA status. The contextual Toolbox provides
Select, Translate, Rotate, Add Box, Add Cylinder, Focus Selection, and Fit All.

The workspace has a searchable Scene Explorer at left; a stable, primary 3D
viewport in the centre; a selection Inspector at right; and a compact current
Job monitor at bottom. Full Job authoring is a resizable modal with a vertical
instruction list and Step Inspector. The Explorer represents Frames, Robots,
Groups, and Objects. The Inspector routes to the selected Robot or Object.

## Responsive workspace

Measured workspace width selects `wide` at 1200px and above, `compact` from
960px through 1199px, and `narrow` below 960px. The central viewport retains
at least 480 CSS pixels in wide and compact modes. Explorer width is 220..420px,
Inspector width is 280..480px, and the Bottom Workspace is 120px..45% of the
measured workspace height.

- Wide starts with Explorer and Inspector open, Bottom Job Monitor open at
  180px, and Toolbox collapsed.
- Compact starts with Explorer docked, Inspector drawer closed, Bottom Job
  Monitor collapsed, and Toolbox collapsed.
- Narrow starts with Explorer and Inspector drawers closed, Job Monitor bottom
  sheet closed, and Toolbox collapsed.

Panel/drawer state is Shell-owned. Compact Inspector and narrow drawers/sheets
are transient and start closed on reload or mode change. Reset Layout restores
the layout defaults while retaining the selected theme and Bottom Workspace tab.

## Main View presentation

Main View maximize is a transient application-pane presentation mode, not the
browser Fullscreen API or `F11`. The Main View pane toolbar has one icon-only
toggle at its right edge. It begins as `Maximize Main View` and is placed both
in the View menu inventory and the Main View pane toolbar inventory. In a later
surface task it will use Lucide `Maximize2` in workspace mode and `Minimize2`
in maximized mode, retain one DOM control, and change its accessible name and
tooltip to `Restore Main View`.

Maximize masks the header, Explorer, Inspector, Toolbox, and Job Monitor while
the same Canvas fills the application viewport. Camera, selection, runtime
subscriptions, active Job, Project revision, panel geometry, visibility, and
drafts survive exact restoration. Restore uses the toolbar icon or `Escape`;
`Escape` first closes a menu, popover, context menu, or non-busy dialog. The
maximize command never publishes a Project mutation, runs Home/Fit, restarts
rendering, or invokes browser fullscreen.

## Interaction, ownership, and theme

Right mouse button is reserved for the viewport and Explorer context menu. It
never starts camera panning. Camera input is left-click select, middle-drag
orbit, `Shift+middle-drag` pan, and wheel zoom.

Project-owned edits publish one atomic V5 revision only after a completed user
action; drafts do not publish intermediate revisions. Running Jobs make that
Robot's authoring actions read-only. Manual transform is editable only when its
ownership permits it; OPC UA, simulation, and attachment ownership remain
read-only with an explanation. UI V6 automated or manual acceptance never
issues an external OPC UA write.

Themes are `system`, `dark`, and `light`. DOM panels, WebGL background, grid,
axes, View Cube, markers, selection outline, and overlays resolve from one
theme. Pretendard Variable is the global UI font; monospace is limited to
NodeIds, code, and diagnostics. Interactive targets, focus indicators,
tooltips, reduced motion, and labelled switches follow the V6 accessibility
constraints.

## Job authoring

The bottom monitor reports the active Job and execution state. The editor uses
a vertical, sortable instruction list with a Step Inspector; it does not
reintroduce a horizontal instruction strip. Reorder, edit, delete, duplicate,
attach/detach, and I/O changes are disabled while the associated Robot Job is
running. Each completed authoring action is one V5 mutation.

## Command inventory

| Surface | Commands |
| --- | --- |
| Project menu | `project.new`, `project.loadDemo`, `project.save`, `project.export`, `project.import` |
| Home menu | `tool.select`, `tool.translate`, `tool.rotate`, `view.focusSelection`, `view.fitAll` |
| Model menu and Toolbox | `model.addBox`, `model.addCylinder` |
| Job menu and monitor | `job.openEditor`, `job.start`, `job.cancel` |
| View menu | `view.focusSelection`, `view.fitAll`, `view.main.maximize`, `view.layout.reset`, `view.theme.system`, `view.theme.dark`, `view.theme.light` |
| Main View pane toolbar | `view.main.maximize` |
| Explorer/viewport context | `scene.toggleVisibility`, `scene.rename`, `scene.duplicate`, `scene.delete`, `binding.open`, `model.addBox`, `model.addCylinder`, `view.fitAll` |
| Help menu | `help.controls`, `help.about` |

The contextual Toolbox always presents Select, Translate, and Rotate; it adds
Add Box, Add Cylinder, Focus Selection, and Fit All where applicable. Import
Robot and Import Object remain absent until V5 authoring ports exist. Context
actions are typed by Robot, Object, Group, empty viewport, or Job instruction
as defined by the approved V6 plan.

## Explicit non-goals

- No Project V6 schema, migrator, dual persistence, or Legacy Adoption path.
- No V4 UI/scene/job/viewport production imports or V4 import dialogs.
- No unsupported command shown as a disabled or non-functional surface.
- No external OPC UA write, PLC/robot action, or changed Runtime Gateway
  authority from UI work.
- No Canvas remount merely because panels resize, collapse, open as drawers, or
  change tabs.
