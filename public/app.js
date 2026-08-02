const appState = {
  project: null,
  machineId: null,
  stateId: null,
  selection: null,
  graphScale: .9,
  componentValues: {},
  toggleValues: {},
};

const ids = [
  'project-name', 'machine-name', 'project-meta', 'machine-count', 'machine-list', 'state-tree',
  'runtime-state', 'studio-title', 'graph-viewport', 'graph-surface', 'graph-world', 'zoom-label',
  'prototype-canvas', 'screen-title', 'device-title', 'event-buttons', 'selection-title', 'details-panel',
  'comment-count', 'comment-target', 'comment-list', 'comment-form', 'comment-body', 'comment-focus-button',
  'reload-button', 'reset-button', 'center-button', 'zoom-in', 'zoom-out', 'toast'
];
const els = Object.fromEntries(ids.map((id) => [id, document.getElementById(id)]));

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Request failed: ${response.status}`);
  return body;
}

function toast(message) {
  els.toast.textContent = message;
  els.toast.classList.add('visible');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => els.toast.classList.remove('visible'), 1900);
}

async function loadProject({ preserve = true } = {}) {
  const previousMachine = appState.machineId;
  const previousState = appState.stateId;
  const previousSelection = appState.selection;
  appState.project = await api('/api/project');
  const machineIds = Object.keys(appState.project.machines);
  appState.machineId = preserve && appState.project.machines[previousMachine] ? previousMachine : machineIds[0] || null;
  const machine = currentMachine();
  appState.stateId = preserve && machine?.states[previousState] ? previousState : machine?.initialState || null;
  appState.selection = preserve && previousSelection?.type === 'state' && machine?.states[previousSelection.id]
    ? previousSelection
    : { type: 'state', id: appState.stateId };

  const rootName = appState.project.rootDir.split(/[\\/]/).filter(Boolean).at(-1) || 'Project';
  els['project-name'].textContent = rootName;
  els['project-meta'].textContent = `${appState.project.files.length} spec file${appState.project.files.length === 1 ? '' : 's'}`;
  render();
  requestAnimationFrame(() => centerCurrent(false));
}

function currentMachine() {
  return appState.project?.machines?.[appState.machineId] || null;
}

function currentState() {
  return currentMachine()?.states?.[appState.stateId] || null;
}

function selectedState() {
  if (appState.selection?.type !== 'state') return null;
  return currentMachine()?.states?.[appState.selection.id] || null;
}

function render() {
  const machine = currentMachine();
  els['machine-name'].textContent = machine?.title || machine?.id || 'No machine';
  els['studio-title'].textContent = machine?.title || machine?.id || 'State machine';
  els['runtime-state'].textContent = appState.stateId || '—';
  renderMachineList();
  renderStateTree();
  renderGraph();
  renderPrototype();
  renderEvents();
  renderDetails();
  renderComments();
}

function renderMachineList() {
  const machines = Object.values(appState.project?.machines || {});
  els['machine-count'].textContent = String(machines.length);
  els['machine-list'].replaceChildren(...machines.map((machine) => {
    const button = document.createElement('button');
    button.className = `machine-button${machine.id === appState.machineId ? ' active' : ''}`;
    const label = document.createElement('span');
    label.textContent = machine.title || machine.id;
    button.append(label);
    button.title = machine.id;
    button.onclick = () => {
      appState.machineId = machine.id;
      appState.stateId = machine.initialState;
      appState.selection = { type: 'state', id: machine.initialState };
      appState.componentValues = {};
      appState.toggleValues = {};
      render();
      requestAnimationFrame(() => centerCurrent(true));
    };
    return button;
  }));
}

function renderStateTree() {
  const machine = currentMachine();
  els['state-tree'].replaceChildren();
  if (!machine) return;
  const states = Object.values(machine.states);
  const topLevel = states.filter((item) => !item.parent);
  for (const item of topLevel) els['state-tree'].append(renderStateTreeNode(machine, item));
}

function renderStateTreeNode(machine, item) {
  const fragment = document.createDocumentFragment();
  const row = document.createElement('button');
  const isSelected = appState.selection?.type === 'state' && appState.selection.id === item.id;
  row.className = `state-tree-row${item.id === appState.stateId ? ' current' : ''}${isSelected ? ' selected' : ''}`;
  const chevron = span('tree-chevron', item.childStates.length ? '⌄' : '');
  const dot = span('tree-node-dot');
  const label = span('state-tree-label', item.key);
  row.append(chevron, dot, label);
  row.title = item.id;
  row.onclick = () => selectState(item.id);
  row.ondblclick = () => jumpToState(item.id);
  fragment.append(row);
  if (item.childStates.length) {
    const group = div('state-tree-group');
    for (const childId of item.childStates) {
      const child = machine.states[childId];
      if (child) group.append(renderStateTreeNode(machine, child));
    }
    fragment.append(group);
  }
  return fragment;
}

function availableTransitions(machine, item) {
  const output = [];
  let cursor = item;
  while (cursor) {
    output.push(...cursor.transitions);
    cursor = cursor.parent ? machine.states[cursor.parent] : null;
  }
  return output;
}

function descendInitial(machine, itemOrId) {
  let cursor = typeof itemOrId === 'string' ? machine.states[itemOrId] : itemOrId;
  while (cursor?.initial) cursor = machine.states[`${cursor.id}.${cursor.initial}`];
  return cursor?.id;
}

function resolveReached(machine, target) {
  return descendInitial(machine, target) || target;
}

function renderEvents() {
  const machine = currentMachine();
  const item = currentState();
  els['event-buttons'].replaceChildren();
  if (!machine || !item) return;
  const seen = new Set();
  for (const transition of availableTransitions(machine, item)) {
    const key = `${transition.event}|${transition.target}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const button = document.createElement('button');
    button.className = 'event-button';
    button.textContent = transition.event;
    button.title = transition.spec || `${transition.source} → ${transition.target}`;
    button.onclick = () => sendEvent(transition.event, transition.target);
    els['event-buttons'].append(button);
  }
  if (!seen.size) els['event-buttons'].append(span('empty-inline', 'No outgoing events'));
}

