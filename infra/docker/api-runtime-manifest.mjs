#!/usr/bin/env node
/**
 * Writes a minimal, production-only `package.json` + pruned `pnpm-lock.yaml`
 * next to the built API bundle so the runtime image can do
 * `pnpm install --prod --frozen-lockfile` with only what `main.js` needs.
 *
 * Why not `nx run api:prune`? Its `prune-lockfile` executor copies
 * `apps/api/package.json` verbatim, and that manifest only lists a handful of
 * the API's real runtime dependencies (dotenv, class-validator,
 * @prisma/adapter-pg, ... live in the root manifest). Nx's project graph,
 * however, knows every package the API source imports, so we derive the
 * manifest from the graph (same helper NxAppWebpackPlugin uses for
 * `generatePackageJson`) and then cross-check it against the `require()`
 * calls webpack left external in the bundle. A missing dependency fails the
 * build here instead of crashing the container at boot.
 *
 * Usage (after `nx build api`):
 *   node infra/docker/api-runtime-manifest.mjs [distDir=apps/api/dist]
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { builtinModules, createRequire } from 'node:module';
import { join, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const workspaceRoot = resolve(import.meta.dirname, '../..');
const distDir = resolve(workspaceRoot, process.argv[2] ?? 'apps/api/dist');
const bundle = join(distDir, 'main.js');

if (!existsSync(bundle)) {
  console.error(`✗ ${bundle} not found — run \`nx build api\` first.`);
  process.exit(1);
}

process.env.NX_DAEMON ??= 'false';
process.env.NX_IGNORE_UNSUPPORTED_TS_SETUP ??= 'true';
const { createProjectGraphAsync } = require('nx/src/devkit-exports');
const { createPackageJson, createLockFile } = require('@nx/js');

const graph = await createProjectGraphAsync({ exitOnError: true });
const generated = createPackageJson('api', graph, {
  root: workspaceRoot,
  isProduction: true,
  target: 'build',
});

const rootPkg = JSON.parse(
  readFileSync(join(workspaceRoot, 'package.json'), 'utf8'),
);
const rootVersions = { ...rootPkg.devDependencies, ...rootPkg.dependencies };
const dependencies = { ...generated.dependencies };

// `prisma` (CLI) is needed in the image for `prisma migrate deploy` and
// `prisma generate`; keep it even if the graph ever stops reporting it.
dependencies.prisma ??= rootVersions.prisma;

// Cross-check: every bare specifier the bundle still `require()`s at runtime
// must resolve to a declared dependency.
const builtins = new Set(builtinModules);
const externals = new Set();
const source = readFileSync(bundle, 'utf8');
for (const [, spec] of source.matchAll(/require\("([^"./][^"]*)"\)/g)) {
  if (spec.startsWith('node:') || builtins.has(spec)) continue;
  const parts = spec.split('/');
  externals.add(spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]);
}
const missing = [];
for (const name of externals) {
  if (dependencies[name]) continue;
  if (rootVersions[name]) {
    dependencies[name] = rootVersions[name];
  } else {
    missing.push(name);
  }
}
if (missing.length) {
  console.error(
    `✗ The API bundle requires packages that are not declared in the root package.json: ${missing.join(', ')}`,
  );
  process.exit(1);
}

const sorted = Object.fromEntries(
  Object.entries(dependencies).sort(([a], [b]) => a.localeCompare(b)),
);
const manifest = {
  name: '@codify/api-runtime',
  version: rootPkg.version ?? '0.0.0',
  private: true,
  main: 'main.js',
  dependencies: sorted,
  pnpm: rootPkg.pnpm,
};

writeFileSync(
  join(distDir, 'package.json'),
  JSON.stringify(manifest, null, 2) + '\n',
);
writeFileSync(
  join(distDir, 'pnpm-lock.yaml'),
  createLockFile(manifest, graph, 'pnpm'),
);

console.log(
  `✓ ${distDir}/package.json — ${Object.keys(sorted).length} runtime dependencies:`,
);
for (const [name, version] of Object.entries(sorted))
  console.log(`    ${name}@${version}`);
console.log(`✓ ${distDir}/pnpm-lock.yaml (pruned)`);
