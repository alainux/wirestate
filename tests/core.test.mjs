import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import {
  DEFAULT_CONFIG,
  WirestateError,
  allTransitions,
  availableTransitions,
  createCoverageReport,
  descendInitial,
  findTransition,
  formatError,
  generatePlaywrightSmoke,
  globToRegExp,
  graphAsDot,
  jumpMachine,
  leafStates,
  loadProject,
  normalizeProject,
  parseTrace,
  pathExists,
  reachableStates,
  resolveReachedState,
  scanBindings,
  simulateMachine,
  slash,
  stepComponent,
  stepMachine,
  transitionKey,
  validateConfig,
  validateTraceEvent,
  validateWirestateFile,
  walkFiles,
  expandGlobs
} from '../dist/index.js';
import { exampleRoot, tempDir } from './helpers.mjs';

let project;
test.before(async () => { project = await loadProject(exampleRoot); });

test('loads and composes the hierarchical habit tracker specification', () => {
  assert.equal(project.files.length, 6);
  assert.deepEqual(Object.keys(project.machines).sort(), ['habits.app', 'habits.sync']);
  assert.deepEqual(Object.keys(project.screens).sort(), ['habits.adding', 'habits.celebration', 'habits.dashboard', 'habits.detail', 'habits.logging']);
  const app = project.machines['habits.app'];
  assert.equal(app.initialState, 'habits.app.loading');
  assert.equal(descendInitial('habits.app.ready', app.states), 'habits.app.ready.dashboard');
  assert.equal(app.states['habits.app.ready.detail'].screen, 'habits.detail');
  assert.equal(project.screens['habits.dashboard'].root.type, 'Container');
  assert.equal(project.screens['habits.dashboard'].root.children[0].type, 'Container');
  assert.equal(project.comments.length, 2);
  assert.deepEqual(project.warnings, []);
});

test('normalizes transitions and simulates inherited hierarchical behavior', () => {
  const app = project.machines['habits.app'];
  assert.equal(allTransitions(app).length, 12);
  assert.equal(leafStates(app).length, 6);
  assert.equal(resolveReachedState(app, 'habits.app.ready'), 'habits.app.ready.dashboard');
  assert.equal(findTransition(app, 'habits.app.ready.dashboard', 'OPEN_ADD')[0].target, 'habits.app.ready.adding');
  assert.deepEqual(findTransition(app, 'habits.app.ready.dashboard', 'NOPE'), []);

  const result = simulateMachine(app, ['LOADED', 'OPEN_ADD', 'SAVE_HABIT', 'OPEN_HABIT', 'OPEN_LOG', 'SAVE_CHUNK', 'BACK']);
  assert.equal(result.initial, 'habits.app.loading');
  assert.equal(result.final, 'habits.app.ready.dashboard');
  assert.equal(result.steps.length, 7);
  assert.equal(jumpMachine(app, 'ready').state, 'habits.app.ready.dashboard');
  assert.equal(stepMachine(app, 'ready.dashboard', 'OPEN_ADD').to, 'habits.app.ready.adding');
  assert.equal(availableTransitions(app, 'ready.dashboard').length, 2);
  assert.equal(stepComponent(app, 'ready.dashboard', 'habit.addButton', 'click').to, 'habits.app.ready.adding');
  assert.equal(stepComponent(app, 'ready.logging', 'habit.saveChunkButton', 'click', 'SAVE_CHUNK').event, 'SAVE_CHUNK');
  assert.throws(() => availableTransitions(app, 'missing'), /Unknown state/);
  assert.throws(() => stepComponent(app, 'ready.dashboard', 'habit.saveButton', 'click'), /No click interaction/);
  assert.throws(() => stepMachine(app, 'ready.dashboard', 'SAVE_HABIT'), /not accepted/);
  assert.throws(() => stepMachine(app, 'ready.dashboard', 'OPEN_ADD', 'ready.dashboard'), /No OPEN_ADD transition/);
});

test('reports graph reachability and DOT output', () => {
  const app = project.machines['habits.app'];
  const reachable = reachableStates(app);
  assert.equal(reachable.size, 6);
  assert.ok(reachable.has('habits.app.ready.celebrating'));
  const dot = graphAsDot(project, 'habits.app');
  assert.match(dot, /^digraph wirestate/);
  assert.match(dot, /OPEN_ADD/);
  assert.throws(() => graphAsDot(project, 'missing'), /Unknown machine/);
  assert.equal(transitionKey('a', 'B', 'c'), 'a|B|c');
});

test('parses JSON and NDJSON traces and validates event shapes', () => {
  const stateEvents = parseTrace('[{"type":"state","machine":"m","state":"a"}]');
  assert.equal(stateEvents[0].type, 'state');
  const ndjson = parseTrace('{"type":"component","id":"x"}\n{"type":"transition","machine":"m","from":"a","event":"GO","to":"b"}');
  assert.equal(ndjson.length, 2);
  assert.deepEqual(parseTrace('   '), []);
  assert.equal(validateTraceEvent({ type: 'component', id: 'x' }).id, 'x');
  assert.throws(() => validateTraceEvent({ type: 'state' }), (error) => error.details?.some((item) => item.includes('require machine and state')));
  assert.throws(() => validateTraceEvent({ type: 'transition', machine: 'm' }), (error) => error.details?.some((item) => item.includes('require machine')));
  assert.throws(() => validateTraceEvent({ type: 'component' }), (error) => error.details?.some((item) => item.includes('require id')));
  assert.throws(() => validateTraceEvent({ type: 'wat' }), (error) => error.details?.some((item) => item.includes('unknown event type')));
  assert.throws(() => parseTrace('[bad'), /Invalid JSON trace/);
  assert.throws(() => parseTrace('[{"type":"wat"}]'), /Invalid/);
});

