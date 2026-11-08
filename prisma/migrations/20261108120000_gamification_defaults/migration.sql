-- Gamification defaults (docs/07 §3, §6–§8, docs/02 seed, docs/10 §1).
-- DATA ONLY — no schema change. Every insert is idempotent and safe on a
-- database where admins already created rows:
--   * multipliers are inserted only when no row of that kind (and, for
--     streak tiers, that streakDaysMin) exists yet;
--   * quest templates, badges, item category and items skip existing slugs;
--   * en-US translations skip existing (entity, locale, field) rows and are
--     attached by slug, so they follow whichever row owns the slug.
-- Source text is pt-BR (the default content locale).

-- ─── Multipliers ────────────────────────────────────────────────────────

-- PREMIUM_DEFAULT 2.0 (docs/07 §3).
INSERT INTO "Multiplier" ("id", "kind", "target", "value", "description", "isActive", "createdAt", "updatedAt")
SELECT 'seed-multiplier-premium-default', 'PREMIUM_DEFAULT', 'BOTH', 2.00,
       'Premium: 2x XP and coins', true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Multiplier" WHERE "kind" = 'PREMIUM_DEFAULT')
ON CONFLICT ("id") DO NOTHING;

-- STREAK_TIER rows (docs/07 §6 table).
INSERT INTO "Multiplier" ("id", "kind", "target", "value", "streakDaysMin", "description", "isActive", "createdAt", "updatedAt")
SELECT t.id, 'STREAK_TIER', 'BOTH', t.value, t.days, t.description, true, NOW(), NOW()
FROM (VALUES
  ('seed-multiplier-streak-7',   7,   1.10, '7-day streak: 1.1x'),
  ('seed-multiplier-streak-14',  14,  1.25, '14-day streak: 1.25x'),
  ('seed-multiplier-streak-30',  30,  1.50, '30-day streak: 1.5x'),
  ('seed-multiplier-streak-100', 100, 1.75, '100-day streak: 1.75x'),
  ('seed-multiplier-streak-365', 365, 2.00, '365-day streak: 2x')
) AS t(id, days, value, description)
WHERE NOT EXISTS (
  SELECT 1 FROM "Multiplier" m
  WHERE m."kind" = 'STREAK_TIER' AND m."streakDaysMin" = t.days
)
ON CONFLICT ("id") DO NOTHING;

-- ─── Daily quest templates (docs/07 §8; 20 coins each, docs/07 §2) ──────

INSERT INTO "QuestTemplate" ("id", "slug", "kind", "title", "difficulty", "weight", "target", "coinReward", "xpReward", "isActive", "createdAt", "updatedAt")
VALUES
  ('seed-quest-streak-keep',   'daily-streak-keep',   'STREAK_MAINTAIN', 'Mantenha sua ofensiva hoje', 1, 3, 1,   20, 0,  true, NOW(), NOW()),
  ('seed-quest-lesson-1',      'daily-lesson-1',      'LESSON_COUNT',    'Conclua 1 lição',            1, 3, 1,   20, 0,  true, NOW(), NOW()),
  ('seed-quest-xp-30',         'daily-xp-30',         'XP_AMOUNT',       'Ganhe 30 XP',                1, 2, 30,  20, 0,  true, NOW(), NOW()),
  ('seed-quest-lessons-2',     'daily-lessons-2',     'LESSON_COUNT',    'Conclua 2 lições',           2, 3, 2,   20, 10, true, NOW(), NOW()),
  ('seed-quest-xp-75',         'daily-xp-75',         'XP_AMOUNT',       'Ganhe 75 XP',                2, 2, 75,  20, 10, true, NOW(), NOW()),
  ('seed-quest-exercise-1',    'daily-exercise-1',    'EXERCISE_PASS',   'Passe em 1 exercício',       2, 1, 1,   20, 10, true, NOW(), NOW()),
  ('seed-quest-lessons-4',     'daily-lessons-4',     'LESSON_COUNT',    'Conclua 4 lições',           3, 3, 4,   20, 20, true, NOW(), NOW()),
  ('seed-quest-xp-150',        'daily-xp-150',        'XP_AMOUNT',       'Ganhe 150 XP',               3, 2, 150, 20, 20, true, NOW(), NOW()),
  ('seed-quest-exercise-3',    'daily-exercise-3',    'EXERCISE_PASS',   'Passe em 3 exercícios',      3, 1, 3,   20, 20, true, NOW(), NOW())
