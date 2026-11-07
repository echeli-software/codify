#!/usr/bin/env node
/**
 * Gamification drift check (docs/07-gamification.md §12) — on-demand CLI.
 *
 * Verifies, per user, that the coin ledger is internally consistent:
 *   latest CoinTransaction.balanceAfter  ==  SUM(delta)  ==  User.coins
 * and that User.totalXp == SUM(XpEvent.amount).
 * A mismatch means a write bypassed the pipeline or a balanceAfter was
 * computed wrong — alert-worthy. Exits non-zero if any drift is found, so it
 * can gate a cron/CI job.
 *
 * Connects straight to DATABASE_URL (env or .env) with `pg` — no docker exec,
 * no host psql — so it runs the same against local, staging or a restored
 * backup:
 *
 *   node tools/scripts/drift-check.mjs
 *   DATABASE_URL=postgresql://… node tools/scripts/drift-check.mjs
 *
 * In deployed environments the same check runs nightly inside the API (the
 * scheduled drift job added with the platform/observability work — see
 * docs/13-deployment.md §12 "Gamification ledger drift"), which records the
 * result for the dashboard/alert. This script is for operators and restore
 * drills (docs/13 §11).
 */
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');

function loadDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const envFile = join(root, '.env');
  if (existsSync(envFile)) {
    const match = readFileSync(envFile, 'utf8').match(
      /^\s*DATABASE_URL\s*=\s*"?([^"\n]+)"?/m,
    );
    if (match) return match[1].trim();
  }
  return null;
}

/** `pg` ships with @prisma/adapter-pg; resolve it from there (no extra dependency). */
function loadPg() {
  const require = createRequire(join(root, 'package.json'));
  try {
    return require('pg');
  } catch {
    const adapterRequire = createRequire(require.resolve('@prisma/adapter-pg'));
    return adapterRequire('pg');
  }
}

const url = loadDatabaseUrl();
if (!url) {
  console.error('DATABASE_URL is not set (env or .env).');
  process.exit(2);
}

const { Client } = loadPg();
// Prisma-style `?schema=` isn't a libpq parameter; strip it for pg.
const connectionString = url
  .replace(/([?&])schema=[^&]*(&|$)/, (_, p, n) => (n ? p : ''))
  .replace(/[?&]$/, '');
const client = new Client({ connectionString });

console.log('Gamification drift check\n');
await client.connect();

try {
  // Per-user: latest balanceAfter (by createdAt), SUM(delta), and User.coins.
  const { rows } = await client.query(`
    WITH latest AS (
      SELECT DISTINCT ON ("userId") "userId", "balanceAfter"
      FROM "CoinTransaction"
      ORDER BY "userId", "createdAt" DESC, id DESC
    ),
    sums AS (
      SELECT "userId", COALESCE(SUM(delta), 0)::bigint AS sum_delta
      FROM "CoinTransaction" GROUP BY "userId"
    )
    SELECT u.id, u.coins::bigint AS coins,
           COALESCE(l."balanceAfter", 0)::bigint AS balance_after,
           COALESCE(s.sum_delta, 0)::bigint AS sum_delta
    FROM "User" u
    JOIN latest l ON l."userId" = u.id
    LEFT JOIN sums s ON s."userId" = u.id
  `);

  let drift = 0;
  for (const r of rows) {
    const ba = Number(r.balance_after);
    const sd = Number(r.sum_delta);
    const uc = Number(r.coins);
    if (ba !== sd || ba !== uc) {
      drift += 1;
      console.error(
        `  DRIFT user=${r.id}: balanceAfter=${ba} sum(delta)=${sd} User.coins=${uc}`,
      );
    }
  }

  // XP cross-check: User.totalXp == SUM(XpEvent.amount).
  const xp = await client.query(`
    SELECT u.id, u."totalXp"::bigint AS total_xp, x.sum_xp::bigint AS sum_xp
    FROM "User" u
    JOIN (SELECT "userId", SUM(amount) AS sum_xp FROM "XpEvent" GROUP BY "userId") x ON x."userId" = u.id
    WHERE u."totalXp" <> x.sum_xp
  `);
  for (const r of xp.rows) {
    console.error(
      `  XP DRIFT user=${r.id}: User.totalXp=${r.total_xp} sum(XpEvent)=${r.sum_xp}`,
    );
  }
  const xpDrift = xp.rowCount ?? xp.rows.length;

  console.log(`\nChecked ${rows.length} user(s) with ledger rows.`);
  console.log(`Coin drift: ${drift} · XP drift: ${xpDrift}`);
  const ok = drift === 0 && xpDrift === 0;
  console.log(ok ? '✅ No drift' : '❌ DRIFT DETECTED');
  process.exitCode = ok ? 0 : 1;
} finally {
  await client.end();
}
