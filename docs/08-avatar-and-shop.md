# 08 — Avatar & Shop

The avatar is the user's persistent identity in the app and the carrier of cosmetic progression. Inspired by Habitica's pixel-pet collecting energy.

## 1. Avatar concept

A 2D character composed of stacked SVG layers. Slot-based: each slot holds at most one item. The base character (body + skin tone + base hair) is provided free at signup; everything else is unlocked through coins, level requirements, and (sparingly) premium-only items.

## 2. Slots & layer order

```
Top of stack
─── frame             (decorative ring around avatar in profile)
─── glasses
─── hat
─── front-accessory   (e.g. necklace, microphone)
─── hair              (drawn around head; replaces base hair if equipped)
─── top
─── bottom
─── shoes
─── back-accessory    (e.g. backpack, wings)
─── pet               (rendered to the side, not stacked)
─── base body         (always present)
─── background        (full-bleed behind avatar)
─── emote             (transient overlay; not equipped persistently)
Bottom of stack
```

`emote` is a special slot — equipping it just plays a one-shot animation (used as profile flair, in chat reactions later).

## 3. Asset format

- **SVG** preferred. Single-file per item, with named groups so we can recolor/restyle.
- **Anchor system**: every slot's SVG is authored against a 256×256 canvas with documented anchor points (e.g. `hat` anchors to `(128, 60)` of the base body). Items declare their slot; the renderer knows the placement.
- **Rarity glow**: a CSS filter / SVG `<filter>` applied via the renderer based on `Item.rarity`, not baked into the asset.
- **Recolorable asset variants** (later): assets can include `data-recolor="primary|secondary"` groups; user can pick a color from a palette per-slot.

Fallback: PNG sprite sheets supported but discouraged (no scaling, no recoloring).

## 4. AvatarRenderer component

Lives in shared visuals (framework-agnostic Angular standalone) — used by admin (item preview, user inspector) and student (everywhere).

```ts
interface AvatarRendererProps {
  config: AvatarConfig;            // base body, skin tone, base hair color
  equipped?: { [slot in ItemSlot]?: ItemRef };
  size?: number;                    // pixel size; default 256
  pose?: 'idle' | 'wave' | 'cheer' | 'study';
  frame?: ItemRef;                  // shortcut; same as equipped[FRAME]
  showLevelRing?: boolean;          // ring with level number; uses tier color
  level?: number;
  background?: ItemRef;
  pet?: ItemRef;
  animatePose?: boolean;            // tiny idle breathing animation
}
```

- Renders a single SVG composite via `<svg viewBox="0 0 256 256">` with stacked `<image>` or `<use>` references.
- Emits no DOM events except optional `(click)` for tap-to-customize.
- Reduced-motion: pose animation disabled.

## 5. AvatarConfig (schema fragment)

```ts
type SkinTone = 'porcelain' | 'fair' | 'light' | 'tan' | 'olive' | 'brown' | 'dark' | 'deep';
type BaseHairStyle = 'short' | 'medium' | 'long' | 'curly' | 'coily' | 'bald' | 'covered';
type BaseHairColor = string;       // hex from a curated palette
type EyeColor = string;            // hex from a curated palette

type AvatarConfig = {
  baseBodyId: string;               // base body SVG asset
  skinTone: SkinTone;
  baseHairStyle: BaseHairStyle;
  baseHairColor: BaseHairColor;
  eyeColor: EyeColor;
  /// Future: facialHair, freckles, glasses-baked-in?
};
```

Stored as JSON on `User.avatarConfig`. Customizable in the dressing room without unlocking anything (free).

## 6. Item taxonomy

`ItemCategory` is a catalog grouping (e.g. "Animals", "Sci-fi", "Dev culture", "Brazilian flair", "Seasonal — June Festas Juninas"). Each item belongs to one category and one slot.

`ItemRarity`:
| Rarity | Visual treatment | Drop weight in chests | Typical price (coins) |
|---|---|---|---|
| `COMMON` | Plain | High | 50–150 |
| `UNCOMMON` | Subtle highlight | Med | 200–400 |
| `RARE` | Glow + shimmer on detail page | Low | 500–800 |
| `EPIC` | Gold border + particle on equip | Very low | 1000–2000 |
| `LEGENDARY` | Animated background + unique hover | Very rare | 3000–6000 |

Prices are tunable in admin; shop balance is reviewed weekly (see [07-gamification.md §13](./07-gamification.md)).

### Premium-only items
- Flagged via `Item.isPremiumOnly`. Cannot be purchased without an active subscription, even with sufficient coins.
- Visible to free users with a "premium" badge — drives FOMO without being predatory.
- Roughly 20% of new releases should be premium-only; the rest available to everyone with enough coins. The premium *advantage* is mostly the coin multiplier, not exclusive content.

### Limited drops
- `isLimitedDrop = true` with a `dropStartsAt` / `dropEndsAt` window.
- Pinned at top of shop during the window.
- Push notification on drop start (opt-out per-kind).
- After window closes, item leaves shop. May return in a future "throwback" event.

