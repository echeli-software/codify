import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import {
  NotificationsClient,
  type InboxNotification,
} from '@codify/api-client';
import { AuthService } from '@codify/auth';
import { NetworkStatusService } from '../../offline/network-status.service';
import { NotificationsStore } from './notifications.store';

const item = (id: string, readAt: string | null = null): InboxNotification => ({
  id,
  kind: 'LEAGUE_RESULT',
  title: id,
  body: 'b',
  deepLink: '/league',
  action: { type: 'open_league' },
  createdAt: `2026-11-07T10:00:0${id.length}Z`,
  readAt,
});

describe('NotificationsStore', () => {
  let online: ReturnType<typeof signal<boolean>>;
  let client: Record<string, jest.Mock>;

  function setup(user: { id: string } | null = { id: 'u1' }) {
    online = signal(true);
    client = {
      list: jest.fn(async () => ({
        items: [item('a'), item('b', 'x')],
        nextCursor: 'b',
      })),
      unreadCount: jest.fn(async () => ({ count: 1 })),
      markRead: jest.fn(async () => ({})),
      markAllRead: jest.fn(async () => ({ updated: 1 })),
      fewer: jest.fn(async () => ({ kind: 'LEAGUE_RESULT', fewerLevel: 1 })),
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: NotificationsClient, useValue: client },
        { provide: NetworkStatusService, useValue: { online } },
        { provide: AuthService, useValue: { user: signal(user) } },
      ],
    });
    const store = TestBed.inject(NotificationsStore);
    TestBed.tick();
    return store;
  }

  beforeEach(() => localStorage.clear());
  afterEach(() => TestBed.resetTestingModule());

  it('loads the first page + unread count and caches it for offline', async () => {
    const store = setup();
    await store.load();
    expect(store.items().map((i) => i.id)).toEqual(['a', 'b']);
    expect(store.unread()).toBe(1);
    expect(store.hasMore()).toBe(true);
    expect(store.fromCache()).toBe(false);
    expect(
      JSON.parse(localStorage.getItem('codify.inbox.u1') ?? '{}').items,
    ).toHaveLength(2);
  });

  it('offline: shows the device copy, or nothing loaded when there is none', async () => {
    const first = setup();
    await first.load();
    TestBed.resetTestingModule();

    const store = setup();
    online.set(false);
    await store.load();
    expect(store.fromCache()).toBe(true);
    expect(store.items()).toHaveLength(2);
    expect(store.hasMore()).toBe(false);

    TestBed.resetTestingModule();
    localStorage.clear();
    const empty = setup();
    online.set(false);
    await empty.load();
    expect(empty.loaded()).toBe(false);
    expect(empty.error()).toBe(false);
  });

  it('falls back to the cache when the server fails, else reports an error', async () => {
    const store = setup();
    client['list'].mockRejectedValueOnce(new Error('500'));
    await store.load();
    expect(store.error()).toBe(true);
  });

  it('marks read optimistically and reverts on failure', async () => {
    const store = setup();
    await store.load();
    await store.markRead(store.items()[0]);
    expect(store.items()[0].readAt).not.toBeNull();
    expect(store.unread()).toBe(0);

    client['list'].mockResolvedValueOnce({
      items: [item('a')],
      nextCursor: null,
    });
    client['unreadCount'].mockResolvedValueOnce({ count: 1 });
    await store.load();
    client['markRead'].mockRejectedValueOnce(new Error('boom'));
    await expect(store.markRead(store.items()[0])).rejects.toThrow('boom');
    expect(store.items()[0].readAt).toBeNull();
    expect(store.unread()).toBe(1);
  });

  it('mark all read clears unread; loadMore appends the next page', async () => {
    const store = setup();
    await store.load();
    client['list'].mockResolvedValueOnce({
      items: [item('zz')],
      nextCursor: null,
    });
    await store.loadMore();
    expect(client['list']).toHaveBeenLastCalledWith({ cursor: 'b', limit: 20 });
    expect(store.items().map((i) => i.id)).toContain('zz');
    expect(store.hasMore()).toBe(false);
    await store.markAllRead();
    expect(store.unread()).toBe(0);
    expect(store.items().every((i) => i.readAt)).toBe(true);
  });
});
