import { TestBed } from '@angular/core/testing';
import { GamificationClient, type Multiplier } from '@codify/api-client';
import {
  PromotionsService,
  promoTargetKey,
  promoValue,
} from './promotions.service';
import { promoCodeErrorKey } from './promo-code-redeem.component';
import {
  bonusLabels,
  countdown,
  multiplierLabels,
} from '../../reward-overlays.component';

const m = (over: Partial<Multiplier>): Multiplier => ({
  id: over.id ?? 'm',
  kind: 'COURSE_PROMO',
  target: 'BOTH',
  value: 2,
  startsAt: null,
  endsAt: null,
  courseId: null,
  lessonId: null,
  streakDaysMin: null,
  description: null,
  isActive: true,
  activeNow: true,
  createdAt: '',
  updatedAt: '',
  ...over,
});

describe('PromotionsService', () => {
  const rows = [
    m({ id: 'c', kind: 'COURSE_PROMO', courseId: 'C1', value: 3 }),
    m({
      id: 'l',
      kind: 'LESSON_PROMO',
      lessonId: 'L1',
      value: 5,
      target: 'XP',
    }),
    m({ id: 'camp', kind: 'CAMPAIGN', value: 2 }),
    m({
      id: 'old',
      kind: 'CAMPAIGN',
      value: 9,
      endsAt: '2020-01-01T00:00:00Z',
    }),
  ];
  let svc: PromotionsService;
  const activePromotions = jest.fn(async () => rows);

  beforeEach(async () => {
    activePromotions.mockClear();
    TestBed.configureTestingModule({
      providers: [
        { provide: GamificationClient, useValue: { activePromotions } },
      ],
    });
    svc = TestBed.inject(PromotionsService);
    await svc.ensureLoaded();
  });

  it('lesson promo wins over the course promo (like the resolver)', () => {
    expect(svc.promoFor('C1', 'L1')?.id).toBe('l');
    expect(svc.promoFor('C1', 'other')?.id).toBe('c');
    expect(svc.promoFor('C2', null)).toBeNull();
  });

  it('picks the running campaign, ignoring ended ones', () => {
    expect(svc.campaign()?.id).toBe('camp');
  });

  it('fetches once per TTL', async () => {
    await svc.ensureLoaded();
    await svc.ensureLoaded();
    expect(activePromotions).toHaveBeenCalledTimes(1);
  });

  it('formats values and targets', () => {
    expect(promoValue({ value: 1.5 })).toBe('1.5');
    expect(promoTargetKey({ target: 'COINS' })).toBe(
      'gamification.promo.coins',
    );
  });
});

describe('reward toast helpers', () => {
  const t = (k: string, p?: Record<string, unknown>) =>
    `${k}${p ? JSON.stringify(p) : ''}`;
  it('labels multiplier parts and bonus lines', () => {
    expect(
      multiplierLabels(
        [
          {
            source: 'CAMPAIGN',
            value: 2,
            label: 'event',
            labelKey: 'gamification.multiplier.campaign',
          },
        ],
        t,
      ),
    ).toEqual(['×2 gamification.multiplier.campaign']);
    expect(
      bonusLabels(
        [
          {
            source: 'QUIZ_PERFECT',
            xp: 10,
            coins: 1,
            labelKey: 'gamification.reward.bonus.quizPerfect',
          },
        ],
        t,
      )[0],
    ).toContain('gamification.reward.bonusLine');
  });
  it('countdown is mm:ss and never negative', () => {
    expect(
      countdown('2026-11-08T10:15:00Z', Date.parse('2026-11-08T10:00:30Z')),
    ).toBe('14:30');
    expect(
      countdown('2026-11-08T10:15:00Z', Date.parse('2026-11-08T11:00:00Z')),
    ).toBe('0:00');
  });
  it('maps promo code errors to translated keys', () => {
    expect(promoCodeErrorKey('PROMO_CODE_EXPIRED')).toBe(
      'gamification.promoCode.errors.PROMO_CODE_EXPIRED',
    );
    expect(promoCodeErrorKey('weird')).toBe(
      'gamification.promoCode.errors.generic',
    );
  });
});