async function sendEvent(event, target) {
  try {
    const step = await api('/api/simulate', {
      method: 'POST',
      body: JSON.stringify({ machine: appState.machineId, state: appState.stateId, event, target }),
    });
    applyStep(step);
  } catch (error) {
    toast(error.message);
  }
}

async function interact(component, kind, event) {
  try {
    const step = await api('/api/interact', {
      method: 'POST',
      body: JSON.stringify({ machine: appState.machineId, state: appState.stateId, component, kind, event }),
    });
    applyStep(step, `${kind} ${component}`);
  } catch (error) {
    toast(error.message);
  }
}

function applyStep(step, prefix) {
  appState.stateId = step.to;
  appState.selection = { type: 'state', id: step.to };
  render();
  requestAnimationFrame(() => centerCurrent(false));
  toast(`${prefix ? `${prefix} · ` : ''}${step.event} → ${step.to.split('.').at(-1)}`);
}

function componentTransitions(componentId) {
  const machine = currentMachine();
  const item = currentState();
  if (!machine || !item || !componentId) return [];
  return availableTransitions(machine, item).filter((transition) => transition.interaction?.component === componentId);
}

function componentTransition(componentId, kinds) {
  const accepted = Array.isArray(kinds) ? kinds : [kinds];
  return componentTransitions(componentId).find((transition) => accepted.includes(transition.interaction?.kind));
}

function renderPrototype() {
  const item = currentState();
  const screen = item?.screen ? appState.project.screens[item.screen] : null;
  els['prototype-canvas'].replaceChildren();
  els['screen-title'].textContent = screen ? (screen.title || screen.id) : 'Behavior only';
  els['device-title'].textContent = screen?.title || item?.key || 'Prototype';
  if (!screen) {
    els['prototype-canvas'].append(div('empty-state', item ? 'This runtime state intentionally has no screen. Use the event controls below to continue the behavior simulation.' : 'No runtime state selected.'));
    return;
  }
  els['prototype-canvas'].append(renderComponent(screen.root));
}

