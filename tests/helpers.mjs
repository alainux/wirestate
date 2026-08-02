import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

export const repoRoot = path.resolve(new URL('..', import.meta.url).pathname);
export const exampleRoot = path.join(repoRoot, 'examples', 'habit-tracker');

export async function tempDir(prefix = 'wirestate-test-') {
  return mkdtemp(path.join(tmpdir(), prefix));
}

export async function copyExample() {
  const target = await tempDir('wirestate-example-');
  await cp(exampleRoot, target, { recursive: true });
  return target;
}

export async function replaceInFile(file, search, replacement) {
  const content = await readFile(file, 'utf8');
  if (!content.includes(search)) throw new Error(`Could not find replacement text in ${file}`);
  await writeFile(file, content.replace(search, replacement), 'utf8');
}

export function captureIO() {
  let stdout = '';
  let stderr = '';
  return {
    io: {
      stdout: { write(value) { stdout += String(value); return true; } },
      stderr: { write(value) { stderr += String(value); return true; } }
    },
    get stdout() { return stdout; },
    get stderr() { return stderr; }
  };
}
