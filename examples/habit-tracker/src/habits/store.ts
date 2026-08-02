import type { Habit } from './model.js';

const STORAGE_KEY = 'wirestate-habit-chunks';

export function loadHabits(): Habit[] {
  const raw = localStorage.getItem(STORAGE_KEY);
  return raw ? JSON.parse(raw) as Habit[] : [];
}

export function saveHabits(habits: Habit[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(habits));
}
