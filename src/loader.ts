import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import type { LoadedSpecFile, NormalizedProject, WirestateFile } from './types.js';
import { loadConfig } from './config.js';
import { expandGlobs, pathExists } from './files.js';
import { validateWirestateFile } from './validate.js';
import { normalizeProject } from './normalize.js';
import { WirestateError } from './errors.js';

async function parseSpec(file: string): Promise<WirestateFile> {
  let parsed: unknown;
  try {
    parsed = parse(await fs.readFile(file, 'utf8'));
  } catch (error) {
    throw new WirestateError(`Could not parse ${file}`, 'SPEC_PARSE', [String(error)]);
  }
  validateWirestateFile(parsed, file);
  return parsed;
}

export async function loadSpecFiles(rootDir: string, initialFiles: string[]): Promise<LoadedSpecFile[]> {
  const loaded = new Map<string, LoadedSpecFile>();
  const visiting = new Set<string>();

  async function visit(file: string): Promise<void> {
    const absolute = path.resolve(file);
    if (loaded.has(absolute)) return;
    if (visiting.has(absolute)) throw new WirestateError(`Circular import involving ${absolute}`, 'IMPORT_CYCLE');
    if (!(await pathExists(absolute))) throw new WirestateError(`Imported spec does not exist: ${absolute}`, 'IMPORT_MISSING');
    visiting.add(absolute);
    const document = await parseSpec(absolute);
    for (const imported of document.imports ?? []) await visit(path.resolve(path.dirname(absolute), imported));
    visiting.delete(absolute);
    loaded.set(absolute, { path: absolute, document });
  }

  for (const file of initialFiles) await visit(file);
  return [...loaded.values()];
}

export async function loadProject(startDir = process.cwd()): Promise<NormalizedProject> {
  const { rootDir, configPath, config } = await loadConfig(startDir);
  const files = await expandGlobs(rootDir, config.specs, config.ignore);
  if (files.length === 0) {
    throw new WirestateError('No Wirestate spec files found', 'SPEC_NOT_FOUND', config.specs);
  }
  const loaded = await loadSpecFiles(rootDir, files);
  return normalizeProject(rootDir, config, loaded, configPath);
}
