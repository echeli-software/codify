/** docs/04 §5: lesson editor autosave delay after the last change. */
export const AUTOSAVE_DELAY_MS = 5_000;

export interface AutosaveHooks {
  /** True when the form is valid enough to save (no autosave otherwise). */
  canSave(): boolean;
  /** True while a save (manual or auto) is in flight. */
  isSaving(): boolean;
  /** Persist; resolves when done (failures are the caller's to report). */
  save(): Promise<void>;
}

/**
 * Debounced autosave: every `changed()` restarts a {@link AUTOSAVE_DELAY_MS}
 * timer; when it fires the hooks decide whether to save. Edits made while a
 * save is in flight are tracked by a revision counter so the page can tell
 * whether the saved snapshot is still current (`isCurrent(rev)`), and they
 * get their own autosave once the in-flight one settles.
 */
export class Autosave {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private rev = 0;

  constructor(
    private readonly hooks: AutosaveHooks,
    private readonly delayMs = AUTOSAVE_DELAY_MS,
  ) {}

  /** Current edit revision — capture it when a save starts. */
  get revision(): number {
    return this.rev;
  }

  /** True when nothing changed since `rev` was captured. */
  isCurrent(rev: number): boolean {
    return rev === this.rev;
  }

  get pending(): boolean {
    return this.timer !== null;
  }

  /** Record an edit and (re)start the debounce timer. */
  changed(): void {
    this.rev += 1;
    this.restart();
  }

  /** Re-arm without counting a new edit (e.g. after an in-flight save). */
  restart(): void {
    this.cancel();
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.fire();
    }, this.delayMs);
  }

  cancel(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private async fire(): Promise<void> {
    if (this.hooks.isSaving()) {
      // Try again after the in-flight save.
      this.restart();
      return;
    }
    if (!this.hooks.canSave()) return;
    await this.hooks.save();
  }
}

/** "HH:MM:SS" in the given locale (12/24h per locale conventions). */
export function formatClockTime(d: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(d);
}
