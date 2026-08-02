import { addChunks, createHabit, type GoalPeriod, type Habit } from '../habits/model.js';
import { loadHabits, saveHabits } from '../habits/store.js';
import { goalProgress } from '../goals/progress.js';

// wirestate: machine:habits.app
// wirestate: state:habits.app.ready.dashboard
// wirestate: state:habits.app.ready.adding
// wirestate: state:habits.app.ready.detail
// wirestate: state:habits.app.ready.logging
// wirestate: state:habits.app.ready.celebrating
// wirestate: component:habit.summary
// wirestate: component:habit.progress
// wirestate: component:habit.addButton
// wirestate: component:habit.openButton
// wirestate: component:habit.cancelButton
// wirestate: component:habit.backButton
// wirestate: component:habit.logButton
// wirestate: component:habit.archiveButton
// wirestate: component:habit.finishGoalButton
// wirestate: component:habit.cancelLogButton
// wirestate: component:habit.dismissButton

const trace = globalThis.__WIRESTATE_TRACE__ = globalThis.__WIRESTATE_TRACE__ ?? [];
type AppState = 'loading' | 'ready.dashboard' | 'ready.adding' | 'ready.detail' | 'ready.logging' | 'ready.celebrating';
let state: AppState = 'loading';
let habits = loadHabits();
let selectedHabitId: string | undefined = habits.find((habit) => !habit.archived)?.id;

const rootElement = document.querySelector<HTMLElement>('#app');
if (!rootElement) throw new Error('Missing #app root.');
const root: HTMLElement = rootElement;

function record(event: Record<string, unknown>): void {
  trace.push({ ...event, timestamp: new Date().toISOString() });
}

function component(id: string, action: string): void {
  record({ type: 'component', id, action });
}

function transition(next: AppState, event: string): void {
  const previous = state;
  state = next;
  root.dataset.wirestateState = `habits.app.${next}`;
  record({ type: 'transition', machine: 'habits.app', from: previous, event, to: next });
  record({ type: 'state', machine: 'habits.app', state: next });
  render();
}

function button(id: string, label: string, event: string, next: AppState, className = ''): string {
  const bindingAttribute = 'data-' + 'wirestate-id';
  return `<button type="button" class="${className}" ${bindingAttribute}="${id}" data-event="${event}">${label}</button>`;
}

function activeHabits(): Habit[] {
  return habits.filter((habit) => !habit.archived);
}

function renderDashboard(): string {
  const cards = activeHabits().map((habit) => {
    const progress = goalProgress(habit);
    return `<article class="habit-card"><div><strong>${habit.name}</strong><span>${progress.current} of ${progress.target} ${habit.chunkLabel} chunks this ${habit.period}</span></div>${button('habit.openButton', 'Open', 'OPEN_HABIT', 'ready.detail')}</article>`;
  }).join('') || '<p class="empty">No active habits yet.</p>';
  return `<header><div><p class="eyebrow">Current period</p><h1>Habit chunks</h1></div>${button('habit.addButton', 'Add habit', 'OPEN_ADD', 'ready.adding', 'primary')}</header><main>${cards}</main>`;
}

function renderAdding(): string {
  return `<header><h1>Create a goal</h1></header><form id="habit-form" class="panel"><label>Name<input data-wirestate-id="habit.nameInput" name="name" required value="Read"></label><label>Chunk label<input data-wirestate-id="habit.chunkInput" name="chunk" required value="10 minutes"></label><label>Target chunks<input data-wirestate-id="habit.targetInput" name="target" type="number" min="1" required value="5"></label><label class="toggle"><input data-wirestate-id="habit.periodToggle" name="weekly" type="checkbox" checked> Weekly goal</label><div class="actions">${button('habit.cancelButton', 'Cancel', 'CANCEL_ADD', 'ready.dashboard')}<button class="primary" data-wirestate-id="habit.saveButton" type="submit">Save goal</button></div></form>`;
}

function selectedHabit(): Habit | undefined {
  return habits.find((habit) => habit.id === selectedHabitId) ?? activeHabits()[0];
}

function renderDetail(): string {
  const habit = selectedHabit();
  if (!habit) return renderDashboard();
  const progress = goalProgress(habit);
  return `<header>${button('habit.backButton', 'Back', 'BACK', 'ready.dashboard')}<h1>${habit.name}</h1></header><main class="panel"><p class="progress"><strong>${progress.current} / ${progress.target}</strong><span>${habit.chunkLabel} chunks this ${habit.period}</span></p><div class="meter"><i style="width:${Math.min(100, progress.current / progress.target * 100)}%"></i></div><div class="actions">${button('habit.logButton', 'Log progress', 'OPEN_LOG', 'ready.logging', 'primary')}${button('habit.archiveButton', 'Archive', 'ARCHIVE', 'ready.dashboard')}</div></main>`;
}

