import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import {
  BillingClient,
  GamificationClient,
  ItemsClient,
  MeClient,
} from '@codify/api-client';
import { AuthService } from '@codify/auth';
import { AssetCacheService } from './asset-cache.service';
import { DownloadService } from './download.service';
import { IdentityCacheService } from './identity-cache.service';
import { NativeSpriteStore } from './native-image-store.service';
import { NetworkStatusService } from './network-status.service';

const HAT = 'https://cdn.test/sprites/hat.png';
const PET = 'https://cdn.test/sprites/pet.webp';
const DEV = '/api/assets/dev/local.png';

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('IdentityCacheService — native sprites', () => {
  let sprites: {
    supported: boolean;
    store: jest.Mock;
    retainOnly: jest.Mock;
    clear: jest.Mock;
  };
  let inventory: jest.Mock;

  function setup(native: boolean) {
    sprites = {
      supported: native,
      store: jest.fn().mockResolvedValue({ cached: [], bytes: 0, failed: [] }),
      retainOnly: jest.fn().mockResolvedValue(undefined),
      clear: jest.fn().mockResolvedValue(undefined),
    };
    inventory = jest.fn().mockResolvedValue([
      {
        equipped: true,
        item: {
          id: 'i1',
          slug: 'hat',
          name: 'Hat',
          slot: 'HAT',
          rarity: 'COMMON',
          spriteAssetId: 'a1',
          spriteUrl: HAT,
        },
      },
      {
        equipped: false,
        item: {
          id: 'i2',
          slug: 'pet',
          name: 'Pet',
          slot: 'PET',
          rarity: 'RARE',
          spriteAssetId: 'a2',
          spriteUrl: PET,
        },
      },
      {
        equipped: false,
        item: {
          id: 'i3',
          slug: 'dev',
          name: 'Dev',
          slot: 'TOP',
          rarity: 'COMMON',
          spriteAssetId: 'a3',
          spriteUrl: DEV,
        },
      },
    ]);
    TestBed.configureTestingModule({
      providers: [
        {
          provide: MeClient,
          useValue: {
            me: jest.fn().mockResolvedValue({
              id: 'u1',
              email: 'a@b.test',
              displayName: 'A',
              locale: 'pt-BR',
              role: 'STUDENT',
              totalXp: 0,
              coins: 0,
            }),
          },
        },
        {
          provide: GamificationClient,
          useValue: {
            summary: jest.fn().mockRejectedValue(new Error('x')),
            badges: jest.fn().mockResolvedValue([]),
          },
        },
        {
          provide: ItemsClient,
          useValue: {
            avatar: jest.fn().mockResolvedValue({
              config: {},
              equipped: {
                HAT: { itemId: 'i1', spriteAssetId: 'a1', spriteUrl: HAT },
                SHOES: { itemId: 'i9', spriteAssetId: 'emoji:👟' },
              },
            }),
            inventory,
          },
        },
        {
          provide: BillingClient,
          useValue: {
            mySubscription: jest.fn().mockRejectedValue(new Error()),
          },
        },
        {
          provide: AuthService,
          useValue: { user: signal({ id: 'u1', avatarUrl: null }) },
        },
        { provide: NetworkStatusService, useValue: { online: signal(true) } },
        {
          provide: AssetCacheService,
          useValue: {
            assetUrl: (r: string | null) => r,
            cacheUrls: jest.fn().mockResolvedValue(undefined),
            clear: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: DownloadService,
          useValue: {
            prefetchAssets: jest.fn().mockResolvedValue(undefined),
            clearCachedAssets: jest.fn().mockResolvedValue(undefined),
          },
        },
        { provide: NativeSpriteStore, useValue: sprites },
      ],
    });
    return TestBed.inject(IdentityCacheService);
  }

  afterEach(() => TestBed.resetTestingModule());

  it('stores equipped + owned uploaded sprites natively and prunes stale ones', async () => {
    const svc = setup(true);
    await svc.prime();
    await flush();
    expect(sprites.store).toHaveBeenCalledWith([HAT, PET]);
    expect(sprites.retainOnly).toHaveBeenCalledWith([HAT, PET]);
  });

  it('does not prune when the inventory failed to load', async () => {
    const svc = setup(true);
    inventory.mockRejectedValueOnce(new Error('offline'));
    await svc.prime();
    await flush();
    expect(sprites.store).toHaveBeenCalledWith([HAT]);
    expect(sprites.retainOnly).not.toHaveBeenCalled();
  });

  it('leaves the web path alone, and clears the native copy on sign-out', async () => {
    const svc = setup(false);
    await svc.prime();
    await flush();
    expect(sprites.store).not.toHaveBeenCalled();
    await svc.clear();
    expect(sprites.clear).toHaveBeenCalled();
  });
});
