# RobotSim Visual Specification

Sections before `UI V6 Workspace Boundary` describe the retained V4 visual
reference. For UI V6, the V6 section is authoritative and explicitly
supersedes the earlier typography, Context Bar command source, Ribbon Lite,
dock naming, dock sizes, and responsive defaults. V6 reuses the earlier color
tokens, 6px radius, restrained industrial chrome, workcell composition, and
anti-decoration rules only where the V6 contract does not replace them.

## Accepted References

- Desktop: `docs/design/robot-sim-desktop-concept.png` at 1440 x 900
- Narrow: `docs/design/robot-sim-narrow-concept.png` at 768 x 1024

## Visible Copy Surface Rules

- Header copy permits the approved Menu Bar labels: Project, Home, Model, Job,
  Simulation, Connectivity, View, and Help; the Project name and save state;
  Simulation state; Joint source; Gateway state; and approved Quick Actions.
- Context Bar copy comes only from labels of visible `AppCommandV4` commands.
- Other visible copy remains local to its approved surface and capability. Do
  not introduce unapproved menu copy or imply capabilities that are not wired.

## Tokens

- canvas: #0B1118
- panel: #111B24
- viewport: #081018
- border: #263440
- text: #E9F1F7
- muted: #8EA1B0
- accent: #38BDF8
- fault: #EF4444
- warning: #F59E0B
- running: #22C55E
- radius: 6px

## Icon Inventory

Upload, ChevronDown, Eye, EyeOff, Home, RotateCcw, Save, Play, Pause,
Square, Grip, PanelLeft, PanelRight, TriangleAlert.
All icons use the same 1.75px outline weight and 16px optical size.

## Workspace Layout

- Canvas: 1440 x 900.
- Top bar: 48px high.
- Wide defaults: the 248px Scene and Job Sidebar and 320px Inspector are open,
  the 160px Bottom Workspace is closed, and Ribbon Lite is expanded.
- Compact defaults: the Sidebar is open, the Inspector overlay and Bottom
  Workspace are closed, and Ribbon Lite is collapsed.
- Narrow defaults: both side drawers and the Bottom Sheet are closed, and
  Ribbon Lite is collapsed.
- The Bottom Workspace has a 160px default and spans the central Viewport
  column only; it never runs beneath either side dock.
- The central 3D Viewport fills the remaining application area and remains the
  visual focus.

## Narrow Layout

- Canvas: 768 x 1024.
- Keep the 48px top bar and the central 3D viewport visible.
- Use the narrow defaults from Workspace Layout: closed left and right drawers,
  a closed Bottom Sheet, and a collapsed Ribbon Lite.
- Reuse the desktop colors, typography, objects, copy surface rules, and
  component families.

## Workspace Preference and Responsive Rules

- Ribbon Lite expansion and docked-region visibility persist per wide, compact,
  and narrow mode. The compact Inspector and every narrow drawer or sheet are
  transient Shell-owned overlays and start closed on reload or mode change.
- Shell mode and available height come from a `ResizeObserver` on
  `studio-workspace`. The Shell writes that one result to `data-layout-mode`,
  which drives the Shell CSS.
- The approved viewport-context and real 3D View Cube plan is a prerequisite
  for this workspace behavior.
- Reset Layout restores layout defaults but preserves the Theme and selected
  Bottom Workspace tab.

## Immutable Visual Rules

- Use compact Segoe UI / Inter-like typography, 6px radii, restrained shadows, precise dense chrome, and readable controls.
- Keep controls and text code-native in the implementation.
- Use the approved workcell composition: a gray, white, and red NED2 six-axis robot, clean industrial workbench, two cups, one machine cabinet, grid floor, one selected-object outline, and a realistic red/yellow/green three-lens stack light.
- Do not add decorative gradients, pills, badges, hero copy, card grids, fake metrics, new component families, or unapproved visible copy.

## UI V6 Workspace Boundary

UI V6 is a workspace presentation over Project V5. It does not create or imply
Project `schemaVersion: 6`; unsupported capabilities remain absent and runtime
session state is not restored after reload. The V6 workspace uses wide (at
least 1200px), compact (960..1199px), and narrow (below 960px) modes while
keeping the central viewport primary.

V6 uses Pretendard Variable globally, with monospace limited to NodeIds, code,
and diagnostics; this replaces the earlier Segoe UI / Inter-like typography
rule. V6 context copy comes from visible `AppCommandSnapshotV6` commands and
the typed Job-instruction action inventory, not `AppCommandV4` or Context Bar
composition.

V6 wide defaults are Explorer and Inspector open, Bottom Job Monitor open at
180px, and Toolbox collapsed. Compact defaults are Explorer docked, Inspector
drawer closed, Bottom Job Monitor collapsed, and Toolbox collapsed. Narrow
defaults are Explorer and Inspector drawers closed, Job Monitor bottom sheet
closed, and Toolbox collapsed. These defaults and the Explorer, Inspector,
Toolbox, and Job Monitor names replace the earlier Scene and Job Sidebar,
Ribbon Lite, and 160px closed Bottom Workspace defaults.

The Main View presentation toggle is an application-pane mode, not browser
fullscreen. It is represented by `view.main.maximize` in both the View menu and
Main View pane toolbar inventory; it begins with the label `Maximize Main View`
and Lucide `Maximize2`, then uses `Restore Main View` and `Minimize2` while
maximized. It never creates a Project mutation. In maximized presentation,
workspace chrome is masked while the existing Canvas, camera, selection,
runtime state, and prior dock arrangement survive restoration. Right-click is
reserved for viewport and Explorer context actions and never pans the camera.
