import { TestBed } from '@angular/core/testing';
import {
  NATIVE_IMAGE_DIR,
  NativeImageStore,
  nativeImageFileName,
} from './native-image-store.service';

const files = new Map<string, number>();
const prefs = new Map<string, string>();

const Filesystem = {
  getUri: jest.fn(async ({ path }: { path: string }) => ({
    uri: `file:///data/app/files/${path}`,
  })),
  downloadFile: jest.fn(
    async ({ url, path }: { url: string; path: string }) => {
      if (url.includes('broken')) throw new Error('404');
      files.set(path, url.length * 10);
      return { path };
    },
  ),
  stat: jest.fn(async ({ path }: { path: string }) => ({
    size: files.get(path) ?? 0,
  })),
  deleteFile: jest.fn(async ({ path }: { path: string }) => {
    files.delete(path);
  }),
  rmdir: jest.fn(async () => files.clear()),
};
const Preferences = {
  get: jest.fn(async ({ key }: { key: string }) => ({
    value: prefs.get(key) ?? null,
  })),
  set: jest.fn(async ({ key, value }: { key: string; value: string }) => {
    prefs.set(key, value);
  }),
};

jest.mock('@capacitor/filesystem', () => ({ Filesystem }));
jest.mock('@capacitor/preferences', () => ({ Preferences }));

const A = 'https://cdn.test/images/a.png';
const B = 'https://cdn.test/images/b.webp?v=2';

describe('NativeImageStore', () => {
  function setup(native = true) {
    if (native)
      (globalThis as { Capacitor?: unknown }).Capacitor = {
        isNativePlatform: () => true,
        getPlatform: () => 'ios',
        convertFileSrc: (p: string) =>
          p.replace('file://', 'capacitor://localhost/_capacitor_file_'),
      };
    TestBed.configureTestingModule({});
    return TestBed.inject(NativeImageStore);
  }

  beforeEach(() => {
    files.clear();
    prefs.clear();
    jest.clearAllMocks();
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    delete (globalThis as { Capacitor?: unknown }).Capacitor;
  });

  it('derives a stable, extension-preserving file name', () => {
    expect(nativeImageFileName(A)).toBe(nativeImageFileName(A));
    expect(nativeImageFileName(A)).not.toBe(nativeImageFileName(B));
    expect(nativeImageFileName(A)).toMatch(/^[0-9a-f]{16}\.png$/);
    expect(nativeImageFileName(B)).toMatch(/\.webp$/);
    expect(nativeImageFileName('https://x.test/img')).toMatch(/^[0-9a-f]{16}$/);
  });

  it('is a no-op on the web', async () => {
    const store = setup(false);
    expect(store.supported).toBe(false);
    const res = await store.store([A]);
    expect(res).toEqual({ cached: [], bytes: 0, failed: [A] });
    expect(Filesystem.downloadFile).not.toHaveBeenCalled();
    expect(store.resolve(A)).toBeNull();
  });

  it('downloads into Data/lesson-images, counts bytes and resolves to a WebView URL', async () => {
    const store = setup();
    expect(store.resolve(A)).toBeNull();
    const res = await store.store([A, B, A, 'https://cdn.test/broken.png']);
    expect(res.cached).toEqual([A, B]);
    expect(res.failed).toEqual(['https://cdn.test/broken.png']);
    expect(res.bytes).toBe(A.length * 10 + B.length * 10);
    expect(Filesystem.downloadFile).toHaveBeenCalledWith(
      expect.objectContaining({
        url: A,
        path: `${NATIVE_IMAGE_DIR}/${nativeImageFileName(A)}`,
        directory: 'DATA',
        recursive: true,
      }),
    );
    expect(store.resolve(A)).toBe(
      `capacitor://localhost/_capacitor_file_/data/app/files/${NATIVE_IMAGE_DIR}/${nativeImageFileName(A)}`,
    );
    // Already stored: no second download, bytes still reported.
    const again = await store.store([A]);
    expect(Filesystem.downloadFile).toHaveBeenCalledTimes(3);
    expect(again).toEqual({ cached: [A], bytes: A.length * 10, failed: [] });
  });

  it('persists the index across app launches', async () => {
    await setup().store([A]);
    TestBed.resetTestingModule();
    const next = setup();
    await next.init();
    expect(next.storedUrls()).toEqual([A]);
    expect(next.resolve(A)).toContain(nativeImageFileName(A));
  });

  it('remove() deletes files and forgets them; clear() wipes the folder', async () => {
    const store = setup();
    await store.store([A, B]);
    await store.remove([A]);
    expect(Filesystem.deleteFile).toHaveBeenCalledTimes(1);
    expect(store.resolve(A)).toBeNull();
    expect(store.resolve(B)).not.toBeNull();
    await store.clear();
    expect(Filesystem.rmdir).toHaveBeenCalledWith(
      expect.objectContaining({ path: NATIVE_IMAGE_DIR, recursive: true }),
    );
    expect(store.storedUrls()).toEqual([]);
  });
});
