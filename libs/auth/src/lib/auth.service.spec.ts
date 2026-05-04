import { TestBed } from '@angular/core/testing';
import { AuthService } from './auth.service.js';

describe('AuthService', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({});
  });

  it('starts unauthenticated when storage is empty', () => {
    const auth = TestBed.inject(AuthService);
    expect(auth.isAuthenticated()).toBe(false);
    expect(auth.role()).toBeNull();
    expect(auth.loading()).toBe(false);
  });

  it('signInAs() sets the role and persists to localStorage', () => {
    const auth = TestBed.inject(AuthService);
    auth.signInAs('TEACHER', { displayName: 'Lucas' });
    expect(auth.isAuthenticated()).toBe(true);
    expect(auth.role()).toBe('TEACHER');
    expect(auth.user()?.displayName).toBe('Lucas');
    expect(auth.currentToken()).toBe('dev-token-teacher');
    expect(localStorage.getItem('codify.auth.user')).toBeTruthy();
  });

  it('signOut() clears state and storage', () => {
    const auth = TestBed.inject(AuthService);
    auth.signInAs('STUDENT');
    auth.signOut();
    expect(auth.isAuthenticated()).toBe(false);
    expect(localStorage.getItem('codify.auth.user')).toBeNull();
  });

  it('updateProfile() merges fields into the signed-in user', () => {
    const auth = TestBed.inject(AuthService);
    auth.signInAs('STUDENT');
    auth.updateProfile({ displayName: 'Renamed', locale: 'en-US' });
    expect(auth.user()?.displayName).toBe('Renamed');
    expect(auth.user()?.locale).toBe('en-US');
    expect(auth.user()?.role).toBe('STUDENT');
    const persisted = JSON.parse(localStorage.getItem('codify.auth.user')!);
    expect(persisted.displayName).toBe('Renamed');
  });

  it('updateProfile() is a no-op when unauthenticated', () => {
    const auth = TestBed.inject(AuthService);
    auth.updateProfile({ displayName: 'Ghost' });
    expect(auth.user()).toBeNull();
  });

  it('hasAnyRole(): empty list = any authenticated user qualifies', () => {
    const auth = TestBed.inject(AuthService);
    expect(auth.hasAnyRole([])).toBe(false); // unauthenticated
    auth.signInAs('SUPPORT');
    expect(auth.hasAnyRole([])).toBe(true);
    expect(auth.hasAnyRole(['ADMIN'])).toBe(false);
    expect(auth.hasAnyRole(['SUPPORT', 'ADMIN'])).toBe(true);
  });
});
