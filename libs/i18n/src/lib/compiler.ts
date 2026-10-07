/**
 * ngx-translate compiler that turns every chrome string containing ICU
 * syntax into an interpolation function (see ./icu.ts). Plain strings are
 * passed through untouched so `instant()` stays allocation-free for them.
 */

import { Injectable } from '@angular/core';
import {
  TranslateCompiler,
  type InterpolatableTranslation,
  type InterpolatableTranslationObject,
  type InterpolateFunction,
  type TranslationObject,
} from '@ngx-translate/core';
import { compileIcu, needsIcu } from './icu.js';

@Injectable()
export class CodifyTranslateCompiler extends TranslateCompiler {
  compile(value: string, lang: string): string | InterpolateFunction {
    if (!needsIcu(value)) return value;
    const fn = compileIcu(value, lang);
    return (params?: Record<string, unknown>) => fn(params);
  }

  compileTranslations(
    translations: TranslationObject,
    lang: string,
  ): InterpolatableTranslationObject {
    return this.walk(translations, lang) as InterpolatableTranslationObject;
  }

  private walk(node: unknown, lang: string): InterpolatableTranslation {
    if (typeof node === 'string') return this.compile(node, lang);
    if (Array.isArray(node)) return node.map((n) => this.walk(n, lang));
    if (node && typeof node === 'object') {
      const out: InterpolatableTranslationObject = {};
      for (const [k, v] of Object.entries(node)) out[k] = this.walk(v, lang);
      return out;
    }
    return node as InterpolatableTranslation;
  }
}
