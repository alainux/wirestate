import path from 'node:path';
import type {
  ComponentDefinition,
  LoadedSpecFile,
  MachineDefinition,
  NormalizedComponent,
  NormalizedMachine,
  NormalizedProject,
  NormalizedScreen,
  NormalizedState,
  NormalizedTransition,
  StateDefinition,
  TransitionDefinition,
  WirestateConfig
} from './types.js';
import { WirestateError } from './errors.js';

function qualify(namespace: string | undefined, id: string): string {
  if (!namespace || id.includes('.')) return id;
  return `${namespace}.${id}`;
}

function mergeComponent(base: ComponentDefinition, override: ComponentDefinition): ComponentDefinition {
  return {
    ...base,
    ...override,
    props: { ...(base.props ?? {}), ...(override.props ?? {}) },
    layout: { ...(base.layout ?? {}), ...(override.layout ?? {}) },
    specs: [...(base.specs ?? []), ...(override.specs ?? [])],
    children: override.children ?? base.children
  };
}

function resolveComponent(
  input: ComponentDefinition,
  templates: Record<string, ComponentDefinition>,
  stack: string[] = []
): NormalizedComponent {
  let combined = input;
  if (input.use) {
    if (stack.includes(input.use)) throw new WirestateError('Circular component composition', 'COMPONENT_CYCLE', [...stack, input.use]);
    const template = templates[input.use];
    if (!template) throw new WirestateError(`Unknown component template: ${input.use}`, 'COMPONENT_UNKNOWN');
    combined = mergeComponent(resolveComponent(template, templates, [...stack, input.use]), { ...input, use: undefined });
  }
  if (!combined.type) throw new WirestateError('A resolved component has no type', 'COMPONENT_TYPE');
  return {
    ...combined,
    type: combined.type,
    children: (combined.children ?? []).map((child) => resolveComponent(child, templates, stack))
  };
}

function normalizeTransition(
  definition: TransitionDefinition,
  machineId: string,
  source: string,
  event: string,
  index: number,
  stateId: string,
  parentPath: string
): NormalizedTransition {
  const value = typeof definition === 'string' ? { target: definition } : definition;
  let target = value.target;
  if (target.startsWith('#')) target = target.slice(1);
  else if (target.startsWith('.')) target = `${stateId}${target}`;
  else if (!target.startsWith(`${machineId}.`)) target = `${machineId}.${parentPath ? `${parentPath}.` : ''}${target}`;
  return {
    ...value,
    id: `${stateId}--${event}--${index}`,
    machineId,
    source: stateId,
    event,
    target
  };
}

function normalizeMachine(id: string, machine: MachineDefinition, sourceFile: string): NormalizedMachine {
  const states: Record<string, NormalizedState> = {};

  function visit(key: string, state: StateDefinition, parentPath = '', depth = 0): void {
    const statePath = parentPath ? `${parentPath}.${key}` : key;
    const stateId = `${id}.${statePath}`;
    const childStates = Object.keys(state.states ?? {}).map((child) => `${stateId}.${child}`);
    const transitions: NormalizedTransition[] = [];
    for (const [event, definitionOrList] of Object.entries(state.on ?? {})) {
      const definitions = Array.isArray(definitionOrList) ? definitionOrList : [definitionOrList];
      definitions.forEach((definition, index) => {
        transitions.push(normalizeTransition(definition, id, sourceFile, event, index, stateId, parentPath));
      });
    }
    states[stateId] = {
      id: stateId,
      machineId: id,
      key,
      path: statePath,
      ...(parentPath ? { parent: `${id}.${parentPath}` } : {}),
      depth,
      ...(state.screen ? { screen: state.screen } : {}),
      ...(state.spec ? { spec: state.spec } : {}),
      ...(state.bind ? { bind: state.bind } : {}),
      tags: state.tags ?? [],
      ...(state.initial ? { initial: state.initial } : {}),
      childStates,
      transitions,
      ...(state.machine ? { machine: state.machine } : {})
    };
    for (const [childKey, child] of Object.entries(state.states ?? {})) visit(childKey, child, statePath, depth + 1);
  }

  for (const [key, state] of Object.entries(machine.states)) visit(key, state);
  const initialState = descendInitial(`${id}.${machine.initial}`, states);
  for (const state of Object.values(states)) {
    for (const transition of state.transitions) {
      if (!states[transition.target]) {
        throw new WirestateError(`Unknown transition target: ${transition.target}`, 'TRANSITION_TARGET', [transition.id]);
      }
    }
    if (state.screen && !state.screen.includes('.')) state.screen = `${id.split('.').slice(0, -1).join('.')}.${state.screen}`;
  }
  return {
    id,
    ...(machine.title ? { title: machine.title } : {}),
    ...(machine.spec ? { spec: machine.spec } : {}),
    ...(machine.bind ? { bind: machine.bind } : {}),
    initial: machine.initial,
    initialState,
    sourceFile,
    states
  };
}

