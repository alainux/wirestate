import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { startServer } from '../dist/index.js';
import { runCli } from '../dist/cli.js';
import { captureIO, copyExample, exampleRoot, tempDir } from './helpers.mjs';

test('HTTP server serves the dashboard, project, simulation, and comment APIs', async () => {
  const root = await copyExample();
  const server = await startServer({ cwd: root, port: 0, publicDir: path.resolve('public') });
  try {
    const html = await fetch(server.url).then((response) => response.text());
    assert.match(html, /Wirestate/);
    assert.match(html, /split-workspace/);
    assert.match(html, /Interactive wireframe/);
    const project = await fetch(`${server.url}/api/project`).then((response) => response.json());
    assert.ok(project.machines['habits.app']);

    const simulation = await fetch(`${server.url}/api/simulate`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ machine: 'habits.app', state: 'loading', event: 'LOADED' })
    }).then((response) => response.json());
    assert.equal(simulation.to, 'habits.app.ready.dashboard');

    const jump = await fetch(`${server.url}/api/jump`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ machine: 'habits.app', state: 'ready' })
    }).then((response) => response.json());
    assert.equal(jump.state, 'habits.app.ready.dashboard');

    const interaction = await fetch(`${server.url}/api/interact`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ machine: 'habits.app', state: 'ready.dashboard', component: 'habit.addButton', kind: 'click' })
    }).then((response) => response.json());
    assert.equal(interaction.to, 'habits.app.ready.adding');

    const badInteraction = await fetch(`${server.url}/api/interact`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ machine: 'habits.app', state: 'ready.dashboard', component: 'habit.addButton', kind: 'nope' })
    });
    assert.equal(badInteraction.status, 400);

    const added = await fetch(`${server.url}/api/comments`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'add', id: 'server_comment', target: 'state:habits.app.loading', body: 'Server comment' })
    });
    assert.equal(added.status, 201);
    const addedBody = await added.json();
    assert.equal(addedBody.id, 'server_comment');

    const updated = await fetch(`${server.url}/api/comments`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'update', id: 'server_comment', status: 'resolved' })
    });
    assert.equal(updated.status, 200);

    const removed = await fetch(`${server.url}/api/comments`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'remove', id: 'server_comment' })
    });
    assert.equal(removed.status, 200);

    const bad = await fetch(`${server.url}/api/simulate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(bad.status, 400);
    const missing = await fetch(`${server.url}/api/nope`);
    assert.equal(missing.status, 404);
  } finally {
    await server.close();
  }
});

test('CLI validates, checks, graphs, simulates, comments, and generates smoke tests', async () => {
  for (const args of [
    ['validate', '--cwd', exampleRoot],
    ['inspect', '--cwd', exampleRoot],
    ['graph', 'habits.app', '--dot', '--cwd', exampleRoot],
    ['simulate', '--machine', 'habits.app', '--events', 'LOADED,OPEN_ADD,SAVE_HABIT', '--cwd', exampleRoot],
    ['jump', '--machine', 'habits.app', '--state', 'ready', '--cwd', exampleRoot],
    ['interact', '--machine', 'habits.app', '--state', 'ready.dashboard', '--component', 'habit.addButton', '--kind', 'click', '--cwd', exampleRoot],
    ['sync', '--cwd', exampleRoot],
    ['coverage', '--cwd', exampleRoot],
    ['check', '--cwd', exampleRoot],
    ['comment', 'list', '--target', 'component:habit.saveButton', '--cwd', exampleRoot]
  ]) {
    const capture = captureIO();
    const code = await runCli(args, capture.io);
    assert.equal(code, 0, `${args.join(' ')} failed: ${capture.stdout}`);
    assert.ok(capture.stdout.length > 0);
  }

  const root = await copyExample();
  let capture = captureIO();
  assert.equal(await runCli(['comment', 'add', '--target', 'state:habits.app.loading', '--body', 'CLI comment', '--cwd', root], capture.io), 0);
  const comment = JSON.parse(capture.stdout);
  capture = captureIO();
  assert.equal(await runCli(['comment', 'update', comment.id, '--status', 'resolved', '--body', 'Updated', '--cwd', root], capture.io), 0);
  capture = captureIO();
  assert.equal(await runCli(['comment', 'remove', comment.id, '--cwd', root], capture.io), 0);

  capture = captureIO();
  assert.equal(await runCli(['smoke', 'generate', '--machine', 'habits.app', '--out', 'tests/generated.ts', '--cwd', root], capture.io), 0);
  assert.match(await readFile(path.join(root, 'tests', 'generated.ts'), 'utf8'), /generated smoke/);
});

test('CLI initializes a new project and returns useful argument errors', async () => {
  const root = await tempDir();
  let capture = captureIO();
  assert.equal(await runCli(['init', '--cwd', root], capture.io), 0);
  capture = captureIO();
  assert.equal(await runCli(['validate', '--cwd', root], capture.io), 0);
  await assert.rejects(() => runCli(['init', '--cwd', root], capture.io), /already exist/);
  await assert.rejects(() => runCli(['simulate', '--cwd', root], capture.io), /--machine is required/);
  await assert.rejects(() => runCli(['interact', '--machine', 'app.main', '--state', 'idle', '--component', 'x', '--kind', 'nope', '--cwd', root], capture.io), /kind must be/);
  await assert.rejects(() => runCli(['unknown', '--cwd', root], capture.io), /Unknown command/);
  capture = captureIO();
  assert.equal(await runCli(['help'], capture.io), 0);
  assert.match(capture.stdout, /Usage:/);
});


test('GitHub Pages site and agentic editing documentation are included', async () => {
  const home = await readFile(path.resolve('site/index.html'), 'utf8');
  const docs = await readFile(path.resolve('site/docs/index.html'), 'utf8');
  const readme = await readFile(path.resolve('README.md'), 'utf8');
  assert.match(home, /Make intended behavior visible/);
  assert.match(docs, /Why derived artifacts are not manually editable/);
  assert.match(readme, /specification-first, agentic development/);
});
