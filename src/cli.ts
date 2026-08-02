#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { loadProject } from './loader.js';
import { formatError, WirestateError } from './errors.js';
import { graphAsDot, reachableStates } from './graph.js';
import { createCoverageReport } from './coverage.js';
import { createSyncReport } from './sync.js';
import { expandGlobs, pathExists } from './files.js';
import { readTraceFiles } from './trace.js';
import { startServer } from './server.js';
import { addComment, removeComment, updateComment } from './comments.js';
import { writePlaywrightSmoke } from './smoke.js';
import { jumpMachine, simulateMachine, stepComponent } from './simulate.js';

interface CliIO {
  stdout: Pick<NodeJS.WriteStream, 'write'>;
  stderr: Pick<NodeJS.WriteStream, 'write'>;
}

function takeOption(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  args.splice(index, value === undefined ? 1 : 2);
  return value;
}

function takeFlag(args: string[], name: string): boolean {
  const index = args.indexOf(name);
  if (index < 0) return false;
  args.splice(index, 1);
  return true;
}

function requireOption(args: string[], name: string): string {
  const value = takeOption(args, name);
  if (!value) throw new WirestateError(`${name} is required`, 'CLI_ARGUMENT');
  return value;
}

function write(io: CliIO, value: unknown, json = false): void {
  io.stdout.write(json ? `${JSON.stringify(value, null, 2)}\n` : `${String(value)}\n`);
}

function help(): string {
  return `Wirestate — visual, executable state-machine specifications

Usage:
  wirestate init [--cwd DIR]
  wirestate validate [--json]
  wirestate inspect [--json]
  wirestate graph [MACHINE] [--dot|--json]
  wirestate simulate --machine ID --events EVENT,EVENT [--json]
  wirestate jump --machine ID --state ID [--json]
  wirestate interact --machine ID --state ID --component ID --kind click|fill|toggle|submit|wait|custom [--event EVENT] [--json]
  wirestate sync [--json]
  wirestate coverage [TRACE...] [--json]
  wirestate check [--json]
  wirestate serve [--port PORT] [--open]
  wirestate comment list [--target ID] [--json]
  wirestate comment add --target ID --body TEXT [--author NAME] [--file PATH]
  wirestate comment update ID [--body TEXT] [--status open|resolved] [--file PATH]
  wirestate comment remove ID [--file PATH]
  wirestate smoke generate --machine ID --out FILE

Global options:
  --cwd DIR   Project directory
`;
}

async function initProject(cwd: string): Promise<void> {
  const configFile = path.join(cwd, 'wirestate.config.yml');
  const specFile = path.join(cwd, 'specs', 'app.wire.yml');
  if (await pathExists(configFile) || await pathExists(specFile)) {
    throw new WirestateError('Wirestate files already exist in this directory', 'INIT_EXISTS');
  }
  await fs.mkdir(path.dirname(specFile), { recursive: true });
  await fs.writeFile(configFile, `specs:\n  - specs/**/*.wire.yml\nsource:\n  - src/**/*\nstrict:\n  bindings: true\ncoverage:\n  states: 0\n  transitions: 0\n`, 'utf8');
  await fs.writeFile(specFile, `wirestate: 1\nnamespace: app\n\nmachines:\n  main:\n    initial: idle\n    states:\n      idle:\n        spec: The application is ready.\n`, 'utf8');
}

function formatCoverage(report: ReturnType<typeof createCoverageReport>): string {
  const lines = [
    `State coverage:      ${report.states.visited}/${report.states.total} (${report.states.percent}%)`,
    `Transition coverage: ${report.transitions.visited}/${report.transitions.total} (${report.transitions.percent}%)`
  ];
  if (report.states.missing.length) lines.push(`Missing states:\n  ${report.states.missing.join('\n  ')}`);
  if (report.transitions.missing.length) lines.push(`Missing transitions:\n  ${report.transitions.missing.join('\n  ')}`);
  if (report.errors.length) lines.push(`Errors:\n  ${report.errors.join('\n  ')}`);
  return lines.join('\n');
}

