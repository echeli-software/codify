// Public surface of @codify/gamification-engine. See docs/03-shared-libraries
// `libs/gamification-engine/` and docs/07-gamification §11.

export * from './lib/types.js';

// Services
export {
  RewardOrchestrator,
  REWARD_COLLAPSE_WINDOW_MS,
  COUNTER_TWEEN_MS,
  REDUCED_TWEEN_MS,
  collapse,
  multiplierParts,
} from './lib/reward-orchestrator.service.js';
export { XpService } from './lib/state/xp.service.js';
export { CoinService } from './lib/state/coin.service.js';
export { StreakService } from './lib/state/streak.service.js';
export { QuestService, type QuestState } from './lib/state/quest.service.js';
export {
  LeagueService,
  zoneForRank,
  type LeagueState,
  type LeagueMemberState,
  type LeagueZone,
} from './lib/state/league.service.js';
export {
  MotionAndSoundService,
  type MotionSoundPref,
} from './lib/motion-and-sound.service.js';
export {
  SoundService,
  SOUND_CUES,
  CUE_FOR_KIND,
  cueDuration,
  type SoundCue,
  type SoundNote,
} from './lib/sound.service.js';
export {
  HapticsService,
  HAPTICS_ADAPTER,
  type HapticsAdapter,
} from './lib/haptics.service.js';
export {
  OverlayHostService,
  type OverlayState,
  type OverlayKind,
  type LevelUpOverlay,
  type BadgeUnlockOverlay,
} from './lib/overlay/overlay-host.service.js';

// Animation primitives
export {
  CoinTarget,
  coinFly,
  currentCoinTarget,
  planCoinFly,
  type CoinFlyOptions,
  type CoinParticle,
} from './lib/animation/coin-fly.directive.js';
export {
  confettiBurst,
  planConfetti,
  type ConfettiOptions,
  type ConfettiParticle,
} from './lib/animation/confetti.js';
