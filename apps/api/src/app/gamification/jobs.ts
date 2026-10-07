/**
 * Shared switch for this area's scheduled jobs (league rollover, quest
 * pre-assignment, referral rewards, limited-drop announcements).
 *
 * Jobs never run under jest, and can be turned off per process with
 * `JOBS_ENABLED=false` (e.g. on extra API replicas, or locally).
 */
export function jobsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env['JEST_WORKER_ID'] !== undefined || env['NODE_ENV'] === 'test')
    return false;
  return (env['JOBS_ENABLED'] ?? 'true').toLowerCase() !== 'false';
}

/**
 * Cron expressions for this area's jobs (all UTC). Kept in one place so the
 * `@Cron(...)` decorators and the docs agree.
 */
export const ENGAGEMENT_CRONS = {
  /** docs/07 §9: rollover runs Monday 00:05 UTC for the week that just ended. */
  leagueRollover: '5 0 * * 1',
  /** Hourly: pre-assign daily quests for users whose local midnight passed. */
  questPreassign: '0 * * * *',
  /** Hourly: pay referrers whose referees completed a first lesson. */
  referralRewards: '30 * * * *',
  /** Every 15 minutes: announce limited drops that just went live. */
  dropAnnouncements: '*/15 * * * *',
} as const;