ON CONFLICT DO NOTHING;

-- ─── Starter badges (docs/07 §7 examples / docs/02 "6 starter badges") ──

INSERT INTO "Badge" ("id", "slug", "name", "description", "iconName", "rule", "xpReward", "coinReward", "isHidden", "isActive", "createdAt", "updatedAt")
VALUES
  ('seed-badge-first-steps', 'first-steps', 'Primeiros passos', 'Concluiu a primeira lição.', 'star',
   '{"all":[{"event":"lesson_complete","count":{"gte":1}}]}', 10, 10, false, true, NOW(), NOW()),
  ('seed-badge-week-warrior', 'week-warrior', 'Guerreiro da semana', 'Ofensiva de 7 dias.', 'flame',
   '{"all":[{"metric":"streak.current_days","gte":7}]}', 0, 50, false, true, NOW(), NOW()),
  ('seed-badge-polyglot', 'polyglot', 'Poliglota', 'Concluiu lições em 3 categorias.', 'language',
   '{"all":[{"metric":"categories.completed","gte":3}]}', 0, 50, false, true, NOW(), NOW()),
  ('seed-badge-code-crusher', 'code-crusher', 'Esmagador de código', 'Passou em 50 exercícios.', 'rocket',
   '{"all":[{"event":"exercise_pass","count":{"gte":50}}]}', 50, 100, false, true, NOW(), NOW()),
  ('seed-badge-prompt-pro', 'prompt-pro', 'Mestre do prompt', 'Passou em 10 desafios de IA com nota 80 ou mais.', 'sparkles',
   '{"all":[{"event":"ai_prompt_pass","where":{"scorePct":{"gte":80}},"count":{"gte":10}}]}', 50, 100, false, true, NOW(), NOW()),
  ('seed-badge-comeback', 'comeback', 'A volta por cima', 'Concluiu uma lição depois de perder uma ofensiva.', 'heart',
   '{"all":[{"event":"lesson_complete","where":{"afterStreakLost":true}}]}', 0, 25, true, true, NOW(), NOW())
ON CONFLICT DO NOTHING;

-- ─── Exclusive streak cosmetics (docs/10 §1: 30 / 100 / 365 days) ───────
-- Inactive = never listed or sold in the shop; granted by the reward
-- pipeline (UserItem source PROMO) when the milestone is reached, then
-- owned and equippable like any item.

INSERT INTO "ItemCategory" ("slug", "name", "sortOrder", "createdAt", "updatedAt")
VALUES ('streak-rewards', 'Recompensas de ofensiva', 90, NOW(), NOW())
ON CONFLICT DO NOTHING;

INSERT INTO "Item" ("id", "slug", "name", "description", "slot", "categorySlug", "rarity", "costCoins", "requiredLevel", "isPremiumOnly", "isLimitedDrop", "spriteAssetId", "isActive", "createdAt", "updatedAt")
VALUES
  ('seed-item-streak-30', 'streak-30-flame-frame', 'Moldura de chamas', 'Exclusiva: ofensiva de 30 dias.', 'FRAME', 'streak-rewards', 'EPIC', 0, 1, false, false, 'color:#ff7a1a', false, NOW(), NOW()),
  ('seed-item-streak-100', 'streak-100-blaze-hat', 'Coroa em brasa', 'Exclusiva: ofensiva de 100 dias.', 'HAT', 'streak-rewards', 'LEGENDARY', 0, 1, false, false, 'emoji:🔥', false, NOW(), NOW()),
  ('seed-item-streak-365', 'streak-365-phoenix-pet', 'Fênix', 'Exclusiva: ofensiva de 365 dias.', 'PET', 'streak-rewards', 'LEGENDARY', 0, 1, false, false, 'emoji:🐦‍🔥', false, NOW(), NOW())
