export type PrimitiveType =
  | 'Container'
  | 'Text'
  | 'Button'
  | 'TextInput'
  | 'Image'
  | 'List'
  | 'Toggle'
  | 'Modal';

export interface LayoutDefinition {
  direction?: 'row' | 'column';
  gap?: number;
  padding?: number;
  width?: string | number;
  height?: string | number;
  align?: 'start' | 'center' | 'end' | 'stretch';
  justify?: 'start' | 'center' | 'end' | 'between';
}

export interface ComponentDefinition {
  id?: string;
  type?: PrimitiveType;
  use?: string;
  bind?: string;
  specs?: string[];
  props?: Record<string, unknown>;
  layout?: LayoutDefinition;
  children?: ComponentDefinition[];
}

export interface ScreenDefinition {
  title?: string;
  spec?: string;
  root: ComponentDefinition;
}

export interface WaitDefinition {
  timeoutMs?: number;
  afterMs?: number;
  until?: {
    state?: string;
    selector?: string;
    text?: string;
  };
}

export interface InteractionDefinition {
  kind: 'click' | 'fill' | 'toggle' | 'submit' | 'wait' | 'custom';
  component?: string;
  value?: string;
  fixture?: string;
}

export interface TransitionObject {
  target: string;
  spec?: string;
  interaction?: InteractionDefinition;
  wait?: WaitDefinition;
  tags?: string[];
}

export type TransitionDefinition = string | TransitionObject;

export interface StateDefinition {
  screen?: string;
  spec?: string;
  bind?: string;
  tags?: string[];
  initial?: string;
  states?: Record<string, StateDefinition>;
  on?: Record<string, TransitionDefinition | TransitionDefinition[]>;
  machine?: string;
}

export interface MachineDefinition {
  title?: string;
  spec?: string;
  initial: string;
  bind?: string;
  states: Record<string, StateDefinition>;
}

export interface SpecComment {
  id: string;
  target: string;
  body: string;
  author?: string;
  status?: 'open' | 'resolved';
  createdAt?: string;
  updatedAt?: string;
}

export interface WirestateFile {
  wirestate: 1;
  namespace?: string;
  imports?: string[];
  components?: Record<string, ComponentDefinition>;
  screens?: Record<string, ScreenDefinition>;
  machines?: Record<string, MachineDefinition>;
  comments?: SpecComment[];
}

export interface WirestateConfig {
  specs: string[];
  source: string[];
  ignore: string[];
  trace: string[];
  strict: {
    bindings: boolean;
    comments: boolean;
  };
  coverage: {
    states: number;
    transitions: number;
  };
  server: {
    port: number;
    open: boolean;
  };
}

export interface LoadedSpecFile {
  path: string;
  document: WirestateFile;
}

export interface NormalizedComponent extends ComponentDefinition {
  type: PrimitiveType;
  children: NormalizedComponent[];
}

export interface NormalizedScreen extends Omit<ScreenDefinition, 'root'> {
  id: string;
  sourceFile: string;
  root: NormalizedComponent;
}

export interface NormalizedTransition extends TransitionObject {
  id: string;
  machineId: string;
  source: string;
  event: string;
  target: string;
}

export interface NormalizedState {
  id: string;
  machineId: string;
  key: string;
  path: string;
  parent?: string;
  depth: number;
  screen?: string;
  spec?: string;
  bind?: string;
  tags: string[];
  initial?: string;
  childStates: string[];
  transitions: NormalizedTransition[];
  machine?: string;
}

export interface NormalizedMachine {
  id: string;
  title?: string;
  spec?: string;
  bind?: string;
  initial: string;
  initialState: string;
  sourceFile: string;
  states: Record<string, NormalizedState>;
}

export interface NormalizedProject {
  rootDir: string;
  configPath?: string;
  config: WirestateConfig;
  files: LoadedSpecFile[];
  components: Record<string, NormalizedComponent>;
  screens: Record<string, NormalizedScreen>;
  machines: Record<string, NormalizedMachine>;
  comments: SpecComment[];
  warnings: string[];
}

export type TraceEvent =
  | {
      type: 'state';
      machine: string;
      state: string;
      timestamp?: string;
      test?: string;
    }
  | {
      type: 'transition';
      machine: string;
      from: string;
      event: string;
      to: string;
      timestamp?: string;
      test?: string;
    }
  | {
      type: 'component';
      id: string;
      action?: string;
      timestamp?: string;
      test?: string;
    };

export interface CoverageReport {
  states: {
    total: number;
    visited: number;
    percent: number;
    missing: string[];
    unknown: string[];
  };
  transitions: {
    total: number;
    visited: number;
    percent: number;
    missing: string[];
    unknown: string[];
  };
  components: {
    touched: string[];
    unknown: string[];
  };
  valid: boolean;
  errors: string[];
}

export interface SyncReport {
  expected: string[];
  found: string[];
  missingInCode: string[];
  unknownInCode: string[];
  duplicateBindings: string[];
  valid: boolean;
}