function renderComponent(component) {
  const wrapper = document.createElement('div');
  wrapper.className = 'wire-component';
  if (appState.selection?.type === 'component' && appState.selection.id === component.id) wrapper.classList.add('selected-component');
  applyLayout(wrapper, component.layout || {});
  const props = component.props || {};
  const interactions = componentTransitions(component.id);
  if (interactions.length) {
    wrapper.classList.add('interactive');
    wrapper.dataset.event = interactions.map((transition) => transition.event).join(' / ');
  }

  let element;
  switch (component.type) {
    case 'Container':
      element = div('wire-container');
      applyLayout(element, { direction: 'column', padding: 14, gap: 10, ...(component.layout || {}) });
      break;
    case 'Text':
      element = div('wire-text', String(props.text ?? 'Text'));
      if (props.variant === 'title') { element.style.fontSize = '27px'; element.style.fontWeight = '700'; }
      if (props.variant === 'heading') { element.style.fontSize = '18px'; element.style.fontWeight = '700'; }
      break;
    case 'Button': {
      element = document.createElement('button');
      element.className = 'wire-button';
      element.textContent = String(props.label ?? 'Button');
      const transition = componentTransition(component.id, ['click', 'submit']);
      element.onclick = (eventObject) => {
        eventObject.stopPropagation();
        selectComponent(component);
        if (transition) void interact(component.id, transition.interaction.kind, transition.event);
      };
      break;
    }
    case 'TextInput': {
      element = document.createElement('input');
      element.className = 'wire-input';
      element.placeholder = String(props.placeholder ?? 'Input');
      element.value = appState.componentValues[component.id] ?? String(props.value ?? '');
      element.onfocus = () => selectComponent(component);
      element.oninput = () => { appState.componentValues[component.id] = element.value; };
      const transition = componentTransition(component.id, 'fill');
      if (transition) {
        element.onkeydown = (eventObject) => {
          if (eventObject.key === 'Enter') {
            eventObject.preventDefault();
            void interact(component.id, 'fill', transition.event);
          }
        };
        element.title = `Press Enter to send ${transition.event}`;
      }
      break;
    }
    case 'Image':
      element = div('wire-image', String(props.alt ?? 'Image'));
      if (props.src) element.textContent = `${props.alt || 'Image'} · ${props.src}`;
      break;
    case 'List': {
      element = div('wire-list');
      const items = Array.isArray(props.items) ? props.items : ['List item', 'List item', 'List item'];
      for (const listItem of items) element.append(div('wire-list-row', typeof listItem === 'string' ? listItem : JSON.stringify(listItem)));
      const transition = componentTransition(component.id, 'click');
      if (transition) element.onclick = () => void interact(component.id, 'click', transition.event);
      break;
    }
    case 'Toggle': {
      element = document.createElement('button');
      element.className = 'wire-toggle';
      element.type = 'button';
      element.setAttribute('role', 'switch');
      const checked = Boolean(appState.toggleValues[component.id] ?? props.checked);
      element.setAttribute('aria-checked', String(checked));
      const track = div('toggle-track');
      track.append(div('toggle-knob'));
      element.append(track, div('', String(props.label ?? 'Toggle')));
      const transition = componentTransition(component.id, 'toggle');
      element.onclick = (eventObject) => {
        eventObject.stopPropagation();
        appState.toggleValues[component.id] = !checked;
        selectComponent(component);
        if (transition) void interact(component.id, 'toggle', transition.event);
        else renderPrototype();
      };
      break;
    }
    case 'Modal': {
      element = div('wire-modal-backdrop');
      const modal = div('wire-modal');
      for (const child of component.children || []) modal.append(renderComponent(child));
      element.append(modal);
      break;
    }
    default:
      element = div('', `Unknown primitive: ${component.type}`);
  }

  wrapper.append(element);
  if (component.type !== 'Modal') for (const child of component.children || []) element.append(renderComponent(child));
  if (component.id) addCommentPin(wrapper, component);
  wrapper.onclick = (eventObject) => {
    if (eventObject.target === wrapper || eventObject.target === element) selectComponent(component);
  };
  return wrapper;
}

