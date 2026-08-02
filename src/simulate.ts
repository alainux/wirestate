import type { InteractionDefinition, NormalizedMachine, NormalizedState, NormalizedTransition } from './types.js';
import { findTransition, resolveReachedState } from './graph.js';
import { WirestateError } from './errors.js';

export interface SimulationStep {
  from: string;
  event: string;
  to: string;
  transition: NormalizedTransition;
}

function canonicalState(machine: NormalizedMachine, stateId: string): string {
  return stateId.startsWith(`${machine.id}.`) ? stateId : `${machine.id}.${stateId}`;
}

export function availableTransitions(machine: NormalizedMachine, stateId: string): NormalizedTransition[] {
  const canonical = canonicalState(machine, stateId);
  let current: NormalizedState | undefined = machine.states[canonical];
  if (!current) throw new WirestateError(`Unknown state ${canonical}`, 'STATE_UNKNOWN');
  const transitions: NormalizedTransition[] = [];
  while (current) {
    transitions.push(...current.transitions);
    current = current.parent ? machine.states[current.parent] : undefined;
  }
  return transitions;
}

export function jumpMachine(machine: NormalizedMachine, stateId: string): { state: string } {
  const canonical = canonicalState(machine, stateId);
  return { state: resolveReachedState(machine, canonical) };
}

export function stepMachine(
  machine: NormalizedMachine,
  stateId: string,
  event: string,
  preferredTarget?: string
): SimulationStep {
  const canonical = canonicalState(machine, stateId);
  const candidates = findTransition(machine, canonical, event);
  if (candidates.length === 0) throw new WirestateError(`Event ${event} is not accepted in ${canonical}`, 'EVENT_REJECTED');
  let transition = candidates[0];
  if (preferredTarget) {
    const target = preferredTarget.startsWith(`${machine.id}.`) ? preferredTarget : `${machine.id}.${preferredTarget}`;
    transition = candidates.find((candidate) => candidate.target === target);
    if (!transition) throw new WirestateError(`No ${event} transition targets ${target}`, 'TRANSITION_CHOICE');
  }
  if (!transition) throw new WirestateError(`No transition selected for ${event}`, 'TRANSITION_CHOICE');
  return {
    from: canonical,
    event,
    to: resolveReachedState(machine, transition.target),
    transition
  };
}

export function stepComponent(
  machine: NormalizedMachine,
  stateId: string,
  component: string,
  kind: InteractionDefinition['kind'],
  preferredEvent?: string
): SimulationStep {
  const candidates = availableTransitions(machine, stateId).filter((transition) => {
    const interaction = transition.interaction;
    return interaction?.component === component && interaction.kind === kind && (!preferredEvent || transition.event === preferredEvent);
  });
  if (candidates.length === 0) {
    throw new WirestateError(
      `No ${kind} interaction for component ${component} is accepted in ${canonicalState(machine, stateId)}`,
      'INTERACTION_REJECTED'
    );
  }
  if (candidates.length > 1 && !preferredEvent) {
    throw new WirestateError(
      `Component ${component} has multiple ${kind} interactions; choose an event`,
      'INTERACTION_CHOICE',
      candidates.map((candidate) => candidate.event)
    );
  }
  const transition = candidates[0];
  if (!transition) throw new WirestateError(`No interaction selected for ${component}`, 'INTERACTION_CHOICE');
  return stepMachine(machine, stateId, transition.event, transition.target);
}

export function simulateMachine(machine: NormalizedMachine, events: string[]): { initial: string; final: string; steps: SimulationStep[] } {
  let state = machine.initialState;
  const steps: SimulationStep[] = [];
  for (const event of events) {
    const step = stepMachine(machine, state, event);
    steps.push(step);
    state = step.to;
  }
  return { initial: machine.initialState, final: state, steps };
}
