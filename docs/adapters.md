# Adapter contracts

## Source binding adapter

The built-in scanner recognizes:

```html
<div data-wirestate-id="profile.save"></div>
<div data-wirestate-state="profile.app.editing"></div>
```

```python
@wirestate("state:worker.job.running")
def run(): ...
```

```text
// wirestate: command:deploy.confirm
```

A future adapter can return the same normalized output:

```json
{
  "binding": "state:worker.job.running",
  "file": "worker.py",
  "line": 42,
  "strategy": "decorator"
}
```

## Trace protocol

Trace files are JSON arrays or NDJSON. Events are intentionally small.

### State

```json
{"type":"state","machine":"orders.app","state":"review","test":"checkout"}
```

### Transition

```json
{"type":"transition","machine":"orders.app","from":"review","event":"SUBMIT","to":"complete"}
```

### Component interaction

```json
{"type":"component","id":"orders.submit","action":"click"}
```

Optional `timestamp` and `test` fields allow aggregation. Unknown events fail conformance rather than being silently ignored.

## Playwright

`wirestate/playwright` exports `WirestateRecorder` and `collectBrowserTrace`. A test may record explicit semantic steps or collect `globalThis.__WIRESTATE_TRACE__` from the application.

```ts
const recorder = new WirestateRecorder({ testName: testInfo.title });
recorder.state('orders.app', 'review');
recorder.transition('orders.app', 'review', 'SUBMIT', 'complete');
await collectBrowserTrace(page, recorder);
await recorder.flush();
```

The generated NDJSON is consumed by the ordinary `coverage` or `check` commands, so the Playwright integration is not privileged.
