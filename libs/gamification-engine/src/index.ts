// Public surface of @codify/gamification-engine. See docs/03-shared-libraries
// `libs/gamification-engine/` and docs/07-gamification §11.

export * from './lib/types.js';

// Services
export { RewardOrchestrator } from './lib/reward-orchestrator.service.js';
export { XpService } from './lib/state/xp.service.js';
export { CoinService } from './lib/state/coin.service.js';
export { StreakService } from './lib/state/streak.service.js';
export { MotionAndSoundService } from './lib/motion-and-sound.service.js';
export { SoundService } from './lib/sound.service.js';
export { HapticsService } from './lib/haptics.service.js';
export {
  OverlayHostService,
  type OverlayState,
  type OverlayKind,
  type LevelUpOverlay,
  type BadgeUnlockOverlay,
} from './lib/overlay/overlay-host.service.js';

// Animation primitives
export { CoinTarget, coinFly } from './lib/animation/coin-fly.directive.js';
export { confettiBurst, type ConfettiOptions } from './lib/animation/confetti.js';