export function descendInitial(stateId: string, states: Record<string, NormalizedState>): string {
  const initial = states[stateId];
  if (!initial) throw new WirestateError(`Unknown initial state: ${stateId}`, 'INITIAL_STATE');
  let current: NormalizedState = initial;
  const visited = new Set<string>();
  while (current.initial) {
    if (visited.has(current.id)) throw new WirestateError(`Initial state cycle at ${current.id}`, 'INITIAL_CYCLE');
    visited.add(current.id);
    const child: NormalizedState | undefined = states[`${current.id}.${current.initial}`];
    if (!child) throw new WirestateError(`Unknown child initial state: ${current.id}.${current.initial}`, 'INITIAL_STATE');
    current = child;
  }
  return current.id;
}

export function normalizeProject(
  rootDir: string,
  config: WirestateConfig,
  files: LoadedSpecFile[],
  configPath?: string
): NormalizedProject {
  const rawComponents: Record<string, ComponentDefinition> = {};
  const components: Record<string, NormalizedComponent> = {};
  const screens: Record<string, NormalizedScreen> = {};
  const machines: Record<string, NormalizedMachine> = {};
  const comments = [];
  const warnings: string[] = [];

  for (const file of files) {
    const namespace = file.document.namespace;
    for (const [key, component] of Object.entries(file.document.components ?? {})) {
      const id = qualify(namespace, key);
      if (rawComponents[id]) throw new WirestateError(`Duplicate component template: ${id}`, 'DUPLICATE_ID');
      rawComponents[id] = component;
    }
  }
  for (const [id, component] of Object.entries(rawComponents)) components[id] = resolveComponent(component, rawComponents, [id]);

  for (const file of files) {
    const namespace = file.document.namespace;
    for (const [key, screen] of Object.entries(file.document.screens ?? {})) {
      const id = qualify(namespace, key);
      if (screens[id]) throw new WirestateError(`Duplicate screen: ${id}`, 'DUPLICATE_ID');
      const localizedTemplates = { ...rawComponents };
      if (namespace) {
        for (const [templateId, template] of Object.entries(rawComponents)) {
          if (templateId.startsWith(`${namespace}.`)) localizedTemplates[templateId.slice(namespace.length + 1)] = template;
        }
      }
      screens[id] = {
        ...screen,
        id,
        sourceFile: file.path,
        root: resolveComponent(screen.root, localizedTemplates)
      };
    }
    for (const [key, machine] of Object.entries(file.document.machines ?? {})) {
      const id = qualify(namespace, key);
      if (machines[id]) throw new WirestateError(`Duplicate machine: ${id}`, 'DUPLICATE_ID');
      machines[id] = normalizeMachine(id, machine, file.path);
    }
    comments.push(...(file.document.comments ?? []));
  }

  for (const machine of Object.values(machines)) {
    for (const state of Object.values(machine.states)) {
      if (state.screen && !screens[state.screen]) warnings.push(`State ${state.id} references unknown screen ${state.screen}`);
      if (state.machine && !machines[state.machine]) warnings.push(`State ${state.id} references unknown child machine ${state.machine}`);
    }
  }

  return {
    rootDir: path.resolve(rootDir),
    ...(configPath ? { configPath } : {}),
    config,
    files,
    components,
    screens,
    machines,
    comments,
    warnings
  };
}
