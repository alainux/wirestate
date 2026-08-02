export type GoalPeriod = 'day' | 'week';

export interface ProgressEntry {
  at: string;
  chunks: number;
}

export interface Habit {
  id: string;
  name: string;
  chunkLabel: string;
  targetChunks: number;
  period: GoalPeriod;
  archived: boolean;
  entries: ProgressEntry[];
}

export function createHabit(input: Pick<Habit, 'name' | 'chunkLabel' | 'targetChunks' | 'period'>): Habit {
  if (!input.name.trim() || !input.chunkLabel.trim()) throw new Error('Name and chunk label are required.');
  if (!Number.isInteger(input.targetChunks) || input.targetChunks < 1) throw new Error('Target chunks must be a positive integer.');
  return {
    ...input,
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    archived: false,
    entries: []
  };
}

export function addChunks(habit: Habit, chunks: number, at = new Date()): Habit {
  if (!Number.isInteger(chunks) || chunks < 1) throw new Error('Chunks must be a positive integer.');
  return { ...habit, entries: [...habit.entries, { at: at.toISOString(), chunks }] };
}
