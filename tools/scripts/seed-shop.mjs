#!/usr/bin/env node
/**
 * Seed a first-batch placeholder shop catalog (~60 items) via the admin API,
 * per docs/08-avatar-and-shop.md §16. Idempotent-ish: skips slugs that 409.
 * Sprites are placeholder tokens (emoji:/color:) until the SVG/R2 pipeline.
 *
 *   node tools/scripts/seed-shop.mjs
 */

const API = process.env.API_URL || 'http://localhost:3000/api';
const ADMIN = 'Bearer dev-token-admin';

async function api(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'content-type': 'application/json', authorization: ADMIN, 'idempotency-key': crypto.randomUUID() },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.text().then((t) => (t ? JSON.parse(t) : null)) };
}

const CATEGORIES = [
  { slug: 'animals', name: 'Animals' },
  { slug: 'scifi', name: 'Sci-fi' },
  { slug: 'dev-culture', name: 'Dev culture' },
  { slug: 'brazilian-flair', name: 'Brazilian flair' },
  { slug: 'basics', name: 'Basics' },
  { slug: 'founding', name: 'Founding Codifier' },
];

// [slug, name, slot, category, rarity, cost, emoji, {opts}]
const ITEMS = [
  // Pets (8)
  ['pet-cat', 'Cat', 'PET', 'animals', 'COMMON', 150, '🐈'],
  ['pet-dog', 'Dog', 'PET', 'animals', 'COMMON', 150, '🐕'],
  ['pet-capivara', 'Capivara', 'PET', 'brazilian-flair', 'RARE', 600, '🦫'],
  ['pet-dragon', 'Dragon', 'PET', 'scifi', 'EPIC', 1500, '🐉', { requiredLevel: 10 }],
  ['pet-robot', 'Robot', 'PET', 'scifi', 'UNCOMMON', 350, '🤖'],
  ['pet-octopus', 'Octopus', 'PET', 'animals', 'UNCOMMON', 300, '🐙'],
  ['pet-axolotl', 'Axolotl', 'PET', 'animals', 'RARE', 700, '🦎'],
  ['pet-duck', 'Rubber Duck', 'PET', 'dev-culture', 'COMMON', 120, '🦆'],
  // Backgrounds (6)
  ['bg-plain', 'Plain Blue', 'BACKGROUND', 'basics', 'COMMON', 50, null, { color: '#cfe3ff' }],
  ['bg-editor', 'Code Editor', 'BACKGROUND', 'dev-culture', 'UNCOMMON', 250, null, { color: '#1e1e2e' }],
  ['bg-beach', 'Beach', 'BACKGROUND', 'basics', 'UNCOMMON', 250, null, { color: '#ffe9b3' }],
  ['bg-mountain', 'Mountain', 'BACKGROUND', 'basics', 'UNCOMMON', 250, null, { color: '#bcd3c2' }],
  ['bg-space', 'Space', 'BACKGROUND', 'scifi', 'RARE', 500, null, { color: '#0b1026' }],
  ['bg-retro', 'Retro Grid', 'BACKGROUND', 'dev-culture', 'RARE', 500, null, { color: '#2a0a3a' }],
  // Tops (12)
  ['top-tee', 'Basic Tee', 'TOP', 'basics', 'COMMON', 80, '👕'],
  ['top-hoodie', 'Hoodie', 'TOP', 'basics', 'COMMON', 120, '🧥'],
  ['top-polo', 'Polo', 'TOP', 'basics', 'COMMON', 110, '👔'],
  ['top-blazer', 'Blazer', 'TOP', 'basics', 'UNCOMMON', 300, '🥼'],
  ['top-labcoat', 'Lab Coat', 'TOP', 'dev-culture', 'UNCOMMON', 320, '🥼'],
  ['top-conf', 'Conf Shirt', 'TOP', 'dev-culture', 'UNCOMMON', 280, '👕'],
  ['top-jersey', 'Brazil Jersey', 'TOP', 'brazilian-flair', 'RARE', 650, '🟢'],
  ['top-kimono', 'Kimono', 'TOP', 'basics', 'RARE', 600, '🥋'],
  ['top-tank', 'Tank Top', 'TOP', 'basics', 'COMMON', 70, '🎽'],
  ['top-sweater', 'Sweater', 'TOP', 'basics', 'COMMON', 130, '🧶'],
  ['top-vest', 'Vest', 'TOP', 'basics', 'UNCOMMON', 220, '🦺'],
  ['top-tux', 'Tuxedo', 'TOP', 'basics', 'EPIC', 1200, '🤵', { requiredLevel: 8 }],
  // Hats (8)
  ['hat-cap', 'Cap', 'HAT', 'basics', 'COMMON', 60, '🧢'],
  ['hat-beanie', 'Beanie', 'HAT', 'basics', 'COMMON', 70, '🎩'],
  ['hat-party', 'Party Hat', 'HAT', 'basics', 'UNCOMMON', 200, '🥳'],
  ['hat-headphones', 'Headphones', 'HAT', 'dev-culture', 'UNCOMMON', 280, '🎧'],
  ['hat-thinking', 'Thinking Cap', 'HAT', 'dev-culture', 'RARE', 550, '🎓'],
  ['hat-helmet', 'Construction Helmet', 'HAT', 'basics', 'UNCOMMON', 240, '⛑️'],
  ['hat-wizard', 'Wizard Hat', 'HAT', 'scifi', 'EPIC', 1300, '🧙', { requiredLevel: 12 }],
  ['hat-crown', 'Crown', 'HAT', 'basics', 'LEGENDARY', 4000, '👑', { requiredLevel: 25 }],
  // Glasses (6)
  ['glasses-round', 'Round Glasses', 'GLASSES', 'basics', 'COMMON', 90, '👓'],
  ['glasses-sun', 'Sunglasses', 'GLASSES', 'basics', 'COMMON', 100, '🕶️'],
  ['glasses-3d', '3D Glasses', 'GLASSES', 'dev-culture', 'UNCOMMON', 220, '🤓'],
  ['glasses-vr', 'VR Headset', 'GLASSES', 'scifi', 'RARE', 600, '🥽'],
  ['glasses-monocle', 'Monocle', 'GLASSES', 'basics', 'RARE', 580, '🧐'],
  ['glasses-star', 'Star Shades', 'GLASSES', 'basics', 'EPIC', 1100, '🤩', { requiredLevel: 6 }],
  // Frames (5)
  ['frame-gold', 'Gold Circle', 'FRAME', 'basics', 'RARE', 700, null, { color: '#ffd700' }],
  ['frame-wood', 'Wood Square', 'FRAME', 'basics', 'UNCOMMON', 300, null, { color: '#8b5a2b' }],
  ['frame-neon', 'Neon', 'FRAME', 'scifi', 'EPIC', 1400, null, { color: '#39ff14' }],
  ['frame-green', 'Verde-Amarelo', 'FRAME', 'brazilian-flair', 'RARE', 650, null, { color: '#009c3b' }],
  ['frame-legendary', 'Mythic Aura', 'FRAME', 'founding', 'LEGENDARY', 5000, null, { color: '#b14aff', requiredLevel: 30 }],
  // Premium-only sampler (3)
  ['top-premium-cape', 'Premium Cape', 'ACCESSORY', 'founding', 'EPIC', 0, '🦸', { isPremiumOnly: true }],
  ['hat-premium-halo', 'Premium Halo', 'HAT', 'founding', 'LEGENDARY', 0, '😇', { isPremiumOnly: true }],
  ['pet-premium-phoenix', 'Premium Phoenix', 'PET', 'founding', 'LEGENDARY', 0, '🔥', { isPremiumOnly: true }],
  // Founding limited drop (4) — window set generously so they're live now.
  ['founding-pin', 'Founder Pin', 'ACCESSORY', 'founding', 'RARE', 500, '📌', { limited: true }],
  ['founding-badge-hat', 'Founder Hat', 'HAT', 'founding', 'EPIC', 900, '🎖️', { limited: true }],
  ['founding-bg', 'Founder Backdrop', 'BACKGROUND', 'founding', 'EPIC', 900, null, { color: '#1b2a4a', limited: true }],
  ['founding-frame', 'Founder Frame', 'FRAME', 'founding', 'LEGENDARY', 2000, null, { color: '#caa64a', limited: true }],
];

