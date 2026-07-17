# Viewport Context Gesture and 3D View Cube Design

**Status:** Approved design, awaiting written-spec review

**Target:** `codex/fix-v4-render-job-ui` and the Project V4 browser workspace

## Purpose

Remove the interaction conflict where a right-button camera Pan also opens the
Scene Toolbox, reduce the interruption caused by the Toolbox, and replace the
upper-right text-button orientation grid with a real World-referenced 3D View
Cube.

This is a focused Viewport stabilization. It preserves the current camera
controls, Scene commands, Project model, Simulation behavior, and Light/Dark
theme system.

## Approved decisions

- Preserve right-button drag as camera Pan.
- Treat a right-button gesture with less than 5 CSS pixels of movement as a
  context click.
- Treat movement of 5 CSS pixels or more as Pan and suppress the context menu
  for that gesture.
- Do not change Scene selection when a right-button Pan begins over geometry.
- Select the exact Robot, Robot Link, or Object only when its stationary
  context click opens the menu.
- Replace the modal, dimming Scene Toolbox with a non-modal anchored menu.
- Replace the DOM orientation-button grid with the installed
  `@react-three/drei` `GizmoHelper` and `GizmoViewcube` in the existing Canvas.
- Keep Home View, Fit All, Focus Selection, and a visible keyboard-accessible
  orientation fallback beside the Cube.
- Keep the View Cube fixed to the World frame and the Robot domain's Z-up
  convention.

## Explicit exclusions

- No change to left-button Orbit, wheel Zoom, or right-button Pan mappings.
- No camera projection switch, camera-follow mode, camera preset editor, or
  project-persisted camera changes.
- No View Cube drag interaction or free-form camera roll control.
- No second WebGL Canvas, new renderer, new dependency, imported Cube asset, or
  handcrafted CSS/SVG Cube.
- No changes to the available Scene Context Menu commands or their command
  services.
- No redesign of the separate Job Context Menu.
- No change to Scene Explorer keyboard context-menu support.
- No touch-gesture redesign, multi-selection, or general interaction framework.
- No physics, Collision, Robot kinematics, Job, OPC UA, or persistence changes.

## 1. Confirmed current behavior

`ViewportRuntimeV4` mounts Three.js `OrbitControls` without a `mouseButtons`
override. The installed OrbitControls therefore assigns the right mouse button
to Pan. A native `contextmenu` event is emitted during completion of the
right-button gesture, with exact ordering controlled by the browser.

`SceneCanvasV4` and the rendered Robot/Object handlers currently open the Scene
Context Menu for every such event. They do not know whether the preceding
gesture moved. Robot and Object `onPointerDown` handlers also select on every
mouse button, so starting a right-button Pan over geometry can change the
selection.

The current `SceneContextMenuV4` is presented as a modal dialog. It adds a
full-screen dimming backdrop, marks the application root inert, and traps focus.
That behavior is disproportionate for ordinary contextual commands and makes
an accidental menu especially disruptive.

The current `ViewCube` is not a 3D Cube. It is a seven-button DOM grid containing
ISO, Top, Front, Right, Back, Left, and Bottom abbreviations.

## 2. Deterministic right-button gesture contract

### Gesture state

`SceneCanvasV4` owns one transient gesture record for the active right-button
pointer:

```ts
interface RightButtonGestureV4 {
  readonly pointerId: number
  readonly originClientX: number
  readonly originClientY: number
  candidate: SceneSelectionTargetV4 | null
  lastClientX: number
  lastClientY: number
  dragged: boolean
}
```

The record is browser interaction state only. It is not placed in Zustand,
Project content, Undo history, or persistence.

### Classification

The outer Scene Canvas surface starts the gesture in the DOM capture phase so it
sees right-button presses that begin over empty space, Robot geometry, Robot
Links, or Spatial Entity geometry. Document-level capture listeners observe the
matching move, up, cancel, and native `contextmenu` lifecycle until that gesture
finishes, including release outside the Canvas.

On right-button `pointerdown`, the surface records the pointer ID, origin, last
coordinates, and an initial empty-space candidate. A Robot or Spatial Entity
pointer handler may replace that candidate with the qualified topmost hit from
the same pointerdown. While that pointer is active, movement is classified with
squared distance:

```text
dx * dx + dy * dy >= 25  => Pan gesture
dx * dx + dy * dy < 25   => context-click candidate
```

The comparison uses CSS-pixel `clientX/clientY` values. It has no duration,
velocity, debounce, or device-specific heuristic. Exactly 5 pixels is a Pan.

Matching `pointermove` updates the last coordinates and sticky `dragged` flag.
Matching `pointerup` recomputes the distance from its final coordinates so a
device that omits a last move event is still classified correctly.

Classification depends only on distance. A short-lived native-menu suppression
record may survive pointerup until the first matching `contextmenu` event or the
next animation frame, whichever occurs first. It is also cleared by the next
right-button pointerdown, pointer cancel, window blur, or document visibility
loss. That cleanup window never changes whether the gesture is a click or Pan.

### Context request and native-menu suppression

The custom Scene menu is opened from matching `pointerup`; it no longer depends
on the browser's native `contextmenu` target or event order:

- If the gesture was dragged, finish the gesture and open nothing.
- If it was stationary, select the stored pointerdown candidate, or clear Scene
  selection for the empty-space candidate, then issue exactly one context
  request at the pointerup client coordinates.

While a Scene right-button gesture or its one-frame completion record exists, a
document capture listener prevents and stops its matching native `contextmenu`
event. A PointerEvent match requires the recorded `pointerId`, right button, and
mouse or pen pointer type. For a legacy event without a pointer ID, it matches
only a right-button event at the recorded final client coordinates. Keyboard
ContextMenu/Shift+F10 events are therefore not consumed.

Robot and Spatial Entity native `onContextMenu` routing is removed after the
pointer lifecycle owns context requests. Scene Explorer keeps its independent
mouse and keyboard Context Menu path.

Suppression applies only to a right-button gesture that began inside the Scene
Canvas. It does not disable Context Menus globally.

### Selection rules

Robot and Spatial Entity `onPointerDown` handlers branch by button before any
selection side effect:

- Primary button qualifies the hit, selects it, and retains the existing Scene
  propagation behavior.
- Right button reports the qualified hit as the gesture's context candidate,
  does not select it, and does not block OrbitControls Pan.
- Other buttons neither select nor create a context candidate.

A stationary context click uses the qualified topmost pointerdown hit. Release
hit-testing is intentionally not repeated, so a sub-5-pixel movement across a
thin geometry boundary still opens the commands for the target on which the
gesture began:

- Robot Link geometry selects and opens commands for that exact Link.
- Other Robot geometry selects and opens commands for that Robot.
- Spatial Entity geometry selects and opens commands for that Entity.
- Empty Viewport pointerdown clears Scene selection at stationary pointerup and
  opens the empty-space menu.

A right-button Pan performs none of those selection changes.

## 3. Non-modal Scene Context Menu

`SceneContextMenuV4` remains a portal positioned in Viewport coordinates, but it
renders only the anchored `role="menu"` surface. It no longer renders a dialog
backdrop, declares `aria-modal`, or sets `#root.inert`.

The menu keeps its current command resolution, pending-command protection,
viewport-edge clamping, disabled states, error presentation, and arrow-key,
Home, and End navigation.

The interaction contract becomes:

- Focus the first enabled menu item when the menu opens.
- Escape closes the menu and restores the element focused before opening.
- Successful command completion closes the menu and restores prior focus when
  that element still exists.
- Pointerdown outside the menu closes it without preventing that pointer action
  and without moving focus back away from the clicked target.
- Tab or Shift+Tab closes the menu, restores the element focused before the
  first request, and does not cycle focus inside the menu.
- A new context request replaces the existing request, commands, and position.
- Replacement retains the focus-return owner captured before the first request;
  it neither restores nor recaptures focus between requests.
- Destructive commands continue to use their existing dedicated confirmation
  dialogs; those dialogs remain modal.

The menu retains its industrial panel colors, border, and shadow, but the
full-screen 46-percent dimming layer is removed. Its own stacking level is high
enough to appear above Viewport overlays and Sidebars without blocking the rest
of the application.