function renderLogging(): string {
  const habit = selectedHabit();
  return `<header><h1>Log ${habit?.name ?? 'progress'}</h1></header><form id="log-form" class="panel"><label>Chunks<input data-wirestate-id="habit.chunkCountInput" name="chunks" type="number" min="1" value="1" required></label><div class="actions"><button class="primary" data-wirestate-id="habit.saveChunkButton" type="submit">Add chunk</button>${button('habit.finishGoalButton', 'Add final chunk', 'REACH_GOAL', 'ready.celebrating')}${button('habit.cancelLogButton', 'Cancel', 'CANCEL_LOG', 'ready.detail')}</div></form>`;
}

function renderCelebration(): string {
  return `<main class="panel celebration"><p class="eyebrow">Period complete</p><h1>Goal reached</h1><p>Your progress is saved. Keep the habit active for the next period.</p>${button('habit.dismissButton', 'Keep going', 'DISMISS', 'ready.detail', 'primary')}</main>`;
}

function render(): void {
  root.innerHTML = state === 'ready.dashboard' ? renderDashboard()
    : state === 'ready.adding' ? renderAdding()
    : state === 'ready.detail' ? renderDetail()
    : state === 'ready.logging' ? renderLogging()
    : state === 'ready.celebrating' ? renderCelebration()
    : '<main class="panel">Loading saved habits…</main>';
  bindEvents();
}

function bindEvents(): void {
  root.querySelectorAll<HTMLElement>('[data-event]').forEach((element) => {
    element.addEventListener('click', () => {
      const id = element.dataset.wirestateId;
      const event = element.dataset.event;
      if (!id || !event) return;
      component(id, 'click');
      if (event === 'OPEN_HABIT') selectedHabitId = activeHabits()[0]?.id;
      if (event === 'ARCHIVE') {
        habits = habits.map((habit) => habit.id === selectedHabitId ? { ...habit, archived: true } : habit);
        saveHabits(habits);
      }
      if (event === 'REACH_GOAL') {
        const habit = selectedHabit();
        if (habit) {
          const progress = goalProgress(habit);
          habits = habits.map((item) => item.id === habit.id ? addChunks(item, Math.max(1, progress.target - progress.current)) : item);
          saveHabits(habits);
        }
      }
      const next = element instanceof HTMLButtonElement ? element.dataset.next : undefined;
      const map: Record<string, AppState> = {
        OPEN_ADD: 'ready.adding', OPEN_HABIT: 'ready.detail', BACK: 'ready.dashboard', OPEN_LOG: 'ready.logging',
        CANCEL_ADD: 'ready.dashboard', CANCEL_LOG: 'ready.detail', ARCHIVE: 'ready.dashboard', REACH_GOAL: 'ready.celebrating', DISMISS: 'ready.detail'
      };
      transition(next as AppState || map[event]!, event);
    });
  });

  root.querySelector<HTMLFormElement>('#habit-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget as HTMLFormElement);
    component('habit.nameInput', 'fill'); component('habit.chunkInput', 'fill'); component('habit.targetInput', 'fill'); component('habit.periodToggle', 'toggle'); component('habit.saveButton', 'click');
    const habit = createHabit({ name: String(data.get('name')), chunkLabel: String(data.get('chunk')), targetChunks: Number(data.get('target')), period: data.get('weekly') ? 'week' : 'day' as GoalPeriod });
    habits = [...habits, habit]; selectedHabitId = habit.id; saveHabits(habits); transition('ready.dashboard', 'SAVE_HABIT');
  });

  root.querySelector<HTMLFormElement>('#log-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const habit = selectedHabit();
    if (!habit) return;
    const chunks = Number(new FormData(event.currentTarget as HTMLFormElement).get('chunks'));
    component('habit.chunkCountInput', 'fill'); component('habit.saveChunkButton', 'click');
    habits = habits.map((item) => item.id === habit.id ? addChunks(item, chunks) : item); saveHabits(habits); transition('ready.detail', 'SAVE_CHUNK');
  });
}

declare global { var __WIRESTATE_TRACE__: Array<Record<string, unknown>> | undefined; }

record({ type: 'state', machine: 'habits.app', state: 'loading' });
render();
queueMicrotask(() => transition('ready.dashboard', 'LOADED'));
