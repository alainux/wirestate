import type { NormalizedMachine, NormalizedProject, NormalizedState } from './types.js';
import { descendInitial } from './normalize.js';
import { WirestateError } from './errors.js';

export function leafStates(machine: NormalizedMachine): NormalizedState[] {
  return Object.values(machine.states).filter((state) => state.childStates.length === 0);
}

export function allTransitions(machine: NormalizedMachine) {
  return Object.values(machine.states).flatMap((state) => state.transitions);
}

export function transitionKey(source: string, event: string, target: string): string {
  return `${source}|${event}|${target}`;
}

export function resolveReachedState(machine: NormalizedMachine, stateId: string): string {
  if (!machine.states[stateId]) throw new WirestateError(`Unknown state ${stateId}`, 'STATE_UNKNOWN');
  return descendInitial(stateId, machine.states);
}

export function reachableStates(machine: NormalizedMachine): Set<string> {
  const visited = new Set<string>();
  const queue = [machine.initialState];
  while (queue.length) {
    const currentId = queue.shift();
    if (!currentId || visited.has(currentId)) continue;
    visited.add(currentId);
    const current = machine.states[currentId];
    if (!current) continue;
    for (const transition of current.transitions) {
      const reached = resolveReachedState(machine, transition.target);
      if (!visited.has(reached)) queue.push(reached);
    }
    let parentId = current.parent;
    while (parentId) {
      const parent = machine.states[parentId];
      if (!parent) break;
      for (const transition of parent.transitions) {
        const reached = resolveReachedState(machine, transition.target);
        if (!visited.has(reached)) queue.push(reached);
      }
      parentId = parent.parent;
    }
  }
  return visited;
}

export function findTransition(machine: NormalizedMachine, stateId: string, event: string) {
  let current = machine.states[stateId];
  while (current) {
    const candidates = current.transitions.filter((transition) => transition.event === event);
    if (candidates.length) return candidates;
    current = current.parent ? machine.states[current.parent] : undefined;
  }
  return [];
}

export function graphAsDot(project: NormalizedProject, machineId?: string): string {
  const selected = machineId ? [project.machines[machineId]].filter(Boolean) : Object.values(project.machines);
  if (machineId && selected.length === 0) throw new WirestateError(`Unknown machine: ${machineId}`, 'MACHINE_UNKNOWN');
  const lines = ['digraph wirestate {', '  rankdir=LR;'];
  for (const machine of selected) {
    if (!machine) continue;
    lines.push(`  subgraph "cluster_${escapeDot(machine.id)}" {`, `    label="${escapeDot(machine.title ?? machine.id)}";`);
    for (const state of Object.values(machine.states)) {
      const shape = state.childStates.length ? 'box' : 'ellipse';
      lines.push(`    "${escapeDot(state.id)}" [label="${escapeDot(state.key)}", shape=${shape}];`);
    }
    lines.push(`    "${escapeDot(machine.id)}.__start" [shape=point];`);
    lines.push(`    "${escapeDot(machine.id)}.__start" -> "${escapeDot(machine.initialState)}";`);
    for (const transition of allTransitions(machine)) {
      lines.push(`    "${escapeDot(transition.source)}" -> "${escapeDot(transition.target)}" [label="${escapeDot(transition.event)}"];`);
    }
    lines.push('  }');
  }
  lines.push('}');
  return lines.join('\n');
}

function escapeDot(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}