function addCommentPin(wrapper, component) {
  const target = `component:${component.id}`;
  const count = appState.project.comments.filter((comment) => comment.target === target).length;
  const pin = document.createElement('button');
  pin.className = `comment-pin${count ? '' : ' empty'}`;
  pin.textContent = count ? String(count) : '+';
  pin.title = `Specification comments for ${component.id}`;
  pin.onclick = (eventObject) => {
    eventObject.stopPropagation();
    selectComponent(component);
    focusComments();
  };
  wrapper.append(pin);
}

function applyLayout(element, layout) {
  if (layout.direction) { element.style.display = 'flex'; element.style.flexDirection = layout.direction; }
  if (layout.gap != null) element.style.gap = `${layout.gap}px`;
  if (layout.padding != null) element.style.padding = `${layout.padding}px`;
  if (layout.width != null) element.style.width = typeof layout.width === 'number' ? `${layout.width}px` : layout.width;
  if (layout.height != null) element.style.height = typeof layout.height === 'number' ? `${layout.height}px` : layout.height;
  if (layout.align) element.style.alignItems = ({ start: 'flex-start', end: 'flex-end' })[layout.align] || layout.align;
  if (layout.justify) element.style.justifyContent = ({ start: 'flex-start', end: 'flex-end', between: 'space-between' })[layout.justify] || layout.justify;
}

