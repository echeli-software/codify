// Unit tests for the local `codify/*` ESLint rules (ESLint RuleTester on
// node:test). Run: `node --test tools/eslint-plugin-codify/` or `nx test eslint-plugin-codify`.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ESLint, RuleTester } from 'eslint';
import angular from 'angular-eslint';
import tseslint from 'typescript-eslint';
import plugin from './index.mjs';

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const html = new RuleTester({
  languageOptions: { parser: angular.templateParser },
});
const ts = new RuleTester({
  languageOptions: { parser: tseslint.parser },
});

describe('codify/no-raw-template-text', () => {
  html.run('no-raw-template-text', plugin.rules['no-raw-template-text'], {
    valid: [
      { code: `<p>{{ 'common.save' | translate }}</p>`, filename: 'a.html' },
      {
        code: `<span>{{ count }}</span><span>42 / 100 · — %</span>`,
        filename: 'a.html',
      },
      {
        code: `<button [attr.aria-label]="'common.close' | translate">×</button>`,
        filename: 'a.html',
      },
      {
        code: `<input [placeholder]="'common.search' | translate" />`,
        filename: 'a.html',
      },
      { code: `<span>🔥 ✓ → …</span>`, filename: 'a.html' },
      {
        code: `<code>const x = 1;</code><pre>npm i</pre><kbd>Ctrl</kbd>`,
        filename: 'a.html',
      },
      {
        code: `<div data-i18n-ignore><p>Lorem ipsum</p></div>`,
        filename: 'a.html',
      },
      { code: `<img alt="" src="x.png" />`, filename: 'a.html' },
      {
        code: `<cdf-icon name="check-circle" class="foo" />`,
        filename: 'a.html',
      },
      {
        code: `<p>{{ status() === 'done' ? ('a.done' | translate) : ('a.todo' | translate) }}</p>`,
        filename: 'a.html',
      },
      { code: `<p>{{ format(value, 'pt-BR') }}</p>`, filename: 'a.html' },
      {
        code: `<p>{{ courseId | tContent: 'COURSE' : 'title' }}</p>`,
        filename: 'a.html',
      },
      {
        code: `<!-- eslint-disable-next-line rule-to-test/no-raw-template-text -->\n<p>Codify</p>`,
        filename: 'a.html',
      },
      {
        code: `<span>XP</span>`,
        filename: 'a.html',
        options: [{ allowedText: ['^XP$'] }],
      },
    ],
    invalid: [
      {
        code: `<p>Save</p>`,
        filename: 'a.html',
        errors: [{ messageId: 'rawText' }],
      },
      {
        code: `<p>{{ n }} min</p>`,
        filename: 'a.html',
        errors: [{ messageId: 'rawText' }],
      },
      {
        code: `<p>{{ 'Hello' }}</p>`,
        filename: 'a.html',
        errors: [{ messageId: 'rawLiteral' }],
      },
      {
        code: `<p>{{ ok ? 'Yes' : 'No' }}</p>`,
        filename: 'a.html',
        errors: [{ messageId: 'rawLiteral' }],
      },
      {
        code: `<p>{{ 'Hi' | uppercase }}</p>`,
        filename: 'a.html',
        errors: [{ messageId: 'rawLiteral' }],
      },
      {
        code: `<button title="Close">×</button>`,
        filename: 'a.html',
        errors: [{ messageId: 'rawAttribute' }],
      },
      {
        code: `<input placeholder="Search courses" />`,
        filename: 'a.html',
        errors: [{ messageId: 'rawAttribute' }],
      },
      {
        code: `<img alt="Course cover" src="x" />`,
        filename: 'a.html',
        errors: [{ messageId: 'rawAttribute' }],
      },
      {
        code: `<div aria-label="Main menu"></div>`,
        filename: 'a.html',
        errors: [{ messageId: 'rawAttribute' }],
      },
      {
        code: `<cdf-icon-button ariaLabel="Previous page" />`,
        filename: 'a.html',
        errors: [{ messageId: 'rawAttribute' }],
      },
      {
        code: `<button [attr.aria-label]="'Close dialog'">×</button>`,
        filename: 'a.html',
        errors: [{ messageId: 'rawLiteral' }],
      },
      {
        code: `@if (x) { <span>Free preview</span> } @else { <span>{{ 'a' | translate }}</span> }`,
        filename: 'a.html',
        errors: [{ messageId: 'rawText' }],
      },
    ],
  });

  it('also lints inline component templates through the angular-eslint processor', async () => {
    const eslint = new ESLint({
      overrideConfigFile: true,
      overrideConfig: [
        {
          files: ['**/*.ts'],
          languageOptions: { parser: tseslint.parser },
          processor: angular.processInlineTemplates,
        },
        {
          files: ['**/*.html'],
          languageOptions: { parser: angular.templateParser },
          plugins: { codify: plugin },
          rules: { 'codify/no-raw-template-text': 'error' },
        },
      ],
    });
    const [result] = await eslint.lintText(
      [
        "import { Component } from '@angular/core';",
        "@Component({ selector: 'cdf-x', template: `<h1>Welcome back</h1><p>{{ 'a.b' | translate }}</p>` })",
        'export class X {}',
      ].join('\n'),
      { filePath: 'x.component.ts' },
    );
    assert.equal(result.messages.length, 1);
    assert.equal(result.messages[0].ruleId, 'codify/no-raw-template-text');
    assert.equal(result.messages[0].line, 2);
  });
});

describe('codify/rewards-through-orchestrator', () => {
  ts.run(
    'rewards-through-orchestrator',
    plugin.rules['rewards-through-orchestrator'],
    {
      valid: [
        `class A { private xp = inject(XpService); v = () => this.xp.displayed() + this.xp.actual() + this.xp.level(); }`,
        `const coins = inject(CoinService); coins.displayed();`,
        `const streak = inject(StreakService); streak.currentDays();`,
        `const orchestrator = inject(RewardOrchestrator); orchestrator.reconcile({ totalXp: 1 }); orchestrator.grant(p);`,
        `const other = inject(OtherService); other.set(1); other.snap();`,
        `class B { constructor(private readonly xp: XpService) {} read() { return this.xp.displayed(); } }`,
      ],
      invalid: [
        {
          code: `class A { private readonly xp = inject(XpService); go() { this.xp.setActual(10); } }`,
          errors: [
            {
              messageId: 'mutation',
              data: { service: 'XpService', method: 'setActual' },
            },
          ],
        },
        {
          code: `class A { go() { this.coins.tweenTo(5); } protected readonly coins = inject(CoinService); }`,
          errors: [{ messageId: 'mutation' }],
        },
        {
          code: `const s = inject(StreakService); s.set({ currentDays: 3 });`,
          errors: [
            {
              messageId: 'mutation',
              data: { service: 'StreakService', method: 'set' },
            },
          ],
        },
        {
          code: `inject(XpService).snap(100);`,
          errors: [{ messageId: 'mutation' }],
        },
        {
          code: `TestBed.inject(CoinService).setActual(1);`,
          errors: [{ messageId: 'mutation' }],
        },
        {
          code: `class B { constructor(private readonly xp: XpService) {} go() { this.xp.tweenTo(5); } }`,
          errors: [{ messageId: 'mutation' }],
        },
        {
          code: `let c: CoinService; c = inject(CoinService); c.snap();`,
          errors: [{ messageId: 'mutation' }],
        },
      ],
    },
  );
});
