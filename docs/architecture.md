# Architecture

## Principles

1. **The filesystem is the source of truth.** The studio never owns hidden specification state. Comments are written back to YAML, and generated projections are not manually edited.
2. **The core is pure where practical.** Loading, normalization, simulation, graph analysis, trace coverage, and synchronization are callable without the UI.
3. **Surfaces are replaceable.** The CLI, HTTP API, dashboard, and test-runner adapters use the same normalized project model.
4. **Passive verification comes first.** A trace is evidence of behavior already exercised by the project’s own tests. Active traversal remains optional.
5. **Language neutrality is a protocol property.** Other languages only need to emit bindings and trace events; they do not need to run the TypeScript core in-process.

## Layers

### Authoring layer

YAML files contain namespaced machine, screen, component-template, import, and comment definitions. Imports are relative to the importing file. A root index file can compose a large repository from modules located beside the implementation they describe.

### Normalization layer

The loader validates every file and creates:

- Fully qualified machine and screen IDs.
- Flat state indexes with parent/depth metadata.
- Resolved relative transition targets.
- Resolved component templates.
- Descended initial leaf states.
- Warnings for missing optional screen/child-machine references.

### Verification layer

- `sync` compares declared `bind` values with bindings scanned from configured source globs.
- `coverage` compares trace events with modeled leaf states and resolved transition edges.
- `check` combines validation, warnings, sync, and configured trace coverage.

### Presentation layer

The local HTTP server serves static dashboard files and very small JSON endpoints:

- `GET /api/project`
- `POST /api/simulate`
- `POST /api/jump`
- `POST /api/interact`
- `POST /api/comments`
- `GET /api/events` for reload notifications

The browser renders data and delegates event stepping, component interaction resolution, and persistence to the core. The state graph and wireframe are synchronized views of the same runtime state; inspecting a graph node is distinct from explicitly jumping the runtime.


## Source-of-truth boundary for agents

Wirestate treats graphs, previews, generated tests, scaffolds, and reports as deterministic projections. Allowing direct edits to those artifacts would introduce non-reproducible state and ambiguity about which representation a coding agent should trust.

Humans and agents may edit the YAML specification and application source. Derived artifacts are regenerated from those inputs and checked in CI. This makes every intent change reviewable as a filesystem diff and keeps generation deterministic.

## Scale strategy

The normalized representation is flat even when authoring is hierarchical. This makes lookups and coverage set operations linear. For repositories with thousands of screens, the next step is an incremental file index keyed by content hash, plus API pagination and lazy screen loading. The DSL format does not need to change for that optimization.

## Active traversal boundary

Transition metadata may define an interaction and wait condition. The smoke generator translates the deterministic subset to Playwright. A future traversal engine should live behind an interface resembling:

```ts
interface ActiveAdapter {
  reset(machine: string): Promise<string>;
  execute(transition: NormalizedTransition, fixtures: FixtureProvider): Promise<ObservedStep>;
  recover(error: unknown): Promise<boolean>;
}
```

Path planning, guards, fixture values, loop bounds, and recovery policy should remain separate services rather than expanding the DSL interpreter.
