# OPC UA Robot Q1-Q6 Binding

## Goal

Bind the active V4 Robot's first six joints to the live B&R OPC UA `Rob.Q1` through `Rob.Q6` variables at `opc.tcp://127.0.0.1:4840`, and carry the OPC UA Client values through the current V4 browser runtime.

## Constraints

- Preserve the existing V4 browser surface and unrelated project changes.
- Use the verified B&R namespace URI `http://br-automation.com/OpcUa/PLC/PV/` and string identifiers `::Sample6X:Rob.Q1` through `::Sample6X:Rob.Q6`.
- Keep the binding read-only from the browser; do not write to the PLC.
- Keep the V5 Runtime Gateway boundary intact by adapting the V4 publisher's project and state payloads to the V5 HTTP contract.

## Tasks

1. Add a V4 mutation helper for the deterministic B&R Robot binding.
   - Configure an enabled OPC UA Client endpoint at `127.0.0.1:4840`.
   - Map the selected Robot's first six joints by definition order to Q1-Q6.
   - Set the Robot joint owner to the endpoint and replace prior bindings for the same endpoint/Robot joints.
   - Add unit tests for the exact node IDs, targets, ownership, and insufficient-joint rejection.

2. Add the binding action to the V4 Robot Joint inspector.
   - Show a concise binding panel with the verified endpoint and Q1-Q6 mapping.
   - Route the action through the existing project mutation service so it publishes a fresh revision.
   - Keep manual jog controls disabled while OPC UA owns the Robot.

3. Bridge the active V4 browser project to the V5 Runtime Gateway.
   - Convert the V4 project to the V5 validation shape without dropping robot definitions, controllers, frames, or OPC UA client mappings.
   - Convert V4 Robot state publication to the V5 server-state payload only for existing server-mode behavior.
   - Add tests proving the converted client project validates and preserves the six Robot joint mappings.

4. Add V4 Robot joint ingestion from V5 `StateBatchV1` messages.
   - Apply recognized `robot-joint` mapping values with endpoint, sequence, timestamp, quality, and range fences.
   - Forward gateway stream messages to both existing object bindings and Robot joints.
   - Add a targeted runtime test that updates six joints from a state batch and rejects stale/out-of-range samples.

5. Verify the implementation.
   - Run the focused mutation, gateway adapter, runtime, and App tests.
   - Run TypeScript/build checks and inspect the live gateway status without PLC writes.

## Commits

- `feat: bind Robot joints to B&R OPC UA Rob Q1-Q6`
