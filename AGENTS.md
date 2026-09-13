# Working on City Miniature Atlas

For new-city production and generated-plan revisions, use the repository skill at `.agents/skills/build-city/SKILL.md` and the concrete command contract in `docs/city-workflow.md`.

- Keep source geography, display choices and validation results separate. Missing features are unknown, not vacant land. Preserve source URLs, raw bytes and licenses.
- Work for a new city belongs in a new task/run. Leave existing Hangzhou and shared assets unchanged unless the request calls for those changes.
- The source collector, generic planner, viewer and workflow are separate modules. Fix reusable logic at the appropriate layer; do not patch generated JSON to bypass checks.
- `work/city-runs/` contains local resumable tasks and review evidence and is ignored by Git. Do not commit private work records or unlicensed references.
- Geometry checks, browser evidence, visual review and user acceptance are different outcomes. Report the one actually established.

Checks for workflow changes: `npm run check:city-workflow`, `npm run check:city-sources`, `npm run check:city-plan`, plus `npm run check`. Rendering changes also require the actual browser preview and lifecycle checks. See `scripts/README.md` for optional GIS/browser dependencies.
