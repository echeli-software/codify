import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideI18n } from '@codify/i18n';
import { AvatarRenderer } from '../../molecules/avatar-renderer/avatar-renderer.js';
import { ItemSprite } from './item-sprite.js';
import { SPRITE_URL_RESOLVER } from './sprite-url-resolver.js';

function mount(inputs: { token: string; url?: string | null; size?: number }) {
  const fixture = TestBed.createComponent(ItemSprite);
  fixture.componentRef.setInput('token', inputs.token);
  if (inputs.url !== undefined)
    fixture.componentRef.setInput('url', inputs.url);
  if (inputs.size !== undefined)
    fixture.componentRef.setInput('size', inputs.size);
  fixture.detectChanges();
  return { fixture, el: fixture.nativeElement as HTMLElement };
}

describe('ItemSprite', () => {
  it('renders the uploaded image when a spriteUrl is resolved', () => {
    const { el } = mount({
      token: '01960000-0000-7000-8000-000000000001',
      url: 'https://cdn.test/crown.png',
      size: 48,
    });
    const img = el.querySelector('img');
    expect(img?.getAttribute('src')).toBe('https://cdn.test/crown.png');
    expect(img?.getAttribute('width')).toBe('48');
    expect(img?.getAttribute('alt')).toBe('');
    expect(el.getAttribute('aria-hidden')).toBe('true');
  });

  it('renders emoji and color tokens without an image', () => {
    const emoji = mount({ token: 'emoji:🎩' }).el;
    expect(emoji.querySelector('img')).toBeNull();
    expect(emoji.textContent).toContain('🎩');
    const color = mount({ token: 'color:#ffd700', size: 30 }).el;
    const swatch = color.querySelector<HTMLElement>('.cdf-item-sprite__swatch');
    expect(swatch?.style.background).toContain('rgb(255, 215, 0)');
    expect(swatch?.style.width).toBe('30px');
  });

  it('falls back to the token when the image fails, and retries a new URL', () => {
    const { fixture, el } = mount({
      token: 'emoji:🧢',
      url: 'https://cdn.test/broken.png',
    });
    el.querySelector('img')?.dispatchEvent(new Event('error'));
    fixture.detectChanges();
    expect(el.querySelector('img')).toBeNull();
    expect(el.textContent).toContain('🧢');
    fixture.componentRef.setInput('url', 'https://cdn.test/ok.png');
    fixture.detectChanges();
    expect(el.querySelector('img')?.getAttribute('src')).toBe(
      'https://cdn.test/ok.png',
    );
  });

  it('renders through SPRITE_URL_RESOLVER when provided (reactively)', () => {
    const local = signal<string | null>(null);
    TestBed.configureTestingModule({
      providers: [
        {
          provide: SPRITE_URL_RESOLVER,
          useValue: {
            resolve: (url: string) =>
              url === 'https://cdn.test/crown.png' ? local() : null,
          },
        },
      ],
    });
    const { fixture, el } = mount({
      token: 'emoji:👑',
      url: 'https://cdn.test/crown.png',
    });
    // Not stored yet → the original URL.
    expect(el.querySelector('img')?.getAttribute('src')).toBe(
      'https://cdn.test/crown.png',
    );
    local.set('capacitor://localhost/_capacitor_file_/sprites/crown.png');
    fixture.detectChanges();
    expect(el.querySelector('img')?.getAttribute('src')).toBe(
      'capacitor://localhost/_capacitor_file_/sprites/crown.png',
    );
  });
});

describe('AvatarRenderer + SPRITE_URL_RESOLVER', () => {
  it('renders equipped sprite images from the resolved URL', () => {
    TestBed.configureTestingModule({
      providers: [
        provideI18n(),
        {
          provide: SPRITE_URL_RESOLVER,
          useValue: { resolve: (url: string) => `local:${url}` },
        },
      ],
    });
    const fixture = TestBed.createComponent(AvatarRenderer);
    fixture.componentRef.setInput('equipped', {
      HAT: { spriteAssetId: 'emoji:🎩', spriteUrl: 'https://cdn.test/hat.png' },
      SHOES: { spriteAssetId: 'emoji:👟' },
    });
    fixture.detectChanges();
    const imgs = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('svg image'),
    ).map((i) => i.getAttribute('href'));
    expect(imgs).toEqual(['local:https://cdn.test/hat.png']);
  });
});

describe('AvatarRenderer SVG composite (docs/08 §4)', () => {
  function render(inputs: Record<string, unknown>) {
    TestBed.configureTestingModule({ providers: [provideI18n()] });
    const fixture = TestBed.createComponent(AvatarRenderer);
    for (const [k, v] of Object.entries(inputs))
      fixture.componentRef.setInput(k, v);
    fixture.detectChanges();
    return fixture;
  }

  it('draws the base body from the config (skin, eyes, hair)', () => {
    const f = render({
      config: {
        skinTone: 'deep',
        eyeColor: '#3d6a9e',
        baseHairStyle: 'curly',
        baseHairColor: '#b8432f',
      },
    });
    const el = f.nativeElement as HTMLElement;
    expect(el.querySelector('[data-part="head"]')?.getAttribute('fill')).toBe(
      '#4a2c1c',
    );
    expect(el.querySelector('[data-part="iris"]')?.getAttribute('fill')).toBe(
      '#3d6a9e',
    );
    expect(el.querySelector('g[data-part="hair"]')?.getAttribute('fill')).toBe(
      '#b8432f',
    );
  });

  it('tints clothes with color tokens and glows rare items', () => {
    const f = render({
      equipped: {
        TOP: { spriteAssetId: 'color:#e4572e', name: 'Tee' },
        HAT: { spriteAssetId: 'emoji:👑', name: 'Crown', rarity: 'LEGENDARY' },
      },
    });
    const el = f.nativeElement as HTMLElement;
    expect(el.querySelector('[data-part="torso"]')?.getAttribute('fill')).toBe(
      '#e4572e',
    );
    const hat = el.querySelector('[data-slot="HAT"]');
    expect(hat?.getAttribute('filter')).toMatch(
      /^url\(#cdf-av-\d+-glow-LEGENDARY\)$/,
    );
    expect(el.querySelectorAll('filter')).toHaveLength(1);
  });

  it('poses and click output', () => {
    const f = render({ pose: 'cheer', interactive: true });
    const root = (f.nativeElement as HTMLElement).querySelector('.avatar')!;
    expect(root.getAttribute('data-pose')).toBe('cheer');
    expect(root.getAttribute('role')).toBe('button');
    let clicks = 0;
    f.componentInstance.avatarClick.subscribe(() => clicks++);
    (root as HTMLElement).click();
    root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(clicks).toBe(2);
  });

  it('is a plain image when not interactive', () => {
    const f = render({});
    const root = (f.nativeElement as HTMLElement).querySelector('.avatar')!;
    expect(root.getAttribute('role')).toBe('img');
    let clicks = 0;
    f.componentInstance.avatarClick.subscribe(() => clicks++);
    (root as HTMLElement).click();
    expect(clicks).toBe(0);
  });
});