Scene Explorer's ContextMenu key and Shift+F10 path remain the keyboard entry
point for selected Scene items. The separate Job menu is unchanged.

## 4. Real 3D World View Cube

### Rendering boundary

The Cube is rendered inside the existing React Three Fiber Canvas:

```tsx
<GizmoHelper alignment="top-right" ...>
  <GizmoViewcube ... />
</GizmoHelper>
```

This reuses the current WebGL context and camera. It does not create a second
Canvas or render loop. `ViewportRuntimeV4` owns the Cube because it already owns
the camera, OrbitControls, and camera actions.

The DOM `ViewCube` button grid is removed from `ViewportOverlayV4` after its
keyboard-accessible replacement is present.

### Z-up face mapping

The installed `GizmoViewcube` material order assumes Y-up. RobotSim is
right-handed and Z-up, with Front at negative Y. The Cube therefore supplies
this label order:

```ts
['Right', 'Left', 'Back', 'Front', 'Top', 'Bottom']
```

The mapping corresponds to positive X, negative X, positive Y, negative Y,
positive Z, and negative Z respectively.

The Cube is always World-referenced. Selecting another Pose Frame, Gizmo Frame,
Robot, Tool, MCP, or Object never rotates its reference frame.

### Deterministic camera action

The installed Gizmo's default tween is not used. Its click callback derives a
World direction from the clicked face normal or edge/corner object position and
passes it to the existing camera-action layer. The callback stops propagation
inside the Cube HUD and returns `null` as required by the installed Drei 10.7.7
component contract.

The camera action:

1. Rejects non-finite or zero-length directions.
2. Normalizes the direction.
3. Preserves the current Orbit target.
4. Preserves the current camera-to-target distance, with the existing minimum
   distance guard.
5. Places the camera at `target + normalizedDirection * distance`.
6. Uses World Z as camera up except near the positive or negative Z pole, where
   World Y is used to avoid a degenerate look-at orientation.
7. Updates the projection matrix, OrbitControls, and existing browser-local
   camera preference.

Existing Front, Back, Left, Right, Top, Bottom, and Isometric commands delegate
to the same direction-based operation. Face, edge, corner, and fallback-control
camera changes therefore share one implementation.

There is no View Cube drag in this stage. Faces select axis-aligned directions;
edges and corners select their corresponding normalized diagonal directions.
Projection remains perspective.

### Visual layout

The upper-right footprint remains compact:

- The interactive Cube is scaled to an 88-by-88-CSS-pixel target footprint.
- Home View, Fit All, and Focus Selection remain adjacent compact utilities.
- A visible `View orientation` control exposes Isometric and all six face views
  for keyboard and screen-reader users.
- The fallback control calls the same camera actions and does not attempt to
  track an active option while the camera is freely orbited.
- Buttons retain the existing approximate 40-by-40-pixel target, tooltip,
  hover, focus-visible, disabled, Light, and Dark theme behavior.

The WebGL Cube uses one neutral high-contrast palette compatible with both
themes and the existing cyan accent for hover emphasis. It does not introduce a
new application color system.

## 5. Component boundaries

### Scene Canvas gesture classifier

Owns only right-button origin, movement classification, and one-event
suppression. It does not know Scene command contents or camera math.

### Robot and Object interaction handlers

Own hit qualification and primary-button selection. They continue forwarding
stationary Context Menu targets through the existing interaction interface.

### Scene Context Menu

Owns anchored-menu focus, outside-pointer closing, keyboard navigation, command
pending state, and error display. It does not classify camera gestures.

### Viewport camera actions

Own validated World-direction camera placement. It does not render UI or know
which Cube face was clicked.

### Viewport runtime Cube

Owns the installed Drei Cube, Z-up labels, and face/edge/corner event-to-direction
adapter. It does not duplicate camera placement math.

### DOM camera controls

Own Home, Fit, Focus, and the accessible orientation fallback. They do not
render a fake Cube.

## 6. Error and edge handling

- An invalid Cube direction is ignored without changing camera or Project
  state.
- A drag that exits the Canvas remains classified by document capture and its
  matching native menu remains suppressed.