ON CONFLICT DO NOTHING;

-- ─── en-US translations (attached by slug) ──────────────────────────────

INSERT INTO "ContentTranslation" ("id", "entityType", "entityId", "locale", "field", "value", "outdated", "createdAt", "updatedAt")
SELECT 'seed-tr-quest-' || q.slug, 'QUEST', t.id, 'en-US', 'title', q.title, false, NOW(), NOW()
FROM (VALUES
  ('daily-streak-keep', 'Keep your streak alive today'),
  ('daily-lesson-1',    'Complete 1 lesson'),
  ('daily-xp-30',       'Earn 30 XP'),
  ('daily-lessons-2',   'Complete 2 lessons'),
  ('daily-xp-75',       'Earn 75 XP'),
  ('daily-exercise-1',  'Pass 1 exercise'),
  ('daily-lessons-4',   'Complete 4 lessons'),
  ('daily-xp-150',      'Earn 150 XP'),
  ('daily-exercise-3',  'Pass 3 exercises')
) AS q(slug, title)
JOIN "QuestTemplate" t ON t."slug" = q.slug
ON CONFLICT DO NOTHING;

INSERT INTO "ContentTranslation" ("id", "entityType", "entityId", "locale", "field", "value", "outdated", "createdAt", "updatedAt")
SELECT 'seed-tr-badge-' || b.slug || '-' || b.field, 'BADGE', x.id, 'en-US', b.field, b.value, false, NOW(), NOW()
FROM (VALUES
  ('first-steps',  'name',        'First Steps'),
  ('first-steps',  'description', 'Completed your first lesson.'),
  ('week-warrior', 'name',        'Week Warrior'),
  ('week-warrior', 'description', 'A 7-day streak.'),
  ('polyglot',     'name',        'Polyglot'),
  ('polyglot',     'description', 'Completed lessons in 3 categories.'),
  ('code-crusher', 'name',        'Code Crusher'),
  ('code-crusher', 'description', 'Passed 50 exercises.'),
  ('prompt-pro',   'name',        'Prompt Pro'),
  ('prompt-pro',   'description', 'Passed 10 AI challenges with a score of 80 or more.'),
  ('comeback',     'name',        'Comeback'),
  ('comeback',     'description', 'Completed a lesson after losing a streak.')
) AS b(slug, field, value)
JOIN "Badge" x ON x."slug" = b.slug
ON CONFLICT DO NOTHING;

INSERT INTO "ContentTranslation" ("id", "entityType", "entityId", "locale", "field", "value", "outdated", "createdAt", "updatedAt")
SELECT 'seed-tr-item-' || i.slug || '-' || i.field, 'ITEM', x.id, 'en-US', i.field, i.value, false, NOW(), NOW()
FROM (VALUES
  ('streak-30-flame-frame',  'name',        'Flame Frame'),
  ('streak-30-flame-frame',  'description', 'Exclusive: 30-day streak.'),
  ('streak-100-blaze-hat',   'name',        'Blazing Crown'),
  ('streak-100-blaze-hat',   'description', 'Exclusive: 100-day streak.'),
  ('streak-365-phoenix-pet', 'name',        'Phoenix'),
  ('streak-365-phoenix-pet', 'description', 'Exclusive: 365-day streak.')
) AS i(slug, field, value)
JOIN "Item" x ON x."slug" = i.slug
ON CONFLICT DO NOTHING;

INSERT INTO "ContentTranslation" ("id", "entityType", "entityId", "locale", "field", "value", "outdated", "createdAt", "updatedAt")
VALUES ('seed-tr-item-category-streak-rewards', 'ITEM_CATEGORY', 'streak-rewards', 'en-US', 'name', 'Streak rewards', false, NOW(), NOW())
ON CONFLICT DO NOTHING;