function formatSync(report: Awaited<ReturnType<typeof createSyncReport>>): string {
  const lines = [`Bindings: ${report.found.length}/${report.expected.length} found`];
  if (report.missingInCode.length) lines.push(`Missing in code:\n  ${report.missingInCode.join('\n  ')}`);
  if (report.unknownInCode.length) lines.push(`Unknown in code:\n  ${report.unknownInCode.join('\n  ')}`);
  if (report.duplicateBindings.length) lines.push(`Duplicate bindings:\n  ${report.duplicateBindings.join('\n  ')}`);
  return lines.join('\n');
}

export async function runCli(argv = process.argv.slice(2), io: CliIO = { stdout: process.stdout, stderr: process.stderr }): Promise<number> {
  const args = [...argv];
  const cwd = path.resolve(takeOption(args, '--cwd') ?? process.cwd());
  const json = takeFlag(args, '--json');
  const command = args.shift();
  if (!command || command === 'help' || command === '--help' || command === '-h') {
    write(io, help());
    return 0;
  }
  if (command === 'init') {
    await initProject(cwd);
    write(io, `Created ${path.join(cwd, 'wirestate.config.yml')} and specs/app.wire.yml`);
    return 0;
  }

  const project = await loadProject(cwd);
  if (command === 'validate') {
    const result = {
      valid: project.warnings.length === 0,
      files: project.files.map((file) => path.relative(project.rootDir, file.path)),
      machines: Object.keys(project.machines),
      screens: Object.keys(project.screens),
      warnings: project.warnings
    };
    write(io, json ? result : `${result.valid ? 'Valid' : 'Valid with warnings'}: ${result.files.length} files, ${result.machines.length} machines, ${result.screens.length} screens`, json);
    if (!json && result.warnings.length) write(io, result.warnings.map((warning) => `- ${warning}`).join('\n'));
    return result.valid ? 0 : 1;
  }
  if (command === 'inspect') {
    write(io, project, true);
    return 0;
  }
  if (command === 'graph') {
    const machineId = args[0];
    if (takeFlag(args, '--dot')) write(io, graphAsDot(project, machineId));
    else {
      const machines = machineId ? [project.machines[machineId]].filter(Boolean) : Object.values(project.machines);
      if (machineId && machines.length === 0) throw new WirestateError(`Unknown machine: ${machineId}`, 'MACHINE_UNKNOWN');
      const result = machines.map((machine) => machine && ({
        id: machine.id,
        initial: machine.initialState,
        reachable: [...reachableStates(machine)].sort(),
        states: Object.values(machine.states),
      }));
      write(io, result, json || true);
    }
    return 0;
  }
  if (command === 'simulate') {
    const machineId = requireOption(args, '--machine');
    const eventList = requireOption(args, '--events').split(',').map((item) => item.trim()).filter(Boolean);
    const machine = project.machines[machineId];
    if (!machine) throw new WirestateError(`Unknown machine: ${machineId}`, 'MACHINE_UNKNOWN');
    const result = simulateMachine(machine, eventList);
    write(io, json ? result : result.steps.map((step) => `${step.from} --${step.event}--> ${step.to}`).join('\n'), json);
    return 0;
  }
  if (command === 'jump') {
    const machineId = requireOption(args, '--machine');
    const stateId = requireOption(args, '--state');
    const machine = project.machines[machineId];
    if (!machine) throw new WirestateError(`Unknown machine: ${machineId}`, 'MACHINE_UNKNOWN');
    const result = jumpMachine(machine, stateId);
    write(io, json ? result : result.state, json);
    return 0;
  }
  if (command === 'interact') {
    const machineId = requireOption(args, '--machine');
    const stateId = requireOption(args, '--state');
    const component = requireOption(args, '--component');
    const kindValue = requireOption(args, '--kind');
    const kinds = new Set(['click', 'fill', 'toggle', 'submit', 'wait', 'custom']);
    if (!kinds.has(kindValue)) throw new WirestateError('kind must be click, fill, toggle, submit, wait, or custom', 'CLI_ARGUMENT');
    const machine = project.machines[machineId];
    if (!machine) throw new WirestateError(`Unknown machine: ${machineId}`, 'MACHINE_UNKNOWN');
    const result = stepComponent(
      machine,
      stateId,
      component,
      kindValue as 'click' | 'fill' | 'toggle' | 'submit' | 'wait' | 'custom',
      takeOption(args, '--event')
    );
    write(io, json ? result : `${result.from} --${result.event} [${kindValue}:${component}]--> ${result.to}`, json);
    return 0;
  }
  if (command === 'sync') {
    const report = await createSyncReport(project);
    write(io, json ? report : formatSync(report), json);
    return report.valid ? 0 : 1;
  }
  if (command === 'coverage') {
    const explicit = args.filter((arg) => !arg.startsWith('--')).map((file) => path.resolve(cwd, file));
    const files = explicit.length ? explicit : await expandGlobs(project.rootDir, project.config.trace, project.config.ignore);
    const report = createCoverageReport(project, await readTraceFiles(files));
    write(io, json ? report : formatCoverage(report), json);
    return report.valid ? 0 : 1;
  }
  if (command === 'check') {
    const sync = await createSyncReport(project);
    const traceFiles = await expandGlobs(project.rootDir, project.config.trace, project.config.ignore);
    const coverage = createCoverageReport(project, await readTraceFiles(traceFiles));
    const valid = project.warnings.length === 0 && sync.valid && coverage.valid;
    const result = { valid, warnings: project.warnings, sync, coverage };
    write(io, json ? result : `${formatSync(sync)}\n\n${formatCoverage(coverage)}\n\n${valid ? 'CHECK PASSED' : 'CHECK FAILED'}`, json);
    return valid ? 0 : 1;
  }
  if (command === 'serve') {
    const portValue = takeOption(args, '--port');
    const server = await startServer({ cwd, ...(portValue ? { port: Number(portValue) } : {}), open: takeFlag(args, '--open') });
    write(io, `Wirestate running at ${server.url}`);
    await new Promise<void>((resolve) => {
      const stop = () => void server.close().then(resolve);
      process.once('SIGINT', stop);
      process.once('SIGTERM', stop);
    });
    return 0;
  }
  if (command === 'comment') {
    const action = args.shift();
    if (action === 'list') {
      const target = takeOption(args, '--target');
      const comments = target ? project.comments.filter((comment) => comment.target === target) : project.comments;
      write(io, json ? comments : comments.map((comment) => `${comment.id} [${comment.status ?? 'open'}] ${comment.target}: ${comment.body}`).join('\n'), json);
      return 0;
    }
    const file = takeOption(args, '--file');
    if (action === 'add') {
      const comment = await addComment(project, {
        target: requireOption(args, '--target'),
        body: requireOption(args, '--body'),
        author: takeOption(args, '--author')
      }, file);
      write(io, comment, true);
      return 0;
    }
    const id = args.shift();
    if (!id) throw new WirestateError('comment id is required', 'CLI_ARGUMENT');
    if (action === 'update') {
      const statusValue = takeOption(args, '--status');
      const status = statusValue as 'open' | 'resolved' | undefined;
      if (statusValue && statusValue !== 'open' && statusValue !== 'resolved') throw new WirestateError('status must be open or resolved', 'CLI_ARGUMENT');
      const comment = await updateComment(project, id, {
        body: takeOption(args, '--body'),
        target: takeOption(args, '--target'),
        author: takeOption(args, '--author'),
        ...(status ? { status } : {})
      }, file);
      write(io, comment, true);
      return 0;
    }
    if (action === 'remove') {
      await removeComment(project, id, file);
      write(io, `Removed ${id}`);
      return 0;
    }
    throw new WirestateError(`Unknown comment action: ${action ?? ''}`, 'CLI_COMMAND');
  }
  if (command === 'smoke' && args.shift() === 'generate') {
    const machine = requireOption(args, '--machine');
    const output = requireOption(args, '--out');
    await writePlaywrightSmoke(project, machine, output);
    write(io, `Generated ${path.resolve(project.rootDir, output)}`);
    return 0;
  }
  throw new WirestateError(`Unknown command: ${command}`, 'CLI_COMMAND');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCli().then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    process.stderr.write(`${formatError(error)}\n`);
    process.exitCode = 1;
  });
}
