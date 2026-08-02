import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { promises as fs, watch as watchFile, type FSWatcher } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import type { AddressInfo } from 'node:net';
import { loadProject } from './loader.js';
import { addComment, removeComment, updateComment, type CommentInput } from './comments.js';
import { formatError, WirestateError } from './errors.js';
import { jumpMachine, stepComponent, stepMachine } from './simulate.js';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

export interface ServeOptions {
  cwd?: string;
  port?: number;
  host?: string;
  open?: boolean;
  publicDir?: string;
}

export interface WirestateServer {
  url: string;
  close(): Promise<void>;
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(body));
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) return {};
  try {
    const value = JSON.parse(text) as unknown;
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('body must be an object');
    return value as Record<string, unknown>;
  } catch (error) {
    throw new WirestateError('Invalid JSON request', 'HTTP_JSON', [String(error)]);
  }
}

function mime(file: string): string {
  const extension = path.extname(file);
  if (extension === '.html') return 'text/html; charset=utf-8';
  if (extension === '.js') return 'text/javascript; charset=utf-8';
  if (extension === '.css') return 'text/css; charset=utf-8';
  if (extension === '.svg') return 'image/svg+xml';
  return 'application/octet-stream';
}

function defaultPublicDir(): string {
  const distCandidate = path.join(moduleDir, 'public');
  const sourceCandidate = path.resolve(moduleDir, '..', 'public');
  return distCandidate;
}

function openBrowser(url: string): void {
  const platform = process.platform;
  const command = platform === 'darwin' ? 'open' : platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = platform === 'win32' ? ['/c', 'start', '', url] : [url];
  const child = spawn(command, args, { detached: true, stdio: 'ignore' });
  child.unref();
}

export async function startServer(options: ServeOptions = {}): Promise<WirestateServer> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  let project = await loadProject(cwd);
  const clients = new Set<ServerResponse>();
  const watchers: FSWatcher[] = [];
  const publicDir = options.publicDir ?? (await fs.stat(defaultPublicDir()).then(() => defaultPublicDir()).catch(() => path.resolve(moduleDir, '..', 'public')));

  const server = createHttpServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url ?? '/', 'http://wirestate.local');
      if (requestUrl.pathname === '/api/project' && request.method === 'GET') {
        project = await loadProject(cwd);
        sendJson(response, 200, project);
        return;
      }
      if (requestUrl.pathname === '/api/events' && request.method === 'GET') {
        response.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive'
        });
        response.write('event: ready\ndata: {}\n\n');
        clients.add(response);
        request.on('close', () => clients.delete(response));
        return;
      }
      if (requestUrl.pathname === '/api/simulate' && request.method === 'POST') {
        const body = await readJson(request);
        project = await loadProject(cwd);
        if (typeof body.machine !== 'string' || typeof body.state !== 'string' || typeof body.event !== 'string') {
          throw new WirestateError('machine, state, and event are required', 'SIMULATE_INPUT');
        }
        const machine = project.machines[body.machine];
        if (!machine) throw new WirestateError(`Unknown machine: ${body.machine}`, 'MACHINE_UNKNOWN');
        sendJson(response, 200, stepMachine(machine, body.state, body.event, typeof body.target === 'string' ? body.target : undefined));
        return;
      }
      if (requestUrl.pathname === '/api/jump' && request.method === 'POST') {
        const body = await readJson(request);
        project = await loadProject(cwd);
        if (typeof body.machine !== 'string' || typeof body.state !== 'string') {
          throw new WirestateError('machine and state are required', 'JUMP_INPUT');
        }
        const machine = project.machines[body.machine];
        if (!machine) throw new WirestateError(`Unknown machine: ${body.machine}`, 'MACHINE_UNKNOWN');
        sendJson(response, 200, jumpMachine(machine, body.state));
        return;
      }
      if (requestUrl.pathname === '/api/interact' && request.method === 'POST') {
        const body = await readJson(request);
        project = await loadProject(cwd);
        if (typeof body.machine !== 'string' || typeof body.state !== 'string' || typeof body.component !== 'string' || typeof body.kind !== 'string') {
          throw new WirestateError('machine, state, component, and kind are required', 'INTERACT_INPUT');
        }
        const kinds = new Set(['click', 'fill', 'toggle', 'submit', 'wait', 'custom']);
        if (!kinds.has(body.kind)) throw new WirestateError(`Unknown interaction kind: ${body.kind}`, 'INTERACT_INPUT');
        const machine = project.machines[body.machine];
        if (!machine) throw new WirestateError(`Unknown machine: ${body.machine}`, 'MACHINE_UNKNOWN');
        sendJson(response, 200, stepComponent(
          machine,
          body.state,
          body.component,
          body.kind as 'click' | 'fill' | 'toggle' | 'submit' | 'wait' | 'custom',
          typeof body.event === 'string' ? body.event : undefined
        ));
        return;
      }
      if (requestUrl.pathname === '/api/comments' && request.method === 'POST') {
        const body = await readJson(request);
        project = await loadProject(cwd);
        const action = body.action;
        const file = typeof body.file === 'string' ? body.file : undefined;
        if (action === 'add') {
          const comment = await addComment(project, body as CommentInput, file);
          sendJson(response, 201, comment);
        } else if (action === 'update' && typeof body.id === 'string') {
          const comment = await updateComment(project, body.id, body as CommentInput, file);
          sendJson(response, 200, comment);
        } else if (action === 'remove' && typeof body.id === 'string') {
          await removeComment(project, body.id, file);
          sendJson(response, 200, { ok: true });
        } else throw new WirestateError('Unknown comment action', 'COMMENT_ACTION');
        return;
      }
      if (requestUrl.pathname.startsWith('/api/')) {
        sendJson(response, 404, { error: 'Not found' });
        return;
      }

      const relative = requestUrl.pathname === '/' ? 'index.html' : requestUrl.pathname.slice(1);
      const target = path.resolve(publicDir, relative);
      if (!target.startsWith(path.resolve(publicDir))) {
        sendJson(response, 403, { error: 'Forbidden' });
        return;
      }
      try {
        const content = await fs.readFile(target);
        response.writeHead(200, { 'content-type': mime(target), 'cache-control': 'no-store' });
        response.end(content);
      } catch {
        const index = await fs.readFile(path.join(publicDir, 'index.html'));
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        response.end(index);
      }
    } catch (error) {
      sendJson(response, error instanceof WirestateError ? 400 : 500, { error: formatError(error) });
    }
  });

  const watchTargets = project.files.map((file) => file.path);
  if (project.configPath) watchTargets.push(project.configPath);
  for (const target of watchTargets) {
    try {
      watchers.push(watchFile(target, { persistent: false }, () => {
        for (const client of clients) client.write(`event: reload\ndata: ${JSON.stringify({ at: Date.now() })}\n\n`);
      }));
    } catch {
      // A disappearing file will be picked up on the next project reload.
    }
  }

  const port = options.port ?? project.config.server.port;
  const host = options.host ?? '127.0.0.1';
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve());
  });
  const address = server.address() as AddressInfo;
  const url = `http://${host}:${address.port}`;
  if (options.open ?? project.config.server.open) openBrowser(url);

  return {
    url,
    async close() {
      for (const watcher of watchers) watcher.close();
      for (const client of clients) client.end();
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
  };
}
