import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { NormalizedComponent, NormalizedProject, SyncReport } from './types.js';
import { expandGlobs, slash } from './files.js';

const PATTERNS: Array<{ regex: RegExp; map: (match: RegExpExecArray) => string }> = [
  { regex: /data-wirestate-id\s*=\s*["']([^"']+)["']/g, map: (match) => `component:${match[1]}` },
  { regex: /data-wirestate-state\s*=\s*["']([^"']+)["']/g, map: (match) => `state:${match[1]}` },
  { regex: /@wirestate\(\s*["']([^"']+)["']\s*\)/g, map: (match) => match[1] ?? '' },
  { regex: /wirestate:\s*([A-Za-z0-9_.:/-]+)/g, map: (match) => match[1] ?? '' }
];

export function expectedBindings(project: NormalizedProject): string[] {
  const output = new Set<string>();
  const visit = (component: NormalizedComponent): void => {
    if (component.bind) output.add(component.bind);
    for (const child of component.children) visit(child);
  };
  Object.values(project.screens).forEach((screen) => visit(screen.root));
  for (const machine of Object.values(project.machines)) {
    if (machine.bind) output.add(machine.bind);
    for (const state of Object.values(machine.states)) if (state.bind) output.add(state.bind);
  }
  return [...output].sort();
}

export function scanBindings(content: string): string[] {
  const found: string[] = [];
  for (const { regex, map } of PATTERNS) {
    regex.lastIndex = 0;
    let match;
    while ((match = regex.exec(content))) {
      const value = map(match);
      if (value) found.push(value);
    }
  }
  return found;
}

export async function createSyncReport(project: NormalizedProject): Promise<SyncReport> {
  const expected = expectedBindings(project);
  const files = await expandGlobs(project.rootDir, project.config.source, project.config.ignore);
  const occurrences = new Map<string, string[]>();
  for (const file of files) {
    let content: string;
    try {
      content = await fs.readFile(file, 'utf8');
    } catch {
      continue;
    }
    for (const binding of scanBindings(content)) {
      const list = occurrences.get(binding) ?? [];
      list.push(slash(path.relative(project.rootDir, file)));
      occurrences.set(binding, list);
    }
  }
  const found = [...occurrences.keys()].sort();
  const expectedSet = new Set(expected);
  const missingInCode = expected.filter((binding) => !occurrences.has(binding));
  const unknownInCode = found.filter((binding) => !expectedSet.has(binding));
  const duplicateBindings = [...occurrences.entries()]
    .filter(([, filesForBinding]) => filesForBinding.length > 1)
    .map(([binding]) => binding)
    .sort();
  const strictFailure = project.config.strict.bindings && (missingInCode.length > 0 || unknownInCode.length > 0);
  return {
    expected,
    found,
    missingInCode,
    unknownInCode,
    duplicateBindings,
    valid: !strictFailure
  };
}
