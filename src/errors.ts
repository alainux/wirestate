export class WirestateError extends Error {
  readonly code: string;
  readonly details: string[];

  constructor(message: string, code = 'WIRESTATE_ERROR', details: string[] = []) {
    super(message);
    this.name = 'WirestateError';
    this.code = code;
    this.details = details;
  }
}

export function formatError(error: unknown): string {
  if (error instanceof WirestateError) {
    const details = error.details.length ? `\n${error.details.map((item) => `  - ${item}`).join('\n')}` : '';
    return `${error.message}${details}`;
  }
  if (error instanceof Error) return error.stack ?? error.message;
  return String(error);
}
