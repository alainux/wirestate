import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import type { Habit } from '../habits/model.js';

// wirestate: machine:habits.sync
// wirestate: state:habits.sync.idle
// wirestate: state:habits.sync.reading
// wirestate: state:habits.sync.uploading
// wirestate: state:habits.sync.complete
// wirestate: state:habits.sync.failed

type SyncState = 'idle' | 'reading' | 'uploading' | 'complete' | 'failed';
let state: SyncState = 'idle';
const machine = 'habits.sync';

function emit(value: object): void { process.stdout.write(`${JSON.stringify(value)}\n`); }
function move(next: SyncState, event: string): void {
  emit({ type: 'transition', machine, from: state, event, to: next });
  state = next;
  emit({ type: 'state', machine, state });
}

async function main(): Promise<void> {
  emit({ type: 'state', machine, state });
  move('reading', 'START');
  const exampleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const input = path.resolve(process.argv[2] ?? path.join(exampleRoot, 'data/habits.json'));
  try {
    const habits = JSON.parse(await readFile(input, 'utf8')) as Habit[];
    move('uploading', 'READ_OK');
    const output = path.resolve(process.argv[3] ?? path.join(exampleRoot, 'data/export.json'));
    await writeFile(output, JSON.stringify({ exportedAt: new Date().toISOString(), habits }, null, 2));
    move('complete', 'SUCCESS');
  } catch (error) {
    move('failed', state === 'reading' ? 'READ_FAILED' : 'FAILURE');
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

await main();