function renderGraph() {
  const machine = currentMachine();
  els['graph-world'].replaceChildren();
  if (!machine) return;
  const nodes = Object.values(machine.states).filter((item) => item.childStates.length === 0);
  const nodeIds = new Set(nodes.map((item) => item.id));
  const edges = [];
  for (const source of nodes) {
    for (const transition of availableTransitions(machine, source)) {
      const target = resolveReached(machine, transition.target);
      if (nodeIds.has(target)) edges.push({ source: source.id, target, transition });
    }
  }

  const levels = new Map([[machine.initialState, 0]]);
  const queue = [machine.initialState];
  while (queue.length) {
    const source = queue.shift();
    const level = levels.get(source) ?? 0;
    for (const edge of edges.filter((item) => item.source === source)) {
      if (!levels.has(edge.target)) {
        levels.set(edge.target, level + 1);
        queue.push(edge.target);
      }
    }
  }
  let fallbackLevel = Math.max(0, ...levels.values()) + 1;
  for (const node of nodes) if (!levels.has(node.id)) levels.set(node.id, fallbackLevel++);

  const grouped = new Map();
  for (const node of nodes) {
    const level = levels.get(node.id) ?? 0;
    const list = grouped.get(level) || [];
    list.push(node);
    grouped.set(level, list);
  }
  for (const list of grouped.values()) list.sort((a, b) => a.id.localeCompare(b.id));

  const positions = new Map();
  const nodeWidth = 198;
  const nodeHeight = 94;
  const columnStep = 220;
  const rowStep = 164;
  const widestRank = Math.max(1, ...[...grouped.values()].map((list) => list.length));
  const worldWidth = Math.max(640, 96 + widestRank * nodeWidth + (widestRank - 1) * (columnStep - nodeWidth));
  for (const [level, list] of [...grouped.entries()].sort((a, b) => a[0] - b[0])) {
    const rowWidth = list.length * nodeWidth + Math.max(0, list.length - 1) * (columnStep - nodeWidth);
    const rowStart = Math.max(64, (worldWidth - rowWidth) / 2);
    list.forEach((node, index) => positions.set(node.id, { x: rowStart + index * columnStep, y: 78 + level * rowStep }));
  }
  const maxY = Math.max(0, ...[...positions.values()].map((position) => position.y)) + nodeHeight + 92;
  const worldHeight = Math.max(maxY, 520);
  els['graph-world'].style.width = `${worldWidth}px`;
  els['graph-world'].style.height = `${worldHeight}px`;
  els['graph-world'].style.transform = `scale(${appState.graphScale})`;
  els['graph-surface'].style.width = `${worldWidth * appState.graphScale}px`;
  els['graph-surface'].style.height = `${worldHeight * appState.graphScale}px`;
  els['zoom-label'].textContent = `${Math.round(appState.graphScale * 100)}%`;

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.classList.add('graph-svg');
  svg.setAttribute('width', String(worldWidth));
  svg.setAttribute('height', String(worldHeight));
  const defs = document.createElementNS(svg.namespaceURI, 'defs');
  const marker = document.createElementNS(svg.namespaceURI, 'marker');
  marker.setAttribute('id', 'arrow');
  marker.setAttribute('viewBox', '0 0 10 10');
  marker.setAttribute('refX', '9');
  marker.setAttribute('refY', '5');
  marker.setAttribute('markerWidth', '6');
  marker.setAttribute('markerHeight', '6');
  marker.setAttribute('orient', 'auto-start-reverse');
  const markerPath = document.createElementNS(svg.namespaceURI, 'path');
  markerPath.setAttribute('d', 'M 0 0 L 10 5 L 0 10 z');
  markerPath.setAttribute('fill', '#5a6173');
  marker.append(markerPath);
  defs.append(marker);
  svg.append(defs);

  const initialPosition = positions.get(machine.initialState);
  if (initialPosition) {
    const start = div('start-node');
    start.style.left = `${initialPosition.x + nodeWidth / 2 - 9}px`;
    start.style.top = `${initialPosition.y - 52}px`;
    els['graph-world'].append(start);
    drawEdge(svg, { x: initialPosition.x + nodeWidth / 2, y: initialPosition.y - 28 }, { x: initialPosition.x + nodeWidth / 2, y: initialPosition.y }, '', true);
  }

  const pairCounts = new Map();
  for (const edge of edges) {
    const sourcePosition = positions.get(edge.source);
    const targetPosition = positions.get(edge.target);
    if (!sourcePosition || !targetPosition) continue;
    const pair = `${edge.source}|${edge.target}`;
    const offset = pairCounts.get(pair) || 0;
    pairCounts.set(pair, offset + 1);
    const active = edge.source === appState.stateId;
    drawTransitionEdge(svg, sourcePosition, targetPosition, nodeWidth, nodeHeight, edge.transition.event, active, offset);
  }
  els['graph-world'].append(svg);

  for (const node of nodes) {
    const position = positions.get(node.id);
    const card = document.createElement('button');
    const isSelected = appState.selection?.type === 'state' && appState.selection.id === node.id;
    card.className = `graph-node${node.id === appState.stateId ? ' current' : ''}${isSelected ? ' selected' : ''}`;
    card.dataset.stateId = node.id;
    card.style.left = `${position.x}px`;
    card.style.top = `${position.y}px`;
    const header = div('graph-node-header');
    header.append(span('graph-node-name', node.key), span('graph-node-kind', node.screen ? 'screen' : 'behavior'));
    const body = div('graph-node-body');
    body.append(div('graph-node-path', node.path));
    body.append(div('graph-node-spec', node.spec || 'No state specification.'));
    const meta = div('graph-node-meta');
    if (node.screen) meta.append(span('mini-pill', node.screen.split('.').at(-1)));
    const commentCount = appState.project.comments.filter((comment) => comment.target === `state:${node.id}`).length;
    if (commentCount) meta.append(span('mini-pill', `${commentCount} comment${commentCount === 1 ? '' : 's'}`));
    if (node.tags?.length) meta.append(span('mini-pill', node.tags[0]));
    body.append(meta);
    card.append(header, body);
    card.onclick = () => selectState(node.id);
    card.ondblclick = () => jumpToState(node.id);
    els['graph-world'].append(card);
  }
}

