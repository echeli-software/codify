import { type ExecutionContext, applyDecorators } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';

/**
 * Rate-limit groups from docs/14 §7. `default` and `ip` apply to every
 * route; the others are opt-in via the decorators below and are keyed per
 * user across all routes in the group (e.g. all reward endpoints share one
 * 10/min bucket).
 */
export type ThrottleGroup = 'reward' | 'ai' | 'code';

export const THROTTLE_GROUPS_KEY = 'codify:throttle-groups';

/** All throttler names registered in ThrottlingModule. */
export const THROTTLER_NAMES = [
  'default',
  'ip',
  'reward',
  'ai-minute',
  'ai-day',
  'code-burst',
  'code-day',
] as const;

/**
 * Add `group` to the handler's (or class's) groups. Groups stack, so one
 * route can sit in several buckets — e.g. exercise submit is both `code`
 * (1/3 s, 200/day) and `reward` (10/min), docs/14 §7.
 */
const tagGroup =
  (group: ThrottleGroup) =>
  (
    target: object,
    _key?: string | symbol,
    descriptor?: PropertyDescriptor,
  ): void => {
    const holder = (descriptor?.value ?? target) as object;
    const existing =
      (Reflect.getMetadata(THROTTLE_GROUPS_KEY, holder) as
        | ThrottleGroup[]
        | undefined) ?? [];
    if (!existing.includes(group))
      Reflect.defineMetadata(THROTTLE_GROUPS_KEY, [...existing, group], holder);
  };

/** Reward-event endpoints (lesson complete, quiz/exercise/scenario pass, purchases): 10/min/user. */
export const RewardThrottle = () => applyDecorators(tagGroup('reward'));

/** AI-prompt grading: 5/min and 60/day per user. */
export const AiThrottle = () => applyDecorators(tagGroup('ai'));

/** Code execution (run/submit): 1 per 3s and 200/day per user. */
export const CodeThrottle = () => applyDecorators(tagGroup('code'));

/** Exercise submit: code limits + the reward-event group (docs/14 §7). */
export const CodeSubmitThrottle = () =>
  applyDecorators(tagGroup('code'), tagGroup('reward'));

/** Exempt a route/controller from every throttler (health probes, provider webhooks). */
export const NoThrottle = () =>
  SkipThrottle(Object.fromEntries(THROTTLER_NAMES.map((n) => [n, true])));

/** Groups declared on the handler (preferred) or its controller. */
export function throttleGroupsOf(ctx: ExecutionContext): ThrottleGroup[] {
  const fromHandler = Reflect.getMetadata(
    THROTTLE_GROUPS_KEY,
    ctx.getHandler(),
  ) as ThrottleGroup[] | undefined;
  if (fromHandler) return fromHandler;
  return (
    (Reflect.getMetadata(THROTTLE_GROUPS_KEY, ctx.getClass()) as
      | ThrottleGroup[]
      | undefined) ?? []
  );
}
