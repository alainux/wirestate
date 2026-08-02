import type {
  ComponentDefinition,
  MachineDefinition,
  ScreenDefinition,
  StateDefinition,
  WirestateFile
} from './types.js';
import { WirestateError } from './errors.js';

const PRIMITIVES = new Set(['Container', 'Text', 'Button', 'TextInput', 'Image', 'List', 'Toggle', 'Modal']);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateComponent(value: unknown, at: string, errors: string[]): void {
  if (!isObject(value)) {
    errors.push(`${at} must be an object`);
    return;
  }
  const component = value as unknown as ComponentDefinition;
  if (!component.type && !component.use) errors.push(`${at} must define type or use`);
  if (component.type && !PRIMITIVES.has(component.type)) errors.push(`${at}.type is not a supported primitive`);
  if (component.type && component.use) errors.push(`${at} cannot define both type and use`);
  if (component.children) {
    if (!Array.isArray(component.children)) errors.push(`${at}.children must be an array`);
    else component.children.forEach((child, index) => validateComponent(child, `${at}.children[${index}]`, errors));
  }
}

function validateScreen(value: unknown, at: string, errors: string[]): void {
  if (!isObject(value)) {
    errors.push(`${at} must be an object`);
    return;
  }
  const screen = value as unknown as ScreenDefinition;
  if (!screen.root) errors.push(`${at}.root is required`);
  else validateComponent(screen.root, `${at}.root`, errors);
}

function validateState(value: unknown, at: string, errors: string[]): void {
  if (!isObject(value)) {
    errors.push(`${at} must be an object`);
    return;
  }
  const state = value as unknown as StateDefinition;
  if (state.states) {
    if (!isObject(state.states)) errors.push(`${at}.states must be an object`);
    else {
      if (!state.initial) errors.push(`${at}.initial is required when nested states exist`);
      if (state.initial && !Object.hasOwn(state.states, state.initial)) errors.push(`${at}.initial references an unknown child state`);
      Object.entries(state.states).forEach(([key, child]) => validateState(child, `${at}.states.${key}`, errors));
    }
  }
  if (state.on) {
    if (!isObject(state.on)) errors.push(`${at}.on must be an object`);
    else {
      for (const [event, transitionOrList] of Object.entries(state.on)) {
        const transitions = Array.isArray(transitionOrList) ? transitionOrList : [transitionOrList];
        if (transitions.length === 0) errors.push(`${at}.on.${event} cannot be empty`);
        transitions.forEach((transition, index) => {
          if (typeof transition === 'string') return;
          if (!isObject(transition) || typeof transition.target !== 'string') {
            errors.push(`${at}.on.${event}[${index}] must be a target string or transition object`);
          }
        });
      }
    }
  }
}

function validateMachine(value: unknown, at: string, errors: string[]): void {
  if (!isObject(value)) {
    errors.push(`${at} must be an object`);
    return;
  }
  const machine = value as unknown as MachineDefinition;
  if (!machine.initial || typeof machine.initial !== 'string') errors.push(`${at}.initial is required`);
  if (!isObject(machine.states) || Object.keys(machine.states).length === 0) errors.push(`${at}.states must not be empty`);
  else {
    if (machine.initial && !Object.hasOwn(machine.states, machine.initial)) errors.push(`${at}.initial references an unknown state`);
    Object.entries(machine.states).forEach(([key, state]) => validateState(state, `${at}.states.${key}`, errors));
  }
}

export function validateWirestateFile(value: unknown, file = '<memory>'): asserts value is WirestateFile {
  const errors: string[] = [];
  if (!isObject(value)) throw new WirestateError(`Invalid Wirestate file: ${file}`, 'SPEC_INVALID', ['document must be an object']);
  if (value.wirestate !== 1) errors.push('wirestate must equal 1');
  if (value.imports && (!Array.isArray(value.imports) || value.imports.some((item) => typeof item !== 'string'))) {
    errors.push('imports must be an array of paths');
  }
  if (value.components) {
    if (!isObject(value.components)) errors.push('components must be an object');
    else Object.entries(value.components).forEach(([key, component]) => validateComponent(component as ComponentDefinition, `components.${key}`, errors));
  }
  if (value.screens) {
    if (!isObject(value.screens)) errors.push('screens must be an object');
    else Object.entries(value.screens).forEach(([key, screen]) => validateScreen(screen as ScreenDefinition, `screens.${key}`, errors));
  }
  if (value.machines) {
    if (!isObject(value.machines)) errors.push('machines must be an object');
    else Object.entries(value.machines).forEach(([key, machine]) => validateMachine(machine as MachineDefinition, `machines.${key}`, errors));
  }
  if (!value.machines && !value.screens && !value.components && !value.imports && !value.comments) errors.push('file must define machines, screens, components, imports, or comments');
  if (value.comments) {
    if (!Array.isArray(value.comments)) errors.push('comments must be an array');
    else {
      const ids = new Set<string>();
      value.comments.forEach((comment, index) => {
        if (!isObject(comment)) errors.push(`comments[${index}] must be an object`);
        else {
          if (typeof comment.id !== 'string' || !comment.id) errors.push(`comments[${index}].id is required`);
          else if (ids.has(comment.id)) errors.push(`duplicate comment id: ${comment.id}`);
          else ids.add(comment.id);
          if (typeof comment.target !== 'string' || !comment.target) errors.push(`comments[${index}].target is required`);
          if (typeof comment.body !== 'string' || !comment.body) errors.push(`comments[${index}].body is required`);
        }
      });
    }
  }
  if (errors.length) throw new WirestateError(`Invalid Wirestate file: ${file}`, 'SPEC_INVALID', errors);
}