function drawTransitionEdge(svg, source, target, nodeWidth, nodeHeight, label, active, index) {
  const same = source.x === target.x && source.y === target.y;
  const sourcePoint = { x: source.x + nodeWidth / 2 + index * 8, y: source.y + nodeHeight };
  const targetPoint = { x: target.x + nodeWidth / 2 + index * 8, y: target.y };
  let pathData;
  let labelPoint;
  if (same) {
    const right = source.x + nodeWidth + 42 + index * 18;
    pathData = `M ${source.x + nodeWidth * .72} ${source.y + nodeHeight} C ${right} ${source.y + nodeHeight}, ${right} ${source.y - 18}, ${source.x + nodeWidth * .72} ${source.y}`;
    labelPoint = { x: right + 4, y: source.y + nodeHeight / 2 };
  } else if (target.y > source.y) {
    const midY = (sourcePoint.y + targetPoint.y) / 2;
    pathData = `M ${sourcePoint.x} ${sourcePoint.y} C ${sourcePoint.x} ${midY}, ${targetPoint.x} ${midY}, ${targetPoint.x} ${targetPoint.y}`;
    labelPoint = { x: (sourcePoint.x + targetPoint.x) / 2, y: midY - 8 + index * 13 };
  } else if (target.y === source.y) {
    const direction = target.x > source.x ? 1 : -1;
    const sourceX = source.x + (direction > 0 ? nodeWidth : 0);
    const targetX = target.x + (direction > 0 ? 0 : nodeWidth);
    const bendY = source.y + nodeHeight + 32 + index * 16;
    pathData = `M ${sourceX} ${source.y + nodeHeight / 2} C ${sourceX + 30 * direction} ${source.y + nodeHeight / 2}, ${sourceX + 30 * direction} ${bendY}, ${(sourceX + targetX) / 2} ${bendY} S ${targetX - 30 * direction} ${target.y + nodeHeight / 2}, ${targetX} ${target.y + nodeHeight / 2}`;
    labelPoint = { x: (sourceX + targetX) / 2, y: bendY - 8 };
  } else {
    const useLeftLane = source.x < target.x;
    const bendX = useLeftLane
      ? Math.min(source.x, target.x) - 36 - index * 16
      : Math.max(source.x, target.x) + nodeWidth + 36 + index * 16;
    const sourceX = useLeftLane ? source.x : source.x + nodeWidth;
    const targetX = useLeftLane ? target.x : target.x + nodeWidth;
    pathData = `M ${sourceX} ${source.y + nodeHeight / 2} C ${bendX} ${source.y + nodeHeight / 2}, ${bendX} ${target.y + nodeHeight / 2}, ${targetX} ${target.y + nodeHeight / 2}`;
    labelPoint = { x: bendX, y: (source.y + target.y + nodeHeight) / 2 - 8 + index * 14 };
  }
  drawPathAndLabel(svg, pathData, labelPoint, label, active);
}

function drawEdge(svg, source, target, label, active) {
  const pathData = `M ${source.x} ${source.y} L ${target.x} ${target.y}`;
  drawPathAndLabel(svg, pathData, { x: (source.x + target.x) / 2, y: source.y - 8 }, label, active);
}

function drawPathAndLabel(svg, pathData, point, label, active) {
  const path = document.createElementNS(svg.namespaceURI, 'path');
  path.setAttribute('d', pathData);
  path.setAttribute('marker-end', 'url(#arrow)');
  path.classList.add('graph-edge');
  if (active) path.classList.add('active');
  svg.append(path);
  if (!label) return;
  const width = Math.max(48, Math.min(118, label.length * 6 + 18));
  const group = document.createElementNS(svg.namespaceURI, 'g');
  group.classList.add('graph-edge-label');
  if (active) group.classList.add('active');
  const rect = document.createElementNS(svg.namespaceURI, 'rect');
  rect.setAttribute('x', String(point.x - width / 2));
  rect.setAttribute('y', String(point.y - 9));
  rect.setAttribute('width', String(width));
  rect.setAttribute('height', '18');
  const text = document.createElementNS(svg.namespaceURI, 'text');
  text.setAttribute('x', String(point.x));
  text.setAttribute('y', String(point.y + .5));
  text.textContent = label;
  group.append(rect, text);
  svg.append(group);
}

function selectState(id) {
  appState.selection = { type: 'state', id };
  renderStateTree();
  renderGraph();
  renderDetails();
  renderComments();
}

async function jumpToState(id) {
  const machine = currentMachine();
  if (!machine?.states[id]) return;
  try {
    const result = await api('/api/jump', {
      method: 'POST',
      body: JSON.stringify({ machine: appState.machineId, state: id }),
    });
    appState.stateId = result.state;
    appState.selection = { type: 'state', id: result.state };
    render();
    requestAnimationFrame(() => centerCurrent(false));
    toast(`Jumped to ${result.state.split('.').at(-1)}`);
  } catch (error) {
    toast(error.message);
  }
}

