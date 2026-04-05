import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';

const port = Number(process.argv[2] ?? 4173);
const root = normalize(join(process.cwd(), 'tests', 'fixtures', 'pages'));

const mimeTypes = {
  '.html': 'text/html; charset=utf-8'
};

createServer((request, response) => {
  const route = request.url ?? '/chatgpt-long.html';
  const path = resolveFixturePath(route);
  const filePath = normalize(join(root, path));

  if (!filePath.startsWith(root) || !existsSync(filePath)) {
    response.writeHead(404);
    response.end('Not found');
    return;
  }

  response.writeHead(200, {
    'Content-Type': mimeTypes[extname(filePath)] ?? 'text/plain; charset=utf-8'
  });
  response.end(readFileSync(filePath));
}).listen(port, '127.0.0.1', () => {
  console.log(`Fixture server listening on http://127.0.0.1:${port}`);
});

function resolveFixturePath(route) {
  if (route === '/' || route === '/c/local-session') {
    return '/chatgpt-long.html';
  }

  if (route === '/c/code-session') {
    return '/chatgpt-code-heavy.html';
  }

  if (route === '/c/unknown-session') {
    return '/unknown-layout.html';
  }

  if (route === '/chat') {
    return '/chatgpt-empty.html';
  }

  return route;
}
