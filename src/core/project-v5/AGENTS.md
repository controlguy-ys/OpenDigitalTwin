# Project V5 Guidance

- Keep Project V5 records closed: reject undeclared fields at validation boundaries.
- Create fresh revisions for every persisted project update; do not mutate historical revisions.
- Preserve stable, canonical error codes for caller-visible validation failures.
- Use canonical Project V5 validation before persistence, publication, or Gateway mirroring.
