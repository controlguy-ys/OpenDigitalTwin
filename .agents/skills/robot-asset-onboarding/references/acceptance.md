# Robot asset onboarding acceptance

Record deterministic evidence before accepting a Robot asset import:

1. Reload the Project V5 record and confirm the Robot Definition, asset hashes, and explicit Joint/Link mappings persist.
2. Render the actual referenced geometry and confirm the expected Robot geometry is visible; do not accept metadata-only evidence.
3. Exercise every controlled Joint and confirm its configured motion is isolated from the other controlled Joints.
4. Confirm TCP position and orientation remain consistent with the rendered Robot and explicit Link mapping.
5. When a check fails, isolate the failure to the STEP/Geometry asset, Project reference, Joint/Link mapping, motion configuration, or TCP configuration before requesting a correction.

Fused STEP geometry is not evidence of mechanical topology. Require explicit deterministic mechanics mapping from a human or authoritative source before adding or changing Joints.
