import { promises as fs } from 'node:fs';
import path from 'node:path';

export async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

export async function walkFiles(root: string, ignored: string[] = []): Promise<string[]> {
  const output: string[] = [];
  const ignoreMatchers = ignored.map(globToRegExp);

  async function visit(directory: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      const relative = slash(path.relative(root, absolute));
      if (ignoreMatchers.some((matcher) => matcher.test(relative) || matcher.test(`${relative}/`))) continue;
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.isFile()) output.push(absolute);
    }
  }

  await visit(root);
  return output.sort();
}

export function slash(value: string): string {
  return value.split(path.sep).join('/');
}

export function globToRegExp(pattern: string): RegExp {
  const normalized = slash(pattern).replace(/^\.\//, '');
  let result = '^';
  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    const next = normalized[index + 1];
    if (char === '*' && next === '*') {
      const after = normalized[index + 2];
      result += after === '/' ? '(?:.*/)?' : '.*';
      index += after === '/' ? 2 : 1;
    } else if (char === '*') result += '[^/]*';
    else if (char === '?') result += '[^/]';
    else result += char && /[|\\{}()[\]^$+?.]/.test(char) ? `\\${char}` : char;
  }
  return new RegExp(`${result}$`);
}

export async function expandGlobs(root: string, patterns: string[], ignored: string[] = []): Promise<string[]> {
  const files = await walkFiles(root, ignored);
  const matchers = patterns.map(globToRegExp);
  return files.filter((file) => matchers.some((matcher) => matcher.test(slash(path.relative(root, file)))));
}
