import { TestBed } from '@angular/core/testing';
import { firstValueFrom, toArray } from 'rxjs';
import { AssetsClient, type AssetView } from '@codify/api-client';
import {
  AssetsAssetLibrary,
  AssetsFileUploader,
  AssetsLessonUploader,
  inferAssetKind,
  toAssetSummary,
} from './uploads';

const asset = (over: Partial<AssetView> = {}): AssetView => ({
  id: 'a1',
  kind: 'IMAGE',
  url: 'http://localhost:3201/api/assets/dev/a1',
  mimeType: 'image/png',
  sizeBytes: 100,
  confirmed: true,
  uploadedById: 'u1',
  createdAt: '2026-10-01T00:00:00.000Z',
  ...over,
});

function setup() {
  const assets = {
    upload: jest.fn(
      async (
        _f: File,
        kind: string,
        opts: { onProgress?: (f: number) => void },
      ) => {
        opts.onProgress?.(0.5);
        opts.onProgress?.(1);
        return asset({ kind: kind as AssetView['kind'] });
      },
    ),
    list: jest.fn(async () => ({ items: [asset()], nextCursor: 'c2' })),
  };
  TestBed.configureTestingModule({
    providers: [{ provide: AssetsClient, useValue: assets }],
  });
  return assets;
}

const file = (type = 'image/png') =>
  new File(['x'.repeat(100)], 'a.png', { type });

describe('upload adapters', () => {
  it('LESSON_ASSET_UPLOADER uploads IMAGE assets and reports progress', async () => {
    const assets = setup();
    const progress: number[] = [];
    const res = await TestBed.inject(AssetsLessonUploader).upload(file(), {
      onProgress: (f) => progress.push(f),
    });
    expect(assets.upload).toHaveBeenCalledWith(
      expect.any(File),
      'IMAGE',
      expect.anything(),
    );
    expect(res).toEqual({ url: asset().url, assetId: 'a1' });
    expect(progress).toEqual([0.5, 1]);
  });

  it('LESSON_ASSET_UPLOADER honours an aborted signal', async () => {
    setup();
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(
      TestBed.inject(AssetsLessonUploader).upload(file(), {
        signal: ctrl.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('FILE_UPLOADER emits progress then done with an AssetSummary', async () => {
    setup();
    const events = await firstValueFrom(
      TestBed.inject(AssetsFileUploader).upload(file()).pipe(toArray()),
    );
    expect(events[0]).toEqual({ type: 'progress', loaded: 50, total: 100 });
    expect(events.at(-1)).toEqual({
      type: 'done',
      result: toAssetSummary(asset()),
    });
  });

  it('ASSET_LIBRARY lists by kind/cursor and uploads with the requested kind', async () => {
    const assets = setup();
    const lib = TestBed.inject(AssetsAssetLibrary);
    const page = await lib.list('SPRITE', 'c1');
    expect(assets.list).toHaveBeenCalledWith({
      kind: 'SPRITE',
      cursor: 'c1',
      limit: 24,
    });
    expect(page.nextCursor).toBe('c2');
    const done = (
      await firstValueFrom(lib.upload(file(), 'SPRITE').pipe(toArray()))
    ).at(-1);
    expect(done).toMatchObject({ type: 'done', result: { kind: 'SPRITE' } });
  });

  it('propagates upload failures as stream errors', async () => {
    const assets = setup();
    assets.upload.mockRejectedValueOnce(new Error('ASSET_TOO_LARGE'));
    await expect(
      firstValueFrom(TestBed.inject(AssetsFileUploader).upload(file())),
    ).rejects.toThrow('ASSET_TOO_LARGE');
  });

  it('infers IMAGE for images and OTHER otherwise', () => {
    expect(inferAssetKind({ type: 'image/webp' })).toBe('IMAGE');
    expect(inferAssetKind({ type: 'application/pdf' })).toBe('OTHER');
  });
});
