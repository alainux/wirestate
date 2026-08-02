import type { GoalPeriod, Habit, ProgressEntry } from '../habits/model.js';

function periodStart(period: GoalPeriod, now: Date): Date {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  if (period === 'week') {
    const mondayOffset = (start.getDay() + 6) % 7;
    start.setDate(start.getDate() - mondayOffset);
  }
  return start;
}

export function chunksInCurrentPeriod(entries: ProgressEntry[], period: GoalPeriod, now = new Date()): number {
  const start = periodStart(period, now).getTime();
  return entries.reduce((total, entry) => total + (new Date(entry.at).getTime() >= start ? entry.chunks : 0), 0);
}

export function goalProgress(habit: Habit, now = new Date()): { current: number; target: number; reached: boolean } {
  const current = chunksInCurrentPeriod(habit.entries, habit.period, now);
  return { current, target: habit.targetChunks, reached: current >= habit.targetChunks };
}
