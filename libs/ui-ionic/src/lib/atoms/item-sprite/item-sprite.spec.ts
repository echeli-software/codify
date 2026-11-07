import { TestBed } from '@angular/core/testing';
import { ItemSprite } from './item-sprite.js';

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
});
