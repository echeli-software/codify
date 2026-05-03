import { TestBed } from '@angular/core/testing';
import { Button } from './button.js';

describe('Button', () => {
  it('renders the projected content', async () => {
    await TestBed.configureTestingModule({ imports: [Button] }).compileComponents();
    const fixture = TestBed.createComponent(Button);
    fixture.componentRef.setInput('kind', 'primary');
    fixture.detectChanges();
    const btn = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
    expect(btn).toBeTruthy();
    expect(btn.classList.contains('cdf-button--primary')).toBe(true);
    expect(btn.disabled).toBe(false);
  });

  it('disables and shows spinner while loading', async () => {
    await TestBed.configureTestingModule({ imports: [Button] }).compileComponents();
    const fixture = TestBed.createComponent(Button);
    fixture.componentRef.setInput('loading', true);
    fixture.detectChanges();
    const btn = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(fixture.nativeElement.querySelector('.cdf-button__spinner')).toBeTruthy();
  });

  it('appends size modifier for non-md sizes', async () => {
    await TestBed.configureTestingModule({ imports: [Button] }).compileComponents();
    const fixture = TestBed.createComponent(Button);
    fixture.componentRef.setInput('size', 'lg');
    fixture.detectChanges();
    const btn = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
    expect(btn.classList.contains('cdf-button--lg')).toBe(true);
  });
});
