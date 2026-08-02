import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import {
  WirestateRecorder,
  addComment,
  collectBrowserTrace,
  createSyncReport,
  expectedBindings,
  loadConfig,
  loadProject,
  loadSpecFiles,
  readTraceFiles,
  removeComment,
  updateComment,
  writePlaywrightSmoke
} from '../dist/index.js';
import { copyExample, exampleRoot, replaceInFile, tempDir } from './helpers.mjs';

test('source/spec sync passes and detects both directions of drift', async () => {
  const baseline = await loadProject(exampleRoot);
  const passing = await createSyncReport(baseline);
  assert.equal(passing.valid, true);
  assert.equal(passing.expected.length, 31);
  assert.deepEqual(passing.missingInCode, []);
  assert.deepEqual(passing.unknownInCode, []);
  assert.ok(expectedBindings(baseline).includes('component:habit.saveButton'));

  const codeChanged = await copyExample();
  await replaceInFile(path.join(codeChanged, 'src', 'shell', 'app.ts'), '// wirestate: component:habit.archiveButton\n', '');
  const codeReport = await createSyncReport(await loadProject(codeChanged));
  assert.equal(codeReport.valid, false);
  assert.deepEqual(codeReport.missingInCode, ['component:habit.archiveButton']);

  const specChanged = await copyExample();
  await replaceInFile(
    path.join(specChanged, 'src', 'habits', 'habits.wire.yml'),
    'bind: component:habit.archiveButton',
    'bind: component:habit.pauseButton'
  );
  const specReport = await createSyncReport(await loadProject(specChanged));
  assert.equal(specReport.valid, false);
  assert.ok(specReport.missingInCode.includes('component:habit.pauseButton'));
  assert.ok(specReport.unknownInCode.includes('component:habit.archiveButton'));
});

test('comments are added, updated, and removed in YAML files', async () => {
  const root = await copyExample();
  let project = await loadProject(root);
  const added = await addComment(project, { id: 'test_comment', target: 'component:habit.addButton', body: 'New behavior', author: 'qa' });
  assert.equal(added.status, 'open');

  project = await loadProject(root);
  assert.ok(project.comments.some((item) => item.id === 'test_comment'));
  const updated = await updateComment(project, 'test_comment', { body: 'Updated behavior', status: 'resolved' });
  assert.equal(updated.body, 'Updated behavior');
  assert.equal(updated.status, 'resolved');

  project = await loadProject(root);
  await removeComment(project, 'test_comment');
  project = await loadProject(root);
  assert.equal(project.comments.some((item) => item.id === 'test_comment'), false);
  await assert.rejects(() => updateComment(project, 'missing', { body: 'x' }), /Unknown comment/);
  await assert.rejects(() => removeComment(project, 'missing'), /Unknown comment/);
  await assert.rejects(() => addComment(project, { target: '', body: '' }), /required/);
});

test('trace recorder and browser collector produce NDJSON', async () => {
  const root = await tempDir();
  const recorder = new WirestateRecorder({ outputDir: root, testName: 'my test' });
  recorder.state('app', 'idle');
  recorder.transition('app', 'idle', 'GO', 'done');
  recorder.component('save', 'click');
  assert.equal(recorder.snapshot().length, 3);
  await collectBrowserTrace({
    async evaluate() {
      return [
        { type: 'state', machine: 'other', state: 'ready' },
        { type: 'transition', machine: 'other', from: 'ready', event: 'STOP', to: 'idle' },
        { type: 'component', id: 'other.button', action: 'click' }
      ];
    }
  }, recorder);
  const output = await recorder.flush();
  assert.match(output, /my-test\.ndjson$/);
  const events = await readTraceFiles([output]);
  assert.equal(events.length, 6);
  assert.equal(events[5].type, 'component');
});

test('writes generated smoke tests to nested paths', async () => {
  const root = await copyExample();
  const project = await loadProject(root);
  await writePlaywrightSmoke(project, 'habits.app', 'generated/smoke.spec.ts');
  const content = await readFile(path.join(root, 'generated', 'smoke.spec.ts'), 'utf8');
  assert.match(content, /WirestateRecorder/);
  assert.match(content, /habit\.saveButton/);
});

test('project and global configuration merge predictably', async () => {
  const root = await tempDir();
  await mkdir(path.join(root, 'specs'));
  await writeFile(path.join(root, 'specs', 'one.wire.yml'), 'wirestate: 1\nmachines:\n  app:\n    initial: idle\n    states:\n      idle: {}\n');
  await writeFile(path.join(root, 'wirestate.config.yml'), 'coverage:\n  states: 75\nserver:\n  port: 4567\n');
  const globalFile = path.join(root, 'global.yml');
  await writeFile(globalFile, 'coverage:\n  transitions: 50\nstrict:\n  bindings: false\n');
  const previous = process.env.WIRESTATE_GLOBAL_CONFIG;
  process.env.WIRESTATE_GLOBAL_CONFIG = globalFile;
  try {
    const result = await loadConfig(path.join(root, 'specs'));
    assert.equal(result.rootDir, root);
    assert.equal(result.config.coverage.states, 75);
    assert.equal(result.config.coverage.transitions, 50);
    assert.equal(result.config.strict.bindings, false);
    assert.equal(result.config.server.port, 4567);
  } finally {
    if (previous === undefined) delete process.env.WIRESTATE_GLOBAL_CONFIG;
    else process.env.WIRESTATE_GLOBAL_CONFIG = previous;
  }
});

test('loader reports missing imports and cycles', async () => {
  const root = await tempDir();
  const a = path.join(root, 'a.wire.yml');
  const b = path.join(root, 'b.wire.yml');
  await writeFile(a, 'wirestate: 1\nimports: [b.wire.yml]\n');
  await writeFile(b, 'wirestate: 1\nimports: [a.wire.yml]\n');
  await assert.rejects(() => loadSpecFiles(root, [a]), /Circular import/);
  await writeFile(a, 'wirestate: 1\nimports: [missing.wire.yml]\n');
  await assert.rejects(() => loadSpecFiles(root, [a]), /does not exist/);
});
