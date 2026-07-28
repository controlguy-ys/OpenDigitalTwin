# Runtime Gateway Guidance

- The browser owns project persistence; the Gateway mirrors only published revisions.
- Enforce lease fencing for every publication and command ownership boundary.
- Keep request and response bodies bounded before processing them.
- Do not add hidden persistence to the Gateway.
- Do not expand external OPC UA writes without an explicit current-user request.
