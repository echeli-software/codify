#!/usr/bin/env node
/**
 * Run @storybook/test-runner (+ axe) against a STATIC Storybook build.
 *
 *   node tools/scripts/test-storybook.mjs <project> <port> [-- extra test-storybook args]
 *
 * 1. Serves dist/storybook/<project> on 127.0.0.1:<port> with a tiny
 *    dependency-free static server (no dev server, no network).
 * 2. Runs `test-storybook -c libs/<project>/.storybook --url …`.
 * 3. Shuts the server down and exits with the runner's exit code.
 *
 * Chromium: uses $PLAYWRIGHT_BROWSERS_PATH (pre-installed browsers); the
 * per-lib `test-runner-jest.config.js` points Playwright at the installed
 * binary so nothing is downloaded.
 */
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const [project, portArg, ...rest] = process.argv.slice(2);
if (!project || !portArg) {
  console.error('usage: test-storybook.mjs <project> <port> [-- args]');
  process.exit(2);
}
const extra = rest[0] === '--' ? rest.slice(1) : rest;
const root = resolve(process.cwd(), 'dist/storybook', project);
const configDir = `libs/${project}/.storybook`;
const port = Number(portArg);

if (!existsSync(join(root, 'index.html'))) {
  console.error(
    `No static Storybook at ${root} — run "nx run ${project}:build-storybook" first.`,
  );
  process.exit(2);
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
};

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  let file = normalize(join(root, decodeURIComponent(url.pathname)));
  if (!file.startsWith(root)) {
    res.writeHead(403).end();
    return;
  }
  if (existsSync(file) && statSync(file).isDirectory())
    file = join(file, 'index.html');
  if (!existsSync(file)) {
    res.writeHead(404).end('not found');
    return;
  }
  res.writeHead(200, {
    'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
    'cache-control': 'no-store',
  });
  createReadStream(file).pipe(res);
});

server.listen(port, '127.0.0.1', () => {
  const bin = resolve(process.cwd(), 'node_modules/.bin/test-storybook');
  const args = [
    '-c',
    configDir,
    '--url',
    `http://127.0.0.1:${port}`,
    '--maxWorkers=2',
    ...extra,
  ];
  console.log(`[test-storybook] ${project}: serving ${root} on :${port}`);
  const child = spawn(bin, args, {
    stdio: 'inherit',
    env: { ...process.env, STORYBOOK_CONFIG_DIR: configDir },
  });
  child.on('exit', (code, signal) => {
    server.close();
    process.exit(code ?? (signal ? 1 : 0));
  });
});