### Required level
- `Item.requiredLevel` — visible to all users; shows lock until reached. Reasonable progression incentive without paywalling.

## 7. Shop UX

See [05-student-app.md §3 → Shop](./05-student-app.md). Highlights:

- **Limited drop section** at top with countdown.
- Filter chips by **slot**, **category**, **rarity**, **affordability** ("can buy now"), **premium-only**.
- **Affordability** badge: green check if user has the coins, premium star if user lacks subscription.
- **Try on** before buying — instantly applies to dressing-room preview without committing. "Looks great → Buy" CTA.
- **Bundles** (later): pre-curated outfit bundles at a discount.
- **Wishlist** (later): tap heart to wishlist; notify on price drop or appearance in a chest.

## 8. Inventory

- Grouped by slot, sorted by acquisition date desc.
- Filter by rarity; search by name.
- Equip / unequip per item.
- "Save outfit" creates a named preset (later) — equip-all in one tap.

## 9. Dressing room

- Live-rendered avatar, can drag to rotate (later). Pose picker (subtle).
- Slot picker: tap a slot, see owned items in that slot, pick to equip.
- Browse-shop shortcut per slot.
- "Random" button — shuffles equipped items from owned set; surprisingly fun.
- "Save" persists `EquippedItem`. Auto-saves after 3s of no changes; explicit save button always present.

## 10. Pets

- Pets sit beside the avatar (rendered to the side, not stacked).
- Can be named (per pet, by user). Name appears in profile + pet sticker reactions.
- Future: pets gain XP alongside owner, evolve into new forms (Pokemon-style). Out of scope for v1; data model accommodates by versioning the pet sprite.

## 11. Backgrounds & frames

- **Background**: full-bleed behind avatar. Affects profile, dressing room, and a small avatar widget on Today.
- **Frame**: decorative ring around avatar in profile, leaderboard, and friend cards.

## 12. Earning rules summary

| Action | Coins source |
|---|---|
| Daily learning | `LESSON_COMPLETE`, `EXERCISE_PASS`, `QUIZ_PERFECT` |
| Daily quests | `DAILY_QUEST` |
| Streak milestones | `STREAK_MILESTONE` |
| League promotion | `WEEKLY_LEAGUE` |
| Badges | `BADGE_UNLOCK` |
| Mystery chests (rarely) | `CHEST_OPEN` |
| Promo codes (campaigns) | `PROMO_CODE` |
| Manual admin grant | `ADMIN_GRANT` |
| Refund | `PURCHASE_REFUND` |

Spending:
| Action | Source |
|---|---|
| Buy item | `ITEM_PURCHASE` (negative `delta`) |
| Open chest (purchased) | `CHEST_PURCHASE` (negative `delta`) |

## 13. Anti-abuse

- Server is the only authority on coin balance — see [07-gamification.md §12](./07-gamification.md).
- Admin grants > 1000 coins require admin role and surface in audit prominently.
- Refund policy: if a real-money purchase is refunded, related `ITEM_PURCHASE` may be reverted (item removed) or kept (coins returned) per admin choice; both options audited.

## 14. Accessibility

- Avatar customization is image-based; we provide text alt for every item ("Red baseball cap").
- Color picker uses a curated palette to avoid contrast traps; "skin tone" labels are descriptive.
- Reduced motion disables idle and equip animations; equip still works as a snap.

## 15. Asset production pipeline

- Designers deliver SVG following a per-slot template (256×256, anchor doc).
- Admin uploads → API validates SVG (DOMPurify sanitize, canvas size, anchor presence) → stores in R2 → creates `Item`.
- Admin previews on the avatar via `ItemSpritePreview`.
- Translations added per locale.
- Schedule "go live" via `dropStartsAt`.

## 16. Sample first-batch catalog (signoff)

For launch, we need a curated set so the shop doesn't look empty:

- **Pets**: 8 (cat, dog, capivara, dragon, robot, octopus, axolotl, rubber duck — culturally fun mix).
- **Backgrounds**: 6 (plain colors, code editor, beach, mountain, space, retro grid).
- **Tops**: 12 (basic tee, hoodie, polo, blazer, lab coat, dev conference shirt with generic copy, traditional Brazilian shirt motifs, etc.).
- **Hats**: 8 (cap, beanie, fedora, party hat, headphones, "thinking cap", construction helmet, wizard hat).
- **Glasses**: 6.
- **Hair**: 12 (varied styles + curated colors).
- **Frames**: 5 (circle gold, square wood, neon, animated for legendary).
- **Limited launch event** (first 2 weeks): 4 exclusive items themed "Founding Codifier".

Total: ~60 items. Production sprint ≈ 2–3 weeks for one designer.

## 17. Out of scope (initial)

- 3D avatars.
- Avatar-to-avatar interactions (high/low fives, shop visits).
- Pet evolution.
- Recolorable asset variants.
- Wishlist + bundles.
- Trading or gifting items between users.
