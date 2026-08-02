import { promises as fs } from 'node:fs';
import type { TraceEvent } from './types.js';
import { WirestateError } from './errors.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function validateTraceEvent(value: unknown, at = 'trace'): TraceEvent {
  if (!isRecord(value) || typeof value.type !== 'string') throw new WirestateError(`Invalid ${at}`, 'TRACE_INVALID', ['type is required']);
  if (value.type === 'state') {
    if (typeof value.machine !== 'string' || typeof value.state !== 'string') {
      throw new WirestateError(`Invalid ${at}`, 'TRACE_INVALID', ['state events require machine and state']);
    }
    return value as unknown as TraceEvent;
  }
  if (value.type === 'transition') {
    if (
      typeof value.machine !== 'string' ||
      typeof value.from !== 'string' ||
      typeof value.event !== 'string' ||
      typeof value.to !== 'string'
    ) {
      throw new WirestateError(`Invalid ${at}`, 'TRACE_INVALID', ['transition events require machine, from, event, and to']);
    }
    return value as unknown as TraceEvent;
  }
  if (value.type === 'component') {
    if (typeof value.id !== 'string') throw new WirestateError(`Invalid ${at}`, 'TRACE_INVALID', ['component events require id']);
    return value as unknown as TraceEvent;
  }
  throw new WirestateError(`Invalid ${at}`, 'TRACE_INVALID', [`unknown event type: ${value.type}`]);
}

export function parseTrace(content: string, source = '<memory>'): TraceEvent[] {
  const trimmed = content.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('[')) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch (error) {
      throw new WirestateError(`Invalid JSON trace: ${source}`, 'TRACE_PARSE', [String(error)]);
    }
    if (!Array.isArray(parsed)) throw new WirestateError(`Trace must be an array: ${source}`, 'TRACE_PARSE');
    return parsed.map((event, index) => validateTraceEvent(event, `${source}[${index}]`));
  }
  return trimmed.split(/\r?\n/).filter(Boolean).map((line, index) => {
    try {
      return validateTraceEvent(JSON.parse(line), `${source}:${index + 1}`);
    } catch (error) {
      if (error instanceof WirestateError) throw error;
      throw new WirestateError(`Invalid NDJSON trace: ${source}:${index + 1}`, 'TRACE_PARSE', [String(error)]);
    }
  });
}

export async function readTraceFiles(files: string[]): Promise<TraceEvent[]> {
  const events: TraceEvent[] = [];
  for (const file of files) events.push(...parseTrace(await fs.readFile(file, 'utf8'), file));
  return events;
}
