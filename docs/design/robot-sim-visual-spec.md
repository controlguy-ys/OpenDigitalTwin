# RobotSim Visual Specification

## Accepted References

- Desktop: `docs/design/robot-sim-desktop-concept.png` at 1440 x 900
- Narrow: `docs/design/robot-sim-narrow-concept.png` at 768 x 1024

## Visible Copy Allow-List

RobotSim; SIMULATION; GOOD; Import STEP; Scene Assets; Robot; Equipment;
LINK00; LINK01; LINK02; LINK03; LINK04; LINK05; LINK06; Cup 01; Cup 02;
Machine 01; Inspector; J1; J2; J3; J4; J5; J6; Home; Reset; Save Pose;
Open Gripper; Close Gripper; Timeline; Events.

No additional above-the-fold copy is permitted.

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

## Desktop Layout

- Canvas: 1440 x 900.
- Top bar: 48px high.
- Scene Assets rail: 248px wide on the left.
- Inspector: 320px wide on the right.
- Timeline / Events rail: 128px high at the bottom.
- The central 3D viewport fills the remaining application area and remains the visual focus.

## Narrow Layout

- Canvas: 768 x 1024.
- Keep the 48px top bar and the central 3D viewport visible.
- Convert the Scene Assets tree and Inspector into closed left and right edge drawers.
- Collapse the Timeline / Events rail into a bottom sheet.
- Reuse the desktop colors, typography, objects, copy, and component families.

## Immutable Visual Rules

- Use compact Segoe UI / Inter-like typography, 6px radii, restrained shadows, precise dense chrome, and readable controls.
- Keep controls and text code-native in the implementation.
- Use the approved workcell composition: a gray, white, and red ABB GoFa-like six-axis robot, clean industrial workbench, two cups, one machine cabinet, grid floor, one selected-object outline, and a realistic red/yellow/green three-lens stack light.
- Do not add decorative gradients, pills, badges, hero copy, card grids, fake metrics, new component families, or unapproved visible copy.
