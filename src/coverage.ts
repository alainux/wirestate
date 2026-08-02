import type { CoverageReport, NormalizedProject, TraceEvent } from './types.js';
import { allTransitions, leafStates, resolveReachedState, transitionKey } from './graph.js';

function percent(visited: number, total: number): number {
  return total === 0 ? 100 : Math.round((visited / total) * 10000) / 100;
}

function canonicalState(machine: string, state: string): string {
  return state.startsWith(`${machine}.`) ? state : `${machine}.${state}`;
}

export function createCoverageReport(project: NormalizedProject, events: TraceEvent[]): CoverageReport {
  const expectedStates = new Set<string>();
  const expectedTransitions = new Set<string>();
  const componentIds = new Set<string>();
  for (const machine of Object.values(project.machines)) {
    leafStates(machine).forEach((state) => expectedStates.add(state.id));
    allTransitions(machine).forEach((transition) => expectedTransitions.add(transitionKey(transition.source, transition.event, resolveReachedState(machine, transition.target))));
  }
  const visitComponent = (component: { id?: string; children?: unknown[] }): void => {
    if (component.id) componentIds.add(component.id);
    for (const child of component.children ?? []) visitComponent(child as { id?: string; children?: unknown[] });
  };
  Object.values(project.screens).forEach((screen) => visitComponent(screen.root));

  const visitedStates = new Set<string>();
  const unknownStates = new Set<string>();
  const visitedTransitions = new Set<string>();
  const unknownTransitions = new Set<string>();
  const touchedComponents = new Set<string>();
  const unknownComponents = new Set<string>();
  const errors: string[] = [];

  for (const event of events) {
    if (event.type === 'state') {
      const id = canonicalState(event.machine, event.state);
      if (expectedStates.has(id)) visitedStates.add(id);
      else unknownStates.add(id);
    } else if (event.type === 'transition') {
      const source = canonicalState(event.machine, event.from);
      const target = canonicalState(event.machine, event.to);
      const key = transitionKey(source, event.event, target);
      if (expectedTransitions.has(key)) visitedTransitions.add(key);
      else unknownTransitions.add(key);
      if (expectedStates.has(target)) visitedStates.add(target);
      else unknownStates.add(target);
    } else {
      if (componentIds.has(event.id)) touchedComponents.add(event.id);
      else unknownComponents.add(event.id);
    }
  }

  if (unknownStates.size) errors.push(`${unknownStates.size} unknown state(s) were observed`);
  if (unknownTransitions.size) errors.push(`${unknownTransitions.size} invalid transition(s) were observed`);
  if (unknownComponents.size) errors.push(`${unknownComponents.size} unknown component(s) were observed`);

  const statePercent = percent(visitedStates.size, expectedStates.size);
  const transitionPercent = percent(visitedTransitions.size, expectedTransitions.size);
  if (statePercent < project.config.coverage.states) errors.push(`state coverage ${statePercent}% is below ${project.config.coverage.states}%`);
  if (transitionPercent < project.config.coverage.transitions) {
    errors.push(`transition coverage ${transitionPercent}% is below ${project.config.coverage.transitions}%`);
  }

  return {
    states: {
      total: expectedStates.size,
      visited: visitedStates.size,
      percent: statePercent,
      missing: [...expectedStates].filter((id) => !visitedStates.has(id)).sort(),
      unknown: [...unknownStates].sort()
    },
    transitions: {
      total: expectedTransitions.size,
      visited: visitedTransitions.size,
      percent: transitionPercent,
      missing: [...expectedTransitions].filter((id) => !visitedTransitions.has(id)).sort(),
      unknown: [...unknownTransitions].sort()
    },
    components: {
      touched: [...touchedComponents].sort(),
      unknown: [...unknownComponents].sort()
    },
    valid: errors.length === 0,
    errors
  };
}
