/**
 * Runtime detection without importing `@capacitor/core` eagerly: inside the
 * native shell the Capacitor bridge installs `window.Capacitor` before the
 * web bundle runs, so reading the global keeps the web bundle lean (native
 * plugins are then loaded with plain dynamic `import()` on demand).
 */
export type RuntimePlatform = 'ios' | 'android' | 'web';

interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
}

function capacitor(): CapacitorGlobal | undefined {
  return (globalThis as { Capacitor?: CapacitorGlobal }).Capacitor;
}

/** True only inside the iOS/Android Capacitor shell. */
export function isNativeRuntime(): boolean {
  try {
    const cap = capacitor();
    return typeof cap?.isNativePlatform === 'function'
      ? cap.isNativePlatform()
      : false;
  } catch {
    return false;
  }
}

export function runtimePlatform(): RuntimePlatform {
  try {
    const p = capacitor()?.getPlatform?.() ?? 'web';
    return p === 'ios' || p === 'android' ? p : 'web';
  } catch {
    return 'web';
  }
}