async function main() {
  console.log(`Seeding shop catalog → ${API}\n`);
  for (const c of CATEGORIES) {
    const r = await api('POST', '/item-categories', c);
    console.log(`  category ${c.slug}: ${r.status === 201 ? 'created' : r.status === 409 ? 'exists' : `ERR ${r.status}`}`);
  }
  let created = 0;
  let skipped = 0;
  for (const [slug, name, slot, category, rarity, cost, emoji, opts = {}] of ITEMS) {
    const sprite = emoji ? `emoji:${emoji}` : `color:${opts.color}`;
    const body = {
      slug, name, slot, categorySlug: category, rarity, costCoins: cost, spriteAssetId: sprite,
      requiredLevel: opts.requiredLevel ?? 1,
      isPremiumOnly: !!opts.isPremiumOnly,
      isLimitedDrop: !!opts.limited,
      ...(opts.limited ? { dropStartsAt: '2026-01-01T00:00:00Z', dropEndsAt: '2027-01-01T00:00:00Z' } : {}),
    };
    const r = await api('POST', '/items', body);
    if (r.status === 201) created += 1;
    else { skipped += 1; if (r.status !== 409) console.error(`  ITEM ERR ${slug}: ${r.status} ${JSON.stringify(r.body)}`); }
  }
  console.log(`\nItems: ${created} created, ${skipped} skipped (existing/err). Total catalog: ${ITEMS.length}.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
