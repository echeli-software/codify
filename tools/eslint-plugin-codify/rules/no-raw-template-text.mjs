/**
 * codify/no-raw-template-text
 *
 * docs/11 §11: "no string literals in templates — must come through
 * `{{ key | translate }}`". Runs on Angular templates parsed by
 * `@angular-eslint/template-parser` (external `.html` files and, via the
 * angular-eslint inline-template processor, `template:` strings in `.ts`).
 *
 * Flags:
 *   - text nodes containing letters (`<p>Save</p>`, `{{ n }} min`)
 *   - user-visible static attributes (`title`, `placeholder`, `aria-label`,
 *     `ariaLabel`, `alt`, `label`) containing letters
 *   - string literals that would be rendered from interpolations or those
 *     attribute bindings (`{{ 'Hi' }}`, `[title]="ok ? 'Yes' : 'No'"`)
 *     unless they flow through the `translate` / `tContent` pipe
 *
 * Allowed: numbers, punctuation, symbols, emoji/icons, whitespace, text in
 * `<code>/<pre>/<kbd>/<samp>/<script>/<style>`, anything under an element
 * carrying a `data-i18n-ignore` attribute, strings
 * matching `allowedText`, and the usual
 * `<!-- eslint-disable-next-line codify/no-raw-template-text -->`.
 */

const DEFAULT_ATTRIBUTES = [
  'title',
  'placeholder',
  'aria-label',
  'ariaLabel',
  'alt',
  'label',
];
const DEFAULT_IGNORE_TAGS = ['code', 'pre', 'kbd', 'samp', 'script', 'style'];
const DEFAULT_PIPES = ['translate', 'tContent'];
const IGNORE_ATTRS = ['data-i18n-ignore'];
const LETTER = /\p{L}/u;

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Disallow user-visible raw text in Angular templates; use the translate pipe (docs/11 §11).',
    },
    schema: [
      {
        type: 'object',
        properties: {
          attributes: { type: 'array', items: { type: 'string' } },
          ignoreTags: { type: 'array', items: { type: 'string' } },
          translatePipes: { type: 'array', items: { type: 'string' } },
          allowedText: { type: 'array', items: { type: 'string' } },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      rawText:
        'Raw template text "{{text}}" — move it to a translation key and render it with the translate pipe.',
      rawAttribute:
        'Raw "{{name}}" text "{{text}}" — bind it through the translate pipe instead.',
      rawLiteral:
        'String literal "{{text}}" is rendered untranslated — pipe it through `translate`.',
    },
  },

  create(context) {
    const opts = context.options[0] ?? {};
    const attributes = new Set(opts.attributes ?? DEFAULT_ATTRIBUTES);
    const ignoreTags = new Set(opts.ignoreTags ?? DEFAULT_IGNORE_TAGS);
    const pipes = new Set(opts.translatePipes ?? DEFAULT_PIPES);
    const allowed = (opts.allowedText ?? []).map((s) => new RegExp(s, 'u'));
    const services = context.sourceCode.parserServices;
    if (
      !services ||
      typeof services.convertNodeSourceSpanToLoc !== 'function'
    ) {
      // Not an Angular template (e.g. linting plain .ts) — nothing to do.
      return {};
    }
    const loc = (span) => services.convertNodeSourceSpanToLoc(span);

    const isUserText = (text) => {
      const t = String(text ?? '').trim();
      if (!t || !LETTER.test(t)) return false;
      return !allowed.some((re) => re.test(t));
    };

    const short = (text) => {
      const t = String(text).trim().replace(/\s+/g, ' ');
      return t.length > 40 ? `${t.slice(0, 37)}…` : t;
    };

    /** True when an ancestor element is ignored (code/pre/i18n-ignore). */
    const inIgnoredSubtree = (node) => {
      for (let p = node.parent; p; p = p.parent) {
        if (typeof p.name === 'string' && ignoreTags.has(p.name)) return true;
        const attrs = p.attributes;
        if (
          Array.isArray(attrs) &&
          attrs.some((a) => IGNORE_ATTRS.includes(a.name))
        ) {
          return true;
        }
      }
      return false;
    };

    /** String literals that end up rendered (not call args / comparisons). */
    const renderedLiterals = (ast) => {
      if (!ast) return [];
      const kind = ast.constructor?.name ?? '';
      if (ast.ast) return renderedLiterals(ast.ast); // ASTWithSource
      if (typeof ast.value === 'string' && /LiteralPrimitive/.test(kind))
        return [ast];
      if (/BindingPipe/.test(kind)) {
        return pipes.has(ast.name) ? [] : renderedLiterals(ast.exp);
      }
      if (/Conditional/.test(kind)) {
        return [
          ...renderedLiterals(ast.trueExp),
          ...renderedLiterals(ast.falseExp),
        ];
      }
      if (/Binary/.test(kind) && ['+', '??', '||'].includes(ast.operation)) {
        return [...renderedLiterals(ast.left), ...renderedLiterals(ast.right)];
      }
      if (/Parenthesized/.test(kind)) return renderedLiterals(ast.expression);
      if (/Interpolation/.test(kind)) {
        return (ast.expressions ?? []).flatMap((e) => renderedLiterals(e));
      }
      if (/TemplateLiteral/.test(kind)) {
        return [
          ...(ast.elements ?? [])
            .filter((e) => typeof e.text === 'string')
            .map((e) => ({ value: e.text })),
          ...(ast.expressions ?? []).flatMap((e) => renderedLiterals(e)),
        ];
      }
      return [];
    };

    return {
      Text(node) {
        if (!isUserText(node.value) || inIgnoredSubtree(node)) return;
        context.report({
          loc: loc(node.sourceSpan),
          messageId: 'rawText',
          data: { text: short(node.value) },
        });
      },

      BoundText(node) {
        if (inIgnoredSubtree(node)) return;
        const interp = node.value?.ast ?? node.value;
        const strings = interp?.strings ?? [];
        const raw = strings.filter((s) => isUserText(s));
        if (raw.length > 0) {
          context.report({
            loc: loc(node.sourceSpan),
            messageId: 'rawText',
            data: { text: short(raw.join(' … ')) },
          });
          return;
        }
        for (const lit of renderedLiterals(interp)) {
          if (!isUserText(lit.value)) continue;
          context.report({
            loc: loc(node.sourceSpan),
            messageId: 'rawLiteral',
            data: { text: short(lit.value) },
          });
          return;
        }
      },

      TextAttribute(node) {
        if (!attributes.has(node.name) || !isUserText(node.value)) return;
        if (inIgnoredSubtree(node) || IGNORE_ATTRS.includes(node.name)) return;
        context.report({
          loc: loc(node.keySpan ?? node.sourceSpan),
          messageId: 'rawAttribute',
          data: { name: node.name, text: short(node.value) },
        });
      },

      BoundAttribute(node) {
        // `[title]`, `[attr.aria-label]`, `[ariaLabel]`, `[label]`…
        if (!attributes.has(node.name) || inIgnoredSubtree(node)) return;
        for (const lit of renderedLiterals(node.value)) {
          if (!isUserText(lit.value)) continue;
          context.report({
            loc: loc(node.keySpan ?? node.sourceSpan),
            messageId: 'rawLiteral',
            data: { text: short(lit.value) },
          });
          return;
        }
      },
    };
  },
};
