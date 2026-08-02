import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHabit, addChunks } from '../examples/habit-tracker/dist/habits/model.js';
import { goalProgress, chunksInCurrentPeriod } from '../examples/habit-tracker/dist/goals/progress.js';
import { exampleRoot, tempDir } from './helpers.mjs';

const execFileAsync = promisify(execFile);

test('the TypeScript example models goals and period progress', () => {
  const habit = createHabit({ name: 'Read', chunkLabel: '10 minutes', targetChunks: 3, period: 'week' });
  const monday = new Date('2026-07-27T10:00:00.000Z');
  const progressed = addChunks(addChunks(habit, 1, monday), 2, new Date('2026-07-29T10:00:00.000Z'));
  assert.deepEqual(goalProgress(progressed, new Date('2026-08-02T10:00:00.000Z')), { current: 3, target: 3, reached: true });
  assert.equal(chunksInCurrentPeriod(progressed.entries, 'day', new Date('2026-08-02T10:00:00.000Z')), 0);
  assert.throws(() => createHabit({ name: '', chunkLabel: 'minutes', targetChunks: 1, period: 'day' }), /required/);
  assert.throws(() => addChunks(habit, 0), /positive integer/);
});

test('the behavior-only sync machine is a runnable CLI entry point', async () => {
  const root = await tempDir('wirestate-sync-cli-');
  const input = path.join(root, 'habits.json');
  const output = path.join(root, 'export.json');
  await writeFile(input, JSON.stringify([{ id: 'read', name: 'Read', chunkLabel: '10 minutes', targetChunks: 5, period: 'week', archived: false, entries: [] }]));
  const { stdout, stderr } = await execFileAsync(process.execPath, [path.join(exampleRoot, 'dist', 'sync-cli', 'index.js'), input, output]);
  assert.equal(stderr, '');
  assert.match(stdout, /"event":"START"/);
  assert.match(stdout, /"event":"SUCCESS"/);
  const exported = JSON.parse(await readFile(output, 'utf8'));
  assert.equal(exported.habits[0].name, 'Read');
});

test('the example colocates TypeScript modules and Wirestate specifications', async () => {
  for (const module of ['shell', 'habits', 'goals', 'sync-cli']) {
    const files = await readdir(path.join(exampleRoot, 'src', module));
    assert.ok(files.some((file) => file.endsWith('.ts')), `${module} needs TypeScript implementation`);
    assert.ok(files.some((file) => file.endsWith('.wire.yml')), `${module} needs a colocated Wirestate spec`);
  }
});

test('the checked-in site preview is a real generated screenshot and no fake live status remains', async () => {
  const home = await readFile(path.resolve('site/index.html'), 'utf8');
  const studio = await readFile(path.resolve('public/index.html'), 'utf8');
  const screenshot = await readFile(path.resolve('site/assets/studio.png'));
  assert.match(home, /assets\/studio\.png/);
  assert.doesNotMatch(home, /graph-demo|mockup|product-window/);
  assert.doesNotMatch(studio, /live-pill|>Live</);
  assert.deepEqual([...screenshot.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.ok(screenshot.length > 100_000);
});