function selectComponent(component) {
  if (!component.id) return;
  appState.selection = { type: 'component', id: component.id, component };
  renderPrototype();
  renderDetails();
  renderComments();
}

function renderDetails() {
  const machine = currentMachine();
  els['details-panel'].replaceChildren();
  if (!machine || !appState.selection) {
    els['selection-title'].textContent = 'Details';
    els['details-panel'].append(div('empty-state', 'Select a state or component.'));
    return;
  }
  if (appState.selection.type === 'component') {
    const component = appState.selection.component;
    els['selection-title'].textContent = component.id || component.type;
    els['details-panel'].append(span('detail-type', 'Wireframe component'));
    els['details-panel'].append(div('detail-title', component.id || component.type));
    els['details-panel'].append(div('detail-id', component.bind || `component:${component.id}`));
    const specs = Array.isArray(component.specs) ? component.specs.join('\n\n') : '';
    els['details-panel'].append(div('detail-spec', specs || 'No component-level specification.'));
    const grid = document.createElement('dl');
    grid.className = 'detail-grid';
    appendDetail(grid, 'Primitive', component.type);
    appendDetail(grid, 'Screen', currentState()?.screen || '—');
    appendDetail(grid, 'State', appState.stateId);
    els['details-panel'].append(grid);
    renderTransitionList(componentTransitions(component.id));
    return;
  }

  const item = selectedState();
  if (!item) return;
  els['selection-title'].textContent = item.key;
  els['details-panel'].append(span('detail-type', item.id === appState.stateId ? 'Current state' : 'State'));
  els['details-panel'].append(div('detail-title', item.key));
  els['details-panel'].append(div('detail-id', item.id));
  els['details-panel'].append(div('detail-spec', item.spec || 'No state specification.'));
  const grid = document.createElement('dl');
  grid.className = 'detail-grid';
  appendDetail(grid, 'Screen', item.screen || 'Behavior only');
  appendDetail(grid, 'Parent', item.parent || 'Machine root');
  appendDetail(grid, 'Depth', String(item.depth));
  appendDetail(grid, 'Binding', item.bind || '—');
  els['details-panel'].append(grid);
  if (item.tags?.length) {
    const tags = div('detail-tags');
    for (const tag of item.tags) tags.append(span('tag', tag));
    els['details-panel'].append(tags);
  }
  if (item.id !== appState.stateId || item.childStates.length) {
    const jump = document.createElement('button');
    jump.className = 'jump-button';
    jump.textContent = item.childStates.length ? 'Jump to initial child state' : 'Jump runtime to this state';
    jump.onclick = () => jumpToState(item.id);
    els['details-panel'].append(jump);
  }
  renderTransitionList(availableTransitions(machine, item));
}

function renderTransitionList(transitions) {
  const list = div('transition-list');
  list.append(div('transition-list-title', 'Accepted transitions'));
  if (!transitions.length) list.append(div('empty-state', 'No outgoing transitions.'));
  for (const transition of transitions) {
    const button = document.createElement('button');
    button.className = 'transition-card';
    button.append(span('transition-event', transition.event), span('transition-arrow', '→'), span('transition-target', transition.target.split('.').at(-1)));
    button.title = transition.spec || `${transition.source} → ${transition.target}`;
    button.onclick = () => {
      selectState(resolveReached(currentMachine(), transition.target));
      if (transition.source === appState.stateId || currentState()?.parent === transition.source) void sendEvent(transition.event, transition.target);
    };
    list.append(button);
  }
  els['details-panel'].append(list);
}

function appendDetail(grid, term, value) {
  const dt = document.createElement('dt');
  dt.textContent = term;
  const dd = document.createElement('dd');
  dd.textContent = value;
  grid.append(dt, dd);
}

function commentTarget() {
  if (appState.selection?.type === 'component') return `component:${appState.selection.id}`;
  if (appState.selection?.type === 'state') return `state:${appState.selection.id}`;
  return null;
}

