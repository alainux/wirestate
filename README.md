# Wirestate

Wirestate is a visual, verifiable specification tool for software behavior. It keeps a small, diff-friendly statechart and wireframe DSL in the repository, renders it as an interactive prototype, and compares the specification with source bindings and test traces.

This repository contains the reference implementation and a release-ready example. The package name remains a working name and should be checked for registry and trademark availability before a public launch.

## What is included

- Hierarchical and composable finite state machines in YAML.
- Optional Balsamiq-style screens made from eight primitives: `Container`, `Text`, `Button`, `TextInput`, `Image`, `List`, `Toggle`, and `Modal`.
- A polished local IDE-style studio with a zoomable state graph and clickable wireframe side by side, explicit state jumps, transition controls, and editable specification comments.
- A CLI for validation, graph inspection, event simulation, component interaction simulation, source synchronization, coverage, comments, serving, and Playwright smoke-test generation.
- Passive conformance through a language-neutral JSON/NDJSON trace protocol.
- Source linking through `data-wirestate-id`, `data-wirestate-state`, `@wirestate(...)`, and `wirestate:` comments.
- Project and global configuration files.
- A JSON Schema for editor integration.
- A colocated TypeScript habit tracker that measures chunks against daily or weekly goals, plus a real behavior-only export CLI, source bindings, comments, a passing trace, and explicit drift tests.
- Native Node test coverage above 90% for lines and functions.

## Quick start

```bash
npm install
npm run build
node dist/cli.js check --cwd examples/habit-tracker
node dist/cli.js serve --cwd examples/habit-tracker --open
```

During development:

```bash
npm run check
npm run example:build
npm run example:check
npm run example:serve
# In another terminal, run the actual example app or export CLI:
npm run example:app
npm run example:sync
```

The studio defaults to `http://127.0.0.1:4177`. Buttons and toggles in the wireframe execute transitions declared by `interaction` metadata through the same core interpreter used by the CLI. Graph selection only inspects a state; double-clicking or using the inspector performs an explicit runtime jump.

## A small specification

```yaml
wirestate: 1
namespace: checkout

machines:
  app:
    initial: cart
    states:
      cart:
        screen: cart
        bind: state:checkout.app.cart
        on:
          CHECK_OUT:
            target: payment
            interaction:
              kind: click
              component: checkout.submit
      payment:
        screen: payment
        bind: state:checkout.app.payment

screens:
  cart:
    root:
      type: Container
      children:
        - type: Text
          props: { text: Your cart }
        - id: checkout.submit
          type: Button
          bind: component:checkout.submit
          props: { label: Check out }
```

The checked-in source can link to the spec without requiring a framework:

```html
<main data-wirestate-state="checkout.app.cart">
  <button data-wirestate-id="checkout.submit">Check out</button>
</main>
```

A backend or CLI project can use a decorator or comment adapter:

```python
@wirestate("state:jobs.worker.running")
def run_job():
    ...
```


## Interactive prototype behavior

Transition interaction metadata connects the optional wireframe to the machine without adding behavior to the screen DSL itself:

```yaml
on:
  OPEN_ADD:
    target: adding
    interaction:
      kind: click
      component: habit.addButton
```

In the studio, clicking `habit.addButton` calls the core interaction resolver with the current machine state, component ID, and interaction kind. The same operation is available without the UI:

```bash
wirestate interact \
  --machine habits.app \
  --state ready.dashboard \
  --component habit.addButton \
  --kind click
```

This keeps the browser a replaceable surface and avoids a second implementation of transition selection.

## Passive verification

Any test runner or application can emit NDJSON:

```json
{"type":"state","machine":"checkout.app","state":"cart"}
{"type":"transition","machine":"checkout.app","from":"cart","event":"CHECK_OUT","to":"payment"}
{"type":"component","id":"checkout.submit","action":"click"}
```

Then run:

```bash
wirestate coverage .wirestate/traces/*.ndjson
wirestate check
```

`check` validates the DSL, scans code/spec bindings in both directions, reads configured traces, rejects unknown states or transitions, and enforces configured state and transition coverage.

## CLI

```text
wirestate init
wirestate validate [--json]
wirestate inspect
wirestate graph [MACHINE] [--dot]
wirestate simulate --machine ID --events EVENT,EVENT
wirestate jump --machine ID --state ID
wirestate interact --machine ID --state ID --component ID --kind click|fill|toggle|submit|wait|custom
wirestate sync [--json]
wirestate coverage [TRACE...]
wirestate check [--json]
wirestate serve [--port PORT] [--open]
wirestate comment list|add|update|remove ...
wirestate smoke generate --machine ID --out FILE
```

All studio mutations map to CLI/core operations. Event stepping and component interactions are resolved by the server core rather than reimplemented in the browser.

## Configuration

A project uses `wirestate.config.yml`, `.wirestate.yml`, or the `.yaml` equivalents. A global config may be stored at `~/.config/wirestate/config.yml` or selected with `WIRESTATE_GLOBAL_CONFIG`.

```yaml
specs:
  - src/spec.wire.yml
source:
  - src/**/*.ts
  - src/**/*.html
  - tests/**/*
trace:
  - .wirestate/traces/**/*.ndjson
strict:
  bindings: true
coverage:
  states: 90
  transitions: 80
server:
  port: 4177
  open: false
```

