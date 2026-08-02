# Habit chunks example

This example is a small TypeScript application whose implementation and Wirestate specifications are colocated by feature:

- `src/shell/` contains the browser entry point and application machine.
- `src/habits/` contains the habit model, persistence adapter, feature screens, and component specifications.
- `src/goals/` contains period-progress calculations and the goal-completion screen.
- `src/sync-cli/` contains a real command-line export entry point and its behavior-only machine.
- `src/shared/` contains reusable wireframe primitives.

The app tracks measurable chunks, such as five ten-minute reading sessions per week. It supports creation, dashboard progress, detail, logging, completion, and archival.

```bash
# From the repository root
npm run example:build
npm run example:app
npm run example:sync
npm run example:check
```

The browser app writes Wirestate trace events to `globalThis.__WIRESTATE_TRACE__`. The sync CLI emits the same language-neutral JSON event protocol to stdout.