function renderComments() {
  const target = commentTarget();
  els['comment-target'].textContent = target || 'Select a state or component.';
  els['comment-body'].disabled = !target;
  els['comment-form'].querySelector('button').disabled = !target;
  els['comment-list'].replaceChildren();
  const comments = target ? appState.project.comments.filter((comment) => comment.target === target) : [];
  els['comment-count'].textContent = String(comments.length);
  if (!target) return;
  if (!comments.length) els['comment-list'].append(div('empty-state', 'No comments yet. Add intent, constraints, or acceptance criteria here.'));
  for (const comment of comments) {
    const card = div(`comment-card${comment.status === 'resolved' ? ' resolved' : ''}`);
    card.append(div('comment-body', comment.body));
    const meta = div('comment-meta');
    meta.append(div('', `${comment.author || 'anonymous'} · ${comment.status || 'open'}`));
    const actions = div('comment-actions');
    const resolve = document.createElement('button');
    resolve.textContent = comment.status === 'resolved' ? 'reopen' : 'resolve';
    resolve.onclick = () => updateCommentStatus(comment, comment.status === 'resolved' ? 'open' : 'resolved');
    const remove = document.createElement('button');
    remove.textContent = 'delete';
    remove.onclick = () => deleteComment(comment.id);
    actions.append(resolve, remove);
    meta.append(actions);
    card.append(meta);
    els['comment-list'].append(card);
  }
}

async function updateCommentStatus(comment, status) {
  try {
    await api('/api/comments', { method: 'POST', body: JSON.stringify({ action: 'update', id: comment.id, status }) });
    await loadProject();
  } catch (error) { toast(error.message); }
}

async function deleteComment(id) {
  try {
    await api('/api/comments', { method: 'POST', body: JSON.stringify({ action: 'remove', id }) });
    await loadProject();
  } catch (error) { toast(error.message); }
}

els['comment-form'].addEventListener('submit', async (event) => {
  event.preventDefault();
  const body = els['comment-body'].value.trim();
  const target = commentTarget();
  if (!body || !target) return;
  try {
    await api('/api/comments', { method: 'POST', body: JSON.stringify({ action: 'add', target, body }) });
    els['comment-body'].value = '';
    await loadProject();
    toast('Comment saved to the specification');
  } catch (error) { toast(error.message); }
});

function focusComments() {
  document.getElementById('comments-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
  if (!els['comment-body'].disabled) els['comment-body'].focus({ preventScroll: true });
}

function centerCurrent(smooth = true) {
  const current = els['graph-world'].querySelector(`[data-state-id="${cssEscape(appState.stateId)}"]`);
  current?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'center', inline: 'center' });
}

function setZoom(next) {
  appState.graphScale = Math.max(.65, Math.min(1.35, Math.round(next * 10) / 10));
  renderGraph();
}

els['reload-button'].onclick = () => loadProject();
els['reset-button'].onclick = () => {
  const machine = currentMachine();
  if (!machine) return;
  appState.stateId = machine.initialState;
  appState.selection = { type: 'state', id: machine.initialState };
  appState.componentValues = {};
  appState.toggleValues = {};
  render();
  requestAnimationFrame(() => centerCurrent(false));
  toast('Simulation reset');
};
els['center-button'].onclick = () => centerCurrent(true);
els['zoom-in'].onclick = () => setZoom(appState.graphScale + .1);
els['zoom-out'].onclick = () => setZoom(appState.graphScale - .1);
els['comment-focus-button'].onclick = focusComments;

const events = new EventSource('/api/events');
events.addEventListener('reload', () => loadProject().then(() => toast('Specification reloaded')));

function div(className, text) {
  const element = document.createElement('div');
  if (className) element.className = className;
  if (text != null) element.textContent = text;
  return element;
}

function span(className, text) {
  const element = document.createElement('span');
  if (className) element.className = className;
  if (text != null) element.textContent = text;
  return element;
}

function cssEscape(value) {
  if (globalThis.CSS?.escape) return CSS.escape(value || '');
  return String(value || '').replace(/["\\]/g, '\\$&');
}

loadProject({ preserve: false }).then(() => {
  requestAnimationFrame(() => centerCurrent(false));
}).catch((error) => {
  els['project-meta'].textContent = error.message;
  toast(error.message);
});