Project values override global values. Nested objects are merged.


## Colocated TypeScript example

The example is organized by implementation boundary rather than by a separate specification folder:

```text
examples/habit-tracker/
  src/shell/       browser entry point and application machine
  src/habits/      habit model, storage, screens, and component specs
  src/goals/       period-progress calculations and completion screen
  src/sync-cli/    runnable export CLI and behavior-only machine
  src/shared/      reusable wireframe templates
```

The browser app records the language-neutral trace protocol in `globalThis.__WIRESTATE_TRACE__`. The export CLI compiles with the same example and emits state and transition events as NDJSON to stdout. Run `npm run example:build` to type-check both entry points.

## Regression behavior in the example

The automated suite copies the habit-tracker repository and verifies both required drift directions:

1. It removes the colocated `component:habit.archiveButton` source binding while leaving the screen specification unchanged. `sync` reports the component as missing in code.
2. It changes the screen binding from `habit.archiveButton` to `habit.pauseButton` while leaving code unchanged. `sync` reports the new binding missing and the old source binding unknown.

The checked-in `traces/passing.ndjson` reaches all 11 leaf states and all 19 transitions across the browser application and export-CLI machines.

## Design boundary of the current implementation

Passive trace validation is the reliable default. Active traversal is intentionally limited to generating a Playwright smoke-test scaffold from transition interaction metadata. Full autonomous traversal is left behind an adapter boundary because it needs fixture generation, guarded-transition selection, path planning, loop limits, and application-specific recovery.

The core does not depend on a browser framework. YAML is the authoring format; normalized machines, screens, comments, traces, and reports are plain JSON-compatible objects. This gives other language adapters a stable protocol without forcing them to embed the TypeScript runtime.

## Repository map

```text
src/                     core, CLI, server, adapters
public/                  local split-view studio
site/                    GitHub Pages home and web documentation
schema/                  JSON Schema for the DSL
docs/                    architecture and adapter contracts
examples/habit-tracker/  functional example and specs
tests/                   unit, integration, drift, HTTP, and CLI tests
```

See [docs/architecture.md](docs/architecture.md), [docs/dsl.md](docs/dsl.md), and [docs/adapters.md](docs/adapters.md).


## FAQ

### Why are generated views and artifacts not manually editable?

Wirestate is designed for specification-first, agentic development. The checked-in YAML specification is the source of truth. Graphs, previews, generated tests, scaffolds, and reports are derived artifacts that must be reproducible from that source.

Direct edits to derived output would create hidden state that cannot be regenerated reliably, may be overwritten, and makes it unclear to both reviewers and coding agents which representation expresses the intended behavior. Humans and agents instead change machines, screens, comments, and constraints through the filesystem, CLI, or supported specification-focused UI operations (currently comment editing), then regenerate and verify the derived output.

This boundary does **not** prohibit editing application code or authoring the specification. It prohibits treating generated projections as an additional competing source of truth.

### Does Wirestate replace tests?

No. Tests still exercise the application. Wirestate adds a behavioral contract above them: conformance rejects unknown behavior, while coverage reports modeled states and transitions that tests have not demonstrated.

### Does it verify pixel-perfect visual output?

Not in the core. The DSL intentionally models behavior and barebones layout rather than CSS. Screenshot, accessibility-tree, and semantic DOM adapters can add visual evidence without turning the specification into a second frontend implementation.

### Why is passive verification the default?

Application-owned tests know how to authenticate, create fixtures, and recover from environment-specific failures. Passive traces reuse that knowledge and remain reliable. Active traversal is useful for generated smoke tests, but requires path planning, fixtures, guards, loop bounds, and recovery policies that are best kept behind adapters.

## Near-term roadmap

- Guard expressions and explicit nondeterministic transition selection.
- Parallel state regions and history states.
- A formal adapter SDK for Java, Python, Go, Rust, and browser frameworks.
- Playwright reporter/fixture packaging with trace attachments.
- Path selection, fixture providers, and bounded active traversal.
- Git-aware comment attribution and review status.
- Source locations in normalized nodes for precise diagnostics.
- Incremental indexes for very large specifications.
- Code-generation contracts and deterministic AI generation manifests.


## Deploying the documentation and package

### GitHub Pages

The static site is in `site/`, and `.github/workflows/pages.yml` deploys that directory on pushes to `main` that change the site or workflow. In the GitHub repository, open **Settings → Pages**, choose **GitHub Actions** as the source, then push to `main` or run the workflow manually. The committed studio image at `site/assets/studio.png` is captured from the runnable example rather than assembled as a mock.

To preview the exact static site locally:

```bash
python3 -m http.server 8080 --directory site
```

### npm package

Before publishing, confirm the final package name and update repository metadata. Then authenticate, verify the tarball, and publish:

```bash
npm install
npm run check
npm pack --dry-run
npm login
npm publish --access public
```

For a scoped package, use a scoped `name` in `package.json`; `--access public` is required for a public scoped package. Use `npm version patch|minor|major` for subsequent releases and publish from a clean commit with the matching tag.

## License

MIT
