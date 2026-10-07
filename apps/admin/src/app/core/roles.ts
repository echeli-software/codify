import { inject } from '@angular/core';
import { Router, type CanActivateFn, type UrlTree } from '@angular/router';
import { AuthService, type UserRole } from '@codify/auth';
import type { IconName } from '@codify/ui-bootstrap';

/** Admin app sections (sidebar entries / route groups). */
export type AdminSection =
  | 'dashboard'
  | 'courses'
  | 'courseEditing'
  | 'categories'
  | 'promotions'
  | 'plans'
  | 'items'
  | 'gamification'
  | 'users'
  | 'translations'
  | 'media'
  | 'analytics'
  | 'profile';

/**
 * Who may open each section — UI gating only, the API enforces the real
 * rules (docs/04 §1, docs/14 §2). SUPPORT views the catalog and plans,
 * handles users (capped grants); TEACHER authors own courses, translations
 * and media; ADMIN sees everything.
 */
export const SECTION_ROLES: Record<AdminSection, readonly UserRole[]> = {
  dashboard: ['ADMIN', 'TEACHER', 'SUPPORT'],
  courses: ['ADMIN', 'TEACHER', 'SUPPORT'],
  courseEditing: ['ADMIN', 'TEACHER'],
  categories: ['ADMIN', 'SUPPORT'],
  promotions: ['ADMIN'],
  plans: ['ADMIN', 'SUPPORT'],
  items: ['ADMIN'],
  gamification: ['ADMIN'],
  users: ['ADMIN', 'SUPPORT'],
  translations: ['ADMIN', 'TEACHER'],
  media: ['ADMIN', 'TEACHER'],
  analytics: ['ADMIN'],
  profile: ['ADMIN', 'TEACHER', 'SUPPORT'],
};

export function canAccess(
  section: AdminSection,
  role: UserRole | null | undefined,
): boolean {
  return !!role && SECTION_ROLES[section].includes(role);
}

/** Roles allowed to mutate within a section (subset of SECTION_ROLES). */
export const EDIT_ROLES = {
  catalog: ['ADMIN', 'TEACHER'],
  categories: ['ADMIN'],
  plans: ['ADMIN'],
  users: ['ADMIN', 'SUPPORT'],
} as const satisfies Record<string, readonly UserRole[]>;

/**
 * Route guard for a section. Unauthorized staff land on `/denied?section=…`
 * (inside the shell), which explains which role would be required.
 */
export function sectionGuard(section: AdminSection): CanActivateFn {
  return async (): Promise<boolean | UrlTree> => {
    const auth = inject(AuthService);
    const router = inject(Router);
    await auth.whenReady();
    if (canAccess(section, auth.role())) return true;
    return router.createUrlTree(['/denied'], { queryParams: { section } });
  };
}

export interface AdminNavEntry {
  section: AdminSection;
  /** `admin.nav.*` key. */
  labelKey: string;
  icon: IconName;
  link: string;
}

export interface AdminNavGroup {
  /** `admin.nav.group.*` key, or null for the ungrouped top block. */
  labelKey: string | null;
  items: AdminNavEntry[];
}

/** docs/04 §2 information architecture. */
export const ADMIN_NAV: readonly AdminNavGroup[] = [
  {
    labelKey: null,
    items: [
      {
        section: 'dashboard',
        labelKey: 'admin.nav.dashboard',
        icon: 'star',
        link: '/dashboard',
      },
    ],
  },
  {
    labelKey: 'admin.nav.group.catalog',
    items: [
      {
        section: 'courses',
        labelKey: 'admin.nav.courses',
        icon: 'pencil',
        link: '/courses',
      },
      {
        section: 'categories',
        labelKey: 'admin.nav.categories',
        icon: 'folder-open',
        link: '/categories',
      },
      {
        section: 'promotions',
        labelKey: 'admin.nav.promotions',
        icon: 'calendar',
        link: '/promotions',
      },
      {
        section: 'media',
        labelKey: 'admin.nav.media',
        icon: 'image',
        link: '/media',
      },
    ],
  },
  {
    labelKey: 'admin.nav.group.business',
    items: [
      {
        section: 'plans',
        labelKey: 'admin.nav.plans',
        icon: 'credit-card',
        link: '/plans',
      },
      {
        section: 'items',
        labelKey: 'admin.nav.items',
        icon: 'gift',
        link: '/items',
      },
      {
        section: 'gamification',
        labelKey: 'admin.nav.gamification',
        icon: 'trophy',
        link: '/gamification',
      },
      {
        section: 'users',
        labelKey: 'admin.nav.users',
        icon: 'user-circle',
        link: '/users',
      },
    ],
  },
  {
    labelKey: 'admin.nav.group.insights',
    items: [
      {
        section: 'translations',
        labelKey: 'admin.nav.translations',
        icon: 'translate',
        link: '/translations',
      },
      {
        section: 'analytics',
        labelKey: 'admin.nav.analytics',
        icon: 'eye',
        link: '/analytics',
      },
    ],
  },
  {
    labelKey: 'admin.nav.group.account',
    items: [
      {
        section: 'profile',
        labelKey: 'admin.nav.profile',
        icon: 'gear',
        link: '/profile',
      },
    ],
  },
];

/** Nav groups filtered to what `role` may open (empty groups dropped). */
export function navForRole(role: UserRole | null | undefined): AdminNavGroup[] {
  return ADMIN_NAV.map((g) => ({
    ...g,
    items: g.items.filter((i) => canAccess(i.section, role)),
  })).filter((g) => g.items.length > 0);
}
