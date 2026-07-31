# Geometry Proxy Collision

Geometry Proxy Collision checks the configured Box or Compound-Box proxies. It
does not use the visual STEP mesh as collision geometry and does not apply
forces or move the Robot or Objects in response to a finding.

## Configure proxies

- Open **Robot Geometry** to edit each Link's local transform and primary Box
  center/half-extents. The saved V2 project retains every Compound Box even
  when the primary Box is edited.
- During **Import STEP**, review the Object Asset collider center and
  half-extents. All Instances of that Asset reuse its proxy; each Instance
  contributes its own MCP-local transform.
- Hidden Robot Links and hidden Object Instances are inactive. The gripper is
  represented by the built-in Tool Box. A grasped Object keeps its canonical
  `object:*` or `equipment:*` ID and is evaluated from its TCP-local pose.

Use the smallest conservative proxy that represents the occupied volume. A
very large proxy produces intentional false positives; a proxy smaller than the
physical item can miss interference.

## Read current-pose results

Open **Timeline and Events** and use **Geometry Proxy Collision**.

- **Collision** means two enabled proxy volumes overlap. Approximate Clearance
  is zero or negative.
- **Near-miss** means the proxies do not overlap but their approximate
  separation is within **Warning distance (mm)**.
- Current-pose validation is revision-driven and runs at no more than 10 Hz.
  It reacts to joint, frame, proxy, visibility, Object-transform, and policy
  changes. React Three Fiber invokes its scheduler from `useFrame`, so checks
  follow active render cadence while the query rate itself remains capped at
  10 Hz; a paused render loop does not provide an independent collision timer.
- The existing `robot-link:LINK00|workcell:workbench` contact is an allowed
  mounting pair and is not reported. Other enabled Robot/Workbench pairs remain
  query participants.

Use **Previous**, **Next**, or **First** to inspect a finding. Red outlines show
collision; yellow outlines show near-miss. Navigation and highlighting never
change a Robot joint or Object transform.

## Ignore and restore a pair

Select a finding and press **Ignore Pair** when the two canonical Entities are
intentionally allowed to approach or overlap. The canonical pair key appears
under **Ignored pairs** and is saved in the `.wdtwin` project. Press the pair's
**Restore Pair** button to enable it again.

An ignored pair is a simulation policy exception, not a safety exception. Pair
keys for removed Entities stay inactive until the Entity returns or the key is
explicitly restored.

## Validate a Pose sequence

1. Save at least two Simulation Poses and set the Pose order and speed.
2. If required, position a graspable Object inside the TCP sensor and press
   **Close Gripper**. The Worker then evaluates that Object from its TCP-local
   attachment at every sample.
3. Press **Preview Sequence** for a coarse `2 deg` maximum joint step, or
   **Validate Sequence** for a `0.5 deg` maximum joint step.
4. Watch the processed/total sample counter. **Cancel Validation** terminates
   the current Worker immediately; a later validation starts in a new Worker.
5. Inspect the time and sample attached to each result. If Robot mechanics,
   frames, proxies, Objects, held state, Poses, visibility, or policy change,
   the previous report is marked stale.

Sequence sampling runs in a Web Worker and is independent of playback FPS. It
is capped at 20,000 samples and 10,000 findings; a capped result is marked
truncated.

## Export reports and projects

- **JSON** downloads a versioned `geometry-proxy-collision.json` report.
- **CSV** downloads `geometry-proxy-collision.csv` with deterministic ordering.
- Both report formats label the value **Approximate Clearance** and never
  include STEP bytes or OPC UA secrets.
- Project Save/Export writes schema V2 Compound Boxes and collision policy.
  Importing a V1 project preserves placement, generates one identity-rotation
  `default` Box for each legacy collider, and applies the V1 migration policy.

## Limits and safety boundary

This feature is a deterministic geometry query, not physics, vendor controller software,
vendor safety system, a controller collision monitor, or safety-rated validation. It does
not calculate mass, gravity, inertia, torque, friction, rebound, stopping
distance, cable interference, tool deformation, or swept triangle contact.
Only configured Box/Compound-Box proxies are tested. Always validate the real
cell with the Robot/controller vendor's engineering and safety tools before
commissioning.
