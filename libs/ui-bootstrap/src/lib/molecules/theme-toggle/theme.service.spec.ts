import { TestBed } from '@angular/core/testing';
import {
  THEME_PERSISTENCE,
  ThemeService,
  isThemeMode,
  themeClasses,
} from './theme.service.js';

describe('ThemeService', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.className = '';
  });

  it('maps modes to <html> classes (high contrast is light-based)', () => {
    expect(themeClasses('light')).toEqual(['theme-light']);
    expect(themeClasses('dark')).toEqual(['theme-dark']);
    expect(themeClasses('system')).toEqual([]);
    expect(themeClasses('high-contrast')).toEqual(['theme-light', 'theme-hc']);
    expect(isThemeMode('high-contrast')).toBe(true);
    expect(isThemeMode('neon')).toBe(false);
  });

  it('setMode applies, stores locally and saves to the account; adopt does not save', async () => {
    const persist = jest.fn(async () => undefined);
    TestBed.configureTestingModule({
      providers: [{ provide: THEME_PERSISTENCE, useValue: { persist } }],
    });
    const svc = TestBed.inject(ThemeService);
    svc.setMode('high-contrast');
    expect(document.documentElement.classList.contains('theme-hc')).toBe(true);
    expect(localStorage.getItem('codify.theme')).toBe('high-contrast');
    expect(persist).toHaveBeenCalledWith('high-contrast');
    svc.adopt('dark');
    expect(document.documentElement.classList.contains('theme-hc')).toBe(false);
    expect(document.documentElement.classList.contains('theme-dark')).toBe(
      true,
    );
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it('usePersistence attaches a saver later', () => {
    const svc = TestBed.inject(ThemeService);
    const persist = jest.fn(async () => undefined);
    svc.usePersistence({ persist });
    svc.setMode('light');
    expect(persist).toHaveBeenCalledWith('light');
  });
});