- `pointercancel` abandons the gesture without opening a menu.
- A stale Scene target keeps the existing unavailable-target error behavior.
- Context command rejection keeps the menu open and displays the existing
  inline error.
- Focus restoration is skipped when the prior element has been removed.
- Focus is not restored after an outside pointer action, so the newly clicked
  control keeps its expected focus.
- If the 3D Scene is unavailable, the existing Scene recovery surface remains
  authoritative; the DOM Home/Fit/Focus/orientation controls keep their current
  disabled/no-op behavior until a camera controller registers.

## 7. Verification

### Gesture unit and component checks

- Movement below 5 pixels remains a context-click candidate.
- Movement at exactly 5 pixels and above is classified as Pan.
- A stationary right click on empty Viewport space requests the empty-space menu
  exactly once and clears selection.
- A right-button drag on empty space requests no menu and does not clear
  selection.
- A right-button drag beginning over Robot, Robot Link, or Object geometry
  requests no menu and does not change selection.
- Primary pointerdown continues to select exact Robot/Link/Object targets.
- Stationary target context clicks continue to select and route exact targets.

### Context Menu checks

- The Scene menu renders as `role="menu"`, not a modal dialog.
- Opening the menu does not dim the page or set the application root inert.
- Outside pointerdown closes without stealing focus from the clicked target.
- Escape and successful actions close with the focus restoration defined in
  section 3.
- Tab closes the menu, restores the pre-menu focus owner, and does not cycle
  inside the menu.
- Arrow, Home, End, pending action, disabled action, stale target, inline error,
  and destructive confirmation behaviors remain valid.

### Camera and Cube checks

- The installed real `GizmoViewcube` is mounted in the existing Canvas.
- The Cube has the approved Z-up labels and no second WebGL Canvas exists.
- All six faces route to the expected World direction.
- Edge and corner clicks route to normalized diagonal directions.
- Top and Bottom views use a non-degenerate World-Y up vector.
- Face, edge, corner, and fallback commands preserve Orbit target and distance.
- Home restores the fixed application camera; Fit All frames effective visible
  Scene geometry; Focus Selection frames the selected eligible target and stays
  disabled when no such target exists.
- Camera commands change only camera and browser-local Viewport preferences.
- The accessible orientation fallback exposes Isometric and all six face views.

### Browser acceptance flow

In the user's in-app RobotSim browser:

1. Select a Robot Link and right-drag over it by more than 5 pixels.
2. Confirm that the camera Pans, the selected Link remains selected, and no
   Scene menu appears.
3. Stationary-right-click the same Link and confirm that its anchored menu opens
   once without dimming the application.
4. Click outside and confirm the intended clicked control remains usable.
5. Click Cube faces and one corner; confirm World Z-up orientation, stable Orbit
   target, and stable camera distance.
6. Exercise the visible orientation fallback with the keyboard.
7. Repeat the Viewport overlay check in Light and Dark themes at the normal
   desktop viewport.

The before/after Viewport screenshots are compared at the same browser state and
viewport to verify Cube placement, overlay spacing, menu dimming removal,
contrast, focus indication, and absence of clipping.

### Regression gates

- Targeted Scene Canvas, Robot model, Spatial Entity, Scene Context Menu,
  camera-action, Viewport runtime, and Viewport overlay tests pass.
- Lint and production build pass.
- Existing Scene command, Simulation Joint, Robot Job, project persistence,
  STEP Import, and Geometry Collision behavior remains unchanged.

## 8. Success criteria

- A right-button Pan never opens the Scene Toolbox.
- A stationary right click still opens the correct Scene menu exactly once.
- Right-button Pan never changes Scene selection.
- The Scene menu no longer dims or disables the complete application.
- The Scene menu remains fully usable with pointer and keyboard input.
- The text orientation grid is replaced by a real interactive 3D Cube.
- The Cube's face labels and camera directions are correct for World Z-up.
- Faces, edges, corners, and accessible fallback preserve Orbit target and
  distance and modify no Robot, Object, Job, OPC UA, or Project state.
- Home View, Fit All, Focus Selection, Light theme, and Dark theme remain usable.
- No new runtime dependency, WebGL context, or project-format field is added.
