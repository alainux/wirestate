import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { TraceEvent } from './types.js';

export interface WirestateRecorderOptions {
  outputDir?: string;
  testName?: string;
}

export class WirestateRecorder {
  private readonly events: TraceEvent[] = [];
  private readonly outputDir: string;
  private readonly testName?: string;

  constructor(options: WirestateRecorderOptions = {}) {
    this.outputDir = options.outputDir ?? '.wirestate/traces';
    this.testName = options.testName;
  }

  state(machine: string, state: string): void {
    this.events.push(this.withMetadata({ type: 'state', machine, state }));
  }

  transition(machine: string, from: string, event: string, to: string): void {
    this.events.push(this.withMetadata({ type: 'transition', machine, from, event, to }));
  }

  component(id: string, action?: string): void {
    this.events.push(this.withMetadata({ type: 'component', id, ...(action ? { action } : {}) }));
  }

  snapshot(): TraceEvent[] {
    return [...this.events];
  }

  async flush(fileName?: string): Promise<string> {
    await fs.mkdir(this.outputDir, { recursive: true });
    const safeName = (fileName ?? this.testName ?? `trace-${Date.now()}`).replace(/[^A-Za-z0-9_.-]+/g, '-');
    const output = path.join(this.outputDir, safeName.endsWith('.ndjson') ? safeName : `${safeName}.ndjson`);
    await fs.writeFile(output, this.events.map((event) => JSON.stringify(event)).join('\n') + '\n', 'utf8');
    return output;
  }

  private withMetadata<T extends TraceEvent>(event: T): T {
    return {
      ...event,
      timestamp: new Date().toISOString(),
      ...(this.testName ? { test: this.testName } : {})
    };
  }
}

export async function collectBrowserTrace(page: {
  evaluate<T>(fn: () => T): Promise<T>;
}, recorder: WirestateRecorder): Promise<void> {
  const events = await page.evaluate(() => {
    const scope = globalThis as typeof globalThis & { __WIRESTATE_TRACE__?: TraceEvent[] };
    return scope.__WIRESTATE_TRACE__ ?? [];
  });
  for (const event of events) {
    if (event.type === 'state') recorder.state(event.machine, event.state);
    else if (event.type === 'transition') recorder.transition(event.machine, event.from, event.event, event.to);
    else recorder.component(event.id, event.action);
  }
}