test('produces passing and failing passive coverage reports', async () => {
  const trace = parseTrace(await readFile(path.join(exampleRoot, 'traces', 'passing.ndjson'), 'utf8'));
  const passing = createCoverageReport(project, trace);
  assert.equal(passing.valid, true);
  assert.equal(passing.states.percent, 100);
  assert.equal(passing.transitions.percent, 100);
  assert.deepEqual(passing.states.missing, []);

  const failing = createCoverageReport(project, [
    { type: 'state', machine: 'habits.app', state: 'not-real' },
    { type: 'transition', machine: 'habits.app', from: 'loading', event: 'NOPE', to: 'ready.dashboard' },
    { type: 'component', id: 'not-real' }
  ]);
  assert.equal(failing.valid, false);
  assert.equal(failing.states.unknown.length, 1);
  assert.equal(failing.transitions.unknown.length, 1);
  assert.equal(failing.components.unknown.length, 1);
  assert.ok(failing.errors.length >= 5);
});

test('validates specs and configuration errors', () => {
  validateWirestateFile({ wirestate: 1, imports: ['./other.yml'] });
  validateWirestateFile({ wirestate: 1, comments: [{ id: 'c', target: 'state:x', body: 'ok' }] });
  assert.throws(() => validateWirestateFile(null), (error) => error.details?.includes('document must be an object'));
  assert.throws(() => validateWirestateFile({ wirestate: 2 }), (error) => error.details?.includes('wirestate must equal 1'));
  assert.throws(() => validateWirestateFile({ wirestate: 1, machines: { x: { initial: 'a', states: {} } } }), (error) => error.details?.some((item) => item.includes('states must not be empty')));
  assert.throws(() => validateWirestateFile({ wirestate: 1, screens: { x: { root: { type: 'Unknown' } } } }), (error) => error.details?.some((item) => item.includes('supported primitive')));
  assert.throws(() => validateWirestateFile({ wirestate: 1, components: { x: { type: 'Text', use: 'y' } } }), (error) => error.details?.some((item) => item.includes('both type and use')));
  validateConfig(DEFAULT_CONFIG);
  assert.throws(() => validateConfig({ ...DEFAULT_CONFIG, specs: [], coverage: { states: -1, transitions: 101 }, server: { port: 0, open: false } }), /Invalid Wirestate/);
});

test('normalization detects bad references and component cycles', () => {
  const file = (document) => [{ path: '/tmp/spec.yml', document }];
  assert.throws(() => normalizeProject('/tmp', DEFAULT_CONFIG, file({
    wirestate: 1,
    namespace: 'x',
    machines: { app: { initial: 'a', states: { a: { on: { GO: 'missing' } } } } }
  })), /Unknown transition target/);
  assert.throws(() => normalizeProject('/tmp', DEFAULT_CONFIG, file({
    wirestate: 1,
    components: { A: { use: 'B' }, B: { use: 'A' } }
  })), /Circular component/);
  assert.throws(() => normalizeProject('/tmp', DEFAULT_CONFIG, file({
    wirestate: 1,
    screens: { one: { root: { use: 'missing' } } }
  })), /Unknown component template/);
});

test('glob and filesystem helpers are deterministic', async () => {
  const root = await tempDir();
  await writeFile(path.join(root, 'a.txt'), 'a');
  await writeFile(path.join(root, 'b.js'), 'b');
  await import('node:fs/promises').then(({ mkdir }) => mkdir(path.join(root, 'nested')));
  await writeFile(path.join(root, 'nested', 'c.js'), 'c');
  const walked = await walkFiles(root);
  assert.equal(walked.length, 3);
  assert.equal(slash('a\\b'), process.platform === 'win32' ? 'a/b' : 'a\\b');
  assert.equal(globToRegExp('**/*.js').test('nested/c.js'), true);
  assert.equal(globToRegExp('?.txt').test('a.txt'), true);
  const expanded = await expandGlobs(root, ['**/*.js'], ['nested/**']);
  assert.deepEqual(expanded.map((item) => path.basename(item)), ['b.js']);
  assert.equal(await pathExists(path.join(root, 'a.txt')), true);
  assert.equal(await pathExists(path.join(root, 'none')), false);
});

test('formats errors and generates a Playwright smoke test', () => {
  const generated = generatePlaywrightSmoke(project, 'habits.app');
  assert.match(generated, /generated smoke: habits.app/);
  assert.match(generated, /data-wirestate-id/);
  assert.match(generated, /recorder.transition/);
  assert.throws(() => generatePlaywrightSmoke(project, 'missing'), /Unknown machine/);
  assert.match(formatError(new WirestateError('bad', 'BAD', ['detail'])), /detail/);
  assert.match(formatError(new Error('plain')), /plain/);
  assert.equal(formatError('value'), 'value');
});

test('binding scanner supports attributes, decorators, and comments', () => {
  const values = scanBindings(`
    <button data-wirestate-id="save"></button>
    <main data-wirestate-state='app.ready'></main>
    @wirestate("service:ready")
    // wirestate: state:app.done
  `);
  assert.deepEqual(values, ['component:save', 'state:app.ready', 'service:ready', 'state:app.done']);
});
