import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const port = Number(process.env.PORT || 4188);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.map': 'application/json' };
const server = http.createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url ?? '/', `http://${request.headers.host}`).pathname;
    const relative = pathname === '/' ? 'src/shell/index.html' : pathname.slice(1);
    const file = path.resolve(root, relative);
    if (!file.startsWith(root) || !(await stat(file)).isFile()) throw new Error('Not found');
    response.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream' });
    response.end(await readFile(file));
  } catch {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); response.end('Not found');
  }
});
server.listen(port, '127.0.0.1', () => console.log(`Habit tracker: http://127.0.0.1:${port}`));
