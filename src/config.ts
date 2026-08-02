import { homedir } from 'node:os';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import type { WirestateConfig } from './types.js';
import { pathExists } from './files.js';
import { WirestateError } from './errors.js';

export const DEFAULT_CONFIG: WirestateConfig = {
  specs: ['specs/**/*.wire.yml', 'specs/**/*.wire.yaml'],
  source: ['src/**/*', 'app/**/*', 'tests/**/*'],
  ignore: ['node_modules/**', 'dist/**', 'coverage/**', '.git/**', '.wirestate/**'],
  trace: ['.wirestate/traces/**/*.ndjson', '.wirestate/traces/**/*.json'],
  strict: { bindings: true, comments: false },
  coverage: { states: 0, transitions: 0 },
  server: { port: 4177, open: false }
};

export interface ConfigResult {
  rootDir: string;
  configPath?: string;
  config: WirestateConfig;
}

function mergeConfig(base: WirestateConfig, input: Partial<WirestateConfig>): WirestateConfig {
  return {
    specs: input.specs ?? base.specs,
    source: input.source ?? base.source,
    ignore: input.ignore ?? base.ignore,
    trace: input.trace ?? base.trace,
    strict: { ...base.strict, ...(input.strict ?? {}) },
    coverage: { ...base.coverage, ...(input.coverage ?? {}) },
    server: { ...base.server, ...(input.server ?? {}) }
  };
}

async function readConfig(file: string): Promise<Partial<WirestateConfig>> {
  try {
    const value = parse(await fs.readFile(file, 'utf8')) as Partial<WirestateConfig> | null;
    return value ?? {};
  } catch (error) {
    throw new WirestateError(`Could not read config ${file}`, 'CONFIG_READ', [String(error)]);
  }
}

export async function findProjectConfig(startDir: string): Promise<string | undefined> {
  let current = path.resolve(startDir);
  while (true) {
    for (const name of ['wirestate.config.yml', 'wirestate.config.yaml', '.wirestate.yml', '.wirestate.yaml']) {
      const candidate = path.join(current, name);
      if (await pathExists(candidate)) return candidate;
    }
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

export async function loadConfig(startDir = process.cwd()): Promise<ConfigResult> {
  const projectPath = await findProjectConfig(startDir);
  const rootDir = projectPath ? path.dirname(projectPath) : path.resolve(startDir);
  const globalPath = process.env.WIRESTATE_GLOBAL_CONFIG
    ? path.resolve(process.env.WIRESTATE_GLOBAL_CONFIG)
    : path.join(homedir(), '.config', 'wirestate', 'config.yml');

  let config = DEFAULT_CONFIG;
  if (await pathExists(globalPath)) config = mergeConfig(config, await readConfig(globalPath));
  if (projectPath) config = mergeConfig(config, await readConfig(projectPath));

  validateConfig(config);
  return { rootDir, ...(projectPath ? { configPath: projectPath } : {}), config };
}

export function validateConfig(config: WirestateConfig): void {
  const errors: string[] = [];
  if (!Array.isArray(config.specs) || config.specs.length === 0) errors.push('specs must contain at least one glob');
  if (!Array.isArray(config.source)) errors.push('source must be an array');
  if (!Array.isArray(config.trace)) errors.push('trace must be an array');
  for (const [key, value] of Object.entries(config.coverage)) {
    if (typeof value !== 'number' || value < 0 || value > 100) errors.push(`coverage.${key} must be between 0 and 100`);
  }
  if (!Number.isInteger(config.server.port) || config.server.port < 1 || config.server.port > 65535) {
    errors.push('server.port must be a valid TCP port');
  }
  if (errors.length) throw new WirestateError('Invalid Wirestate configuration', 'CONFIG_INVALID', errors);
}
