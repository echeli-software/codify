/**
 * ICU-lite message formatting for chrome strings (docs/11 §2 "ICU
 * MessageFormat for plurals/genders").
 *
 * Supported syntax — enough for every string in `libs/i18n/src/strings`:
 *   - `{name}`                      → param substitution
 *   - `{{ name }}`                  → legacy ngx-translate placeholder
 *   - `{n, plural, =0 {…} one {…} other {…}}` with `#` → formatted `n`
 *   - `{g, select, a {…} other {…}}`
 *
 * Unknown params are left verbatim (`{name}`) so a missing variable is
 * visible in the UI instead of silently disappearing.
 */

export type IcuParams = Readonly<Record<string, unknown>> | undefined;

type Node =
  | { t: 'text'; v: string }
  | { t: 'hash' }
  | { t: 'arg'; name: string; raw: string }
  | {
      t: 'plural' | 'select';
      name: string;
      offset: number;
      cases: Record<string, Node[]>;
      raw: string;
    };

class Parser {
  private i = 0;
  constructor(private readonly src: string) {}

  parse(inPlural = false, stopAtBrace = false): Node[] {
    const out: Node[] = [];
    let text = '';
    const flush = () => {
      if (text) out.push({ t: 'text', v: text });
      text = '';
    };
    while (this.i < this.src.length) {
      const ch = this.src[this.i];
      if (ch === '}' && stopAtBrace) break;
      if (ch === '#' && inPlural) {
        flush();
        out.push({ t: 'hash' });
        this.i++;
        continue;
      }
      if (ch === "'" && this.src[this.i + 1] === "'") {
        text += "'";
        this.i += 2;
        continue;
      }
      if (ch === '{') {
        const start = this.i;
        const node = this.parseArgument();
        if (node) {
          flush();
          out.push(node);
        } else {
          // Not a valid argument — keep the literal text.
          text += this.src.slice(start, this.i);
        }
        continue;
      }
      text += ch;
      this.i++;
    }
    flush();
    return out;
  }

  private parseArgument(): Node | null {
    const start = this.i;
    // Legacy `{{ name }}`.
    if (this.src[this.i + 1] === '{') {
      const end = this.src.indexOf('}}', this.i + 2);
      if (end === -1) {
        this.i = this.src.length;
        return null;
      }
      const name = this.src.slice(this.i + 2, end).trim();
      this.i = end + 2;
      return /^[\w.]+$/.test(name)
        ? { t: 'arg', name, raw: this.src.slice(start, this.i) }
        : null;
    }
    this.i++; // skip '{'
    const header = this.readUntil([',', '}']);
    const name = header.trim();
    if (this.src[this.i] === '}') {
      this.i++;
      return /^[\w.]+$/.test(name)
        ? { t: 'arg', name, raw: this.src.slice(start, this.i) }
        : null;
    }
    if (this.src[this.i] !== ',') return null;
    this.i++; // skip ','
    const typeRaw = this.readUntil([',', '}']).trim();
    if (typeRaw !== 'plural' && typeRaw !== 'select') {
      // Unsupported formatter (e.g. `number`) → treat as a plain arg.
      this.skipBalanced();
      return { t: 'arg', name, raw: this.src.slice(start, this.i) };
    }
    if (this.src[this.i] !== ',') return null;
    this.i++;
    const cases: Record<string, Node[]> = {};
    let offset = 0;
    for (;;) {
      this.skipWs();
      if (this.i >= this.src.length) return null;
      if (this.src[this.i] === '}') {
        this.i++;
        break;
      }
      const key = this.readUntil(['{', ' ', '\n', '\t']).trim();
      this.skipWs();
      if (key.startsWith('offset:')) {
        offset = Number(key.slice('offset:'.length)) || 0;
        continue;
      }
      if (this.src[this.i] !== '{') return null;
      this.i++;
      cases[key] = this.parse(typeRaw === 'plural', true);
      if (this.src[this.i] !== '}') return null;
      this.i++;
    }
    return {
      t: typeRaw,
      name,
      offset,
      cases,
      raw: this.src.slice(start, this.i),
    };
  }

  private readUntil(stops: string[]): string {
    let s = '';
    while (this.i < this.src.length && !stops.includes(this.src[this.i])) {
      s += this.src[this.i];
      this.i++;
    }
    return s;
  }

  private skipWs(): void {
    while (this.i < this.src.length && /\s/.test(this.src[this.i])) this.i++;
  }

  private skipBalanced(): void {
    let depth = 1;
    while (this.i < this.src.length && depth > 0) {
      if (this.src[this.i] === '{') depth++;
      if (this.src[this.i] === '}') depth--;
      this.i++;
    }
  }
}

function lookup(params: IcuParams, name: string): unknown {
  if (!params) return undefined;
  if (name in params) return params[name];
  // Dotted access: `{user.name}`.
  let cur: unknown = params;
  for (const part of name.split('.')) {
    if (cur && typeof cur === 'object' && part in (cur as object)) {
      cur = (cur as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return cur;
}

function stringify(v: unknown, locale: string): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v === 'number')
    return new Intl.NumberFormat(locale).format(v as number);
  if (typeof v === 'string') return v;
  if (typeof v === 'boolean' || typeof v === 'bigint') return String(v);
  if (v instanceof Date) return new Intl.DateTimeFormat(locale).format(v);
  return JSON.stringify(v);
}

function render(
  nodes: Node[],
  params: IcuParams,
  locale: string,
  hash: string | null,
): string {
  let out = '';
  for (const n of nodes) {
    switch (n.t) {
      case 'text':
        out += n.v;
        break;
      case 'hash':
        out += hash ?? '#';
        break;
      case 'arg':
        out += stringify(lookup(params, n.name), locale) ?? n.raw;
        break;
      case 'plural': {
        const raw = lookup(params, n.name);
        const num = typeof raw === 'number' ? raw : Number(raw);
        if (raw === undefined || Number.isNaN(num)) {
          out += n.raw;
          break;
        }
        const exact = n.cases[`=${num}`];
        const rel = num - n.offset;
        const category = new Intl.PluralRules(locale).select(rel);
        const branch = exact ?? n.cases[category] ?? n.cases['other'] ?? [];
        out += render(
          branch,
          params,
          locale,
          new Intl.NumberFormat(locale).format(rel),
        );
        break;
      }
      case 'select': {
        const raw = lookup(params, n.name);
        const key = raw === undefined ? 'other' : String(raw);
        const branch = n.cases[key] ?? n.cases['other'] ?? [];
        out += render(branch, params, locale, hash);
        break;
      }
    }
  }
  return out;
}

/** Fast check — strings without braces skip compilation entirely. */
export function needsIcu(message: string): boolean {
  return message.includes('{') || message.includes("''");
}

/** Compile once, format many times. */
export function compileIcu(
  message: string,
  locale: string,
): (params?: IcuParams) => string {
  const ast = new Parser(message).parse();
  return (params?: IcuParams) => render(ast, params, locale, null);
}

/** One-shot convenience. */
export function formatIcu(
  message: string,
  params: IcuParams,
  locale: string,
): string {
  return compileIcu(message, locale)(params);
}
