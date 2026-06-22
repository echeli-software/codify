#!/usr/bin/env node
/**
 * Nightly gamification drift check (docs/07-gamification.md §12).
 *
 * Verifies, per user, that the coin ledger is internally consistent:
 *   latest CoinTransaction.balanceAfter  ==  SUM(delta)  ==  User.coins
 * A mismatch means a write bypassed the pipeline or a balanceAfter was
 * computed wrong — alert-worthy. Exits non-zero if any drift is found, so
 * it can gate a cron/CI job.
 *
 * Runs over the dockerized Postgres (no host psql needed), matching the
 * probe convention.
 */

import { execSync } from 'node:child_process';

const CONTAINER = process.env.PG_CONTAINER || 'codify-postgres';

function sql(q) {
  return execSync(
    `docker exec ${CONTAINER} psql -U codify -d codify_dev -A -F'|' -t -c "${q.replace(/"/g, '\\"')}"`,
    { encoding: 'utf8' },
  ).trim();
}

console.log('Gamification drift check\n');

// Per-user: latest balanceAfter (by createdAt), SUM(delta), and User.coins.
const rows = sql(`
  WITH latest AS (
    SELECT DISTINCT ON ("userId") "userId", "balanceAfter"
    FROM "CoinTransaction"
    ORDER BY "userId", "createdAt" DESC, id DESC
  ),
  sums AS (
    SELECT "userId", COALESCE(SUM(delta),0) AS sum_delta
    FROM "CoinTransaction" GROUP BY "userId"
  )
  SELECT u.id, u."totalXp", u.coins,
         COALESCE(l."balanceAfter", 0) AS balance_after,
         COALESCE(s.sum_delta, 0) AS sum_delta
  FROM "User" u
  LEFT JOIN latest l ON l."userId" = u.id
  LEFT JOIN sums s ON s."userId" = u.id
  WHERE l."userId" IS NOT NULL
`);

let checked = 0;
let drift = 0;
if (rows) {
  for (const line of rows.split('\n')) {
    const [userId, , coins, balanceAfter, sumDelta] = line.split('|');
    checked += 1;
    const ba = parseInt(balanceAfter, 10);
    const sd = parseInt(sumDelta, 10);
    const uc = parseInt(coins, 10);
    if (ba !== sd || ba !== uc) {
      drift += 1;
      console.error(`  DRIFT user=${userId}: balanceAfter=${ba} sum(delta)=${sd} User.coins=${uc}`);
    }
  }
}

// XP cross-check: User.totalXp == SUM(XpEvent.amount).
const xpRows = sql(`
  SELECT u.id, u."totalXp", COALESCE(x.sum_xp, 0) AS sum_xp
  FROM "User" u
  LEFT JOIN (SELECT "userId", SUM(amount) AS sum_xp FROM "XpEvent" GROUP BY "userId") x ON x."userId" = u.id
  WHERE x."userId" IS NOT NULL
`);
let xpDrift = 0;
if (xpRows) {
  for (const line of xpRows.split('\n')) {
    const [userId, totalXp, sumXp] = line.split('|');
    if (parseInt(totalXp, 10) !== parseInt(sumXp, 10)) {
      xpDrift += 1;
      console.error(`  XP DRIFT user=${userId}: User.totalXp=${totalXp} sum(XpEvent)=${sumXp}`);
    }
  }
}

console.log(`\nChecked ${checked} user(s) with ledger rows.`);
console.log(`Coin drift: ${drift} · XP drift: ${xpDrift}`);
console.log(drift === 0 && xpDrift === 0 ? '✅ No drift' : `❌ DRIFT DETECTED`);
process.exit(drift === 0 && xpDrift === 0 ? 0 : 1);
