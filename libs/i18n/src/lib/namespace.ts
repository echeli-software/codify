import type { Locale } from './locales.js';

/** One string file (`libs/i18n/src/strings/<locale>/<file>.json`). */
export interface TranslationNamespace {
  /** Top-level key the file defines (`common`, `ui`, `admin`, ...). */
  readonly name: string;
  /** Lazily imports the file for one locale. */
  load(locale: Locale): Promise<object>;
}
