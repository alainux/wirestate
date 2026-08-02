# DSL reference

## File structure

```yaml
wirestate: 1
namespace: optional.namespace
imports: [./other.wire.yml]
components: {}
screens: {}
machines: {}
comments: []
```

Every identifier without a dot is qualified by the file namespace. Imports are compositional and cycle-checked.

## Machines and hierarchy

```yaml
machines:
  app:
    initial: signedOut
    states:
      signedOut:
        on:
          LOGIN: signedIn
      signedIn:
        initial: home
        states:
          home: {}
          settings: {}
```

A transition target may be:

- A sibling key: `settings`.
- A child path using a leading dot.
- An absolute ID prefixed with `#`, such as `#account.app.signedOut`.
- A fully qualified ID without `#`.

Entering a compound state descends through its `initial` states to a leaf.

## Transition metadata

```yaml
SUBMIT:
  target: complete
  spec: A valid form is persisted exactly once.
  interaction:
    kind: click
    component: form.submit
  wait:
    timeoutMs: 5000
    afterMs: 100
    until:
      state: forms.app.complete
      selector: '[data-ready=true]'
      text: Saved
  tags: [critical]
```

`afterMs` represents an intentional settling delay. `until` is adapter metadata; passive validation does not sleep or poll.


## Interactive prototype semantics

Screens remain layout-only. Interactive behavior is declared once on a machine transition through `interaction` metadata. This prevents screen definitions from becoming a second state machine.

```yaml
states:
  empty:
    screen: empty
    on:
      OPEN_ADD:
        target: adding
        interaction:
          kind: click
          component: habit.addButton
```

The studio maps primitives to interaction kinds:

- `Button`: `click` or `submit`
- `Toggle`: `toggle`
- `TextInput`: local prototype value; Enter may trigger `fill`
- Other primitives may opt into `click` when a transition names their component ID

The browser sends the component ID and interaction kind to the core resolver. The equivalent CLI command is:

```bash
wirestate interact --machine habits.app --state ready.dashboard --component habit.addButton --kind click
```

If multiple transitions use the same component and interaction kind, callers must select an event explicitly with `--event`.

## Screens

A screen has a `root` component. Components may use a primitive or a named template.

```yaml
components:
  Page:
    type: Container
    layout: { direction: column, gap: 16, padding: 24 }

screens:
  home:
    root:
      use: Page
      children:
        - type: Text
          props: { text: Home, variant: title }
```

Supported layout fields are `direction`, `gap`, `padding`, `width`, `height`, `align`, and `justify`. Advanced CSS is deliberately excluded.

## Bindings

A `bind` value is an opaque protocol token. Recommended prefixes are:

- `machine:`
- `state:`
- `component:`
- `service:`
- `command:`

Wirestate compares exact strings. Adapters are free to add domains.

## Comments

```yaml
comments:
  - id: c_save_rule
    target: component:form.save
    body: Saving is disabled while validation is pending.
    author: product
    status: open
    createdAt: 2026-08-02T08:00:00.000Z
```

Targets are normally binding tokens or `state:<fully-qualified-state-id>` values.
