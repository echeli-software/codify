import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { I18nService, provideI18n } from '@codify/i18n';
import {
  kitchenSinkLessonDoc,
  lessonDocSchema,
  type EmbedNode,
  type ImageNode,
  type LessonDoc,
  type QuizNode,
} from '@codify/lesson-schema';
import { LessonBlockEditor } from './lesson-block-editor.js';
// Brings the lesson command augmentations (moveTopBlock, …) into scope.
import './tiptap/lesson-nodes.js';
import {
  LESSON_ASSET_UPLOADER,
  type LessonAssetUploader,
} from './lesson-asset-uploader.js';
import { ImagePanel } from './editor-panels.js';

// ProseMirror needs a little layout API that jsdom lacks.
beforeAll(() => {
  const rect = {
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    bottom: 0,
    right: 0,
    width: 0,
    height: 0,
    toJSON: () => ({}),
  };
  const rects = Object.assign([rect], {
    item: () => rect,
  }) as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => rect as DOMRect;
  Range.prototype.getClientRects = () => rects;
  Element.prototype.getClientRects = () => rects;
  if (!document.elementFromPoint) document.elementFromPoint = () => null;
  Element.prototype.scrollIntoView = () => undefined;
});

async function mount(
  doc: LessonDoc | null = null,
  uploader?: LessonAssetUploader,
  locale: 'en-US' | 'pt-BR' = 'en-US',
): Promise<{
  fixture: ComponentFixture<LessonBlockEditor>;
  cmp: LessonBlockEditor;
  el: HTMLElement;
  changes: LessonDoc[];
}> {
  await TestBed.configureTestingModule({
    imports: [LessonBlockEditor],
    providers: [
      provideI18n(),
      ...(uploader
        ? [{ provide: LESSON_ASSET_UPLOADER, useValue: uploader }]
        : []),
    ],
  }).compileComponents();
  // Pin the locale so assertions don't depend on navigator.language.
  void TestBed.inject(I18nService).setLocale(locale);
  const fixture = TestBed.createComponent(LessonBlockEditor);
  const cmp = fixture.componentInstance;
  const changes: LessonDoc[] = [];
  cmp.registerOnChange((d) => changes.push(d));
  if (doc) cmp.writeValue(doc);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return { fixture, cmp, el: fixture.nativeElement as HTMLElement, changes };
}

async function settle(fixture: ComponentFixture<unknown>): Promise<void> {
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
}

function toolbarButton(el: HTMLElement, command: string): HTMLButtonElement {
  const btn = el.querySelector<HTMLButtonElement>(
    `button[data-command="${command}"]`,
  );
  if (!btn) throw new Error(`no toolbar button ${command}`);
  return btn;
}

function type(
  input: HTMLInputElement | HTMLTextAreaElement,
  value: string,
): void {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('LessonBlockEditor', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('round-trips the kitchen-sink doc into a schema-valid LessonDoc', async () => {
    const source = kitchenSinkLessonDoc();
    const { cmp } = await mount(source);
    const out = cmp.getDoc();
    const parsed = lessonDocSchema.safeParse(out);
    if (!parsed.success)
      throw new Error(JSON.stringify(parsed.error.issues, null, 2));
    expect(out?.content.map((b) => b.type)).toEqual(
      expect.arrayContaining(source.content.map((b) => b.type)),
    );
    const quizzes = (out?.content ?? []).filter(
      (b): b is QuizNode => b.type === 'quiz',
    );
    const sourceQuizzes = source.content.filter(
      (b): b is QuizNode => b.type === 'quiz',
    );
    expect(quizzes.map((q) => q.attrs.kind)).toEqual([
      'single',
      'multiple',
      'match',
      'order',
    ]);
    quizzes.forEach((q, i) =>
      expect(q.attrs).toEqual({
        targets: null,
        ...sourceQuizzes[i].attrs,
      }),
    );
    // Round-3 attrs survive the editor.
    const code = out?.content.find((b) => b.type === 'codeBlock');
    expect(code?.attrs).toMatchObject({
      language: 'typescript',
      showLineNumbers: true,
      highlightLines: '2',
      copyable: true,
    });
    expect(out?.content.find((b) => b.type === 'image')?.attrs).toMatchObject({
      align: 'center',
    });
    expect(out?.content.some((b) => b.type === 'videoBlock')).toBe(true);
    const embed = out?.content.find((b) => b.type === 'embed') as EmbedNode;
    expect(embed.attrs.provider).toBe('youtube');
  });

  it('renders a toolbar with distinct glyphs, aria-pressed toggles and shortcuts', async () => {
    const { el } = await mount();
    const buttons = Array.from(
      el.querySelectorAll<HTMLButtonElement>('button[data-toolbar-item]'),
    );
    const icons = buttons.map(
      (b) =>
        b.querySelector('cdf-editor-icon')?.getAttribute('ng-reflect-name') ??
        b.innerHTML,
    );
    expect(new Set(icons).size).toBe(icons.length);
    expect(toolbarButton(el, 'bold').getAttribute('aria-pressed')).toBe(
      'false',
    );
    expect(toolbarButton(el, 'bold').getAttribute('aria-keyshortcuts')).toBe(
      'Control+B Meta+B',
    );
    expect(toolbarButton(el, 'image').hasAttribute('aria-pressed')).toBe(false);
    expect(el.querySelector('[role="toolbar"]')).toBeTruthy();
  });

  it('translates its placeholder, label and live-region announcements', async () => {
    const { fixture, el } = await mount(null, undefined, 'pt-BR');
    const content = el.querySelector<HTMLElement>('[role="textbox"]');
    expect(content?.getAttribute('aria-label')).toBe('Conteúdo da lição');
    expect(
      el.querySelector('[data-placeholder]')?.getAttribute('data-placeholder'),
    ).toBe('Comece a escrever a lição…');
    toolbarButton(el, 'quiz').click();
    await settle(fixture);
    await Promise.resolve();
    fixture.detectChanges();
    expect(el.querySelector('[aria-live="polite"]')?.textContent).toBe(
      'Bloco de quiz inserido.',
    );
  });

  describe('quiz blocks', () => {
    it('inserts a quiz from the toolbar and edits it through the node view', async () => {
      const { fixture, cmp, el } = await mount();
      toolbarButton(el, 'quiz').click();
      await settle(fixture);

      const view = el.querySelector<HTMLElement>('.cdf-node-view--quiz');
      expect(view).toBeTruthy();
      // Fresh quiz is incomplete → validation messages are visible.
      expect(
        view?.querySelector('[aria-label="Quiz problems"]')?.textContent,
      ).toContain('Quiz question is required');

      type(view!.querySelector('textarea')!, 'What is 2 + 2?');
      const optionInputs = view!.querySelectorAll<HTMLInputElement>(
        '.cdf-nv__option-text',
      );
      type(optionInputs[0], '4');
      type(optionInputs[1], '5');
      view!
        .querySelector<HTMLInputElement>('[aria-label="Option 1 is correct"]')!
        .click();
      await settle(fixture);

      const quiz = cmp
        .getDoc()!
        .content.find((b) => b.type === 'quiz') as QuizNode;
      expect(quiz.attrs.question).toBe('What is 2 + 2?');
      expect(quiz.attrs.options.map((o) => o.text)).toEqual(['4', '5']);
      expect(quiz.attrs.correctOptionIds).toEqual([quiz.attrs.options[0].id]);
      expect(lessonDocSchema.safeParse(cmp.getDoc()).success).toBe(true);
      expect(view?.querySelector('[aria-label="Quiz problems"]')).toBeNull();
    });

    it('adds options and switches to multiple choice', async () => {
      const { fixture, cmp, el } = await mount();
      toolbarButton(el, 'quiz').click();
      await settle(fixture);
      const view = el.querySelector<HTMLElement>('.cdf-node-view--quiz')!;
      Array.from(view.querySelectorAll<HTMLButtonElement>('button'))
        .find((b) => b.textContent?.includes('Add option'))!
        .click();
      view.querySelector<HTMLInputElement>('input[value="multiple"]')!.click();
      await settle(fixture);
      const quiz = cmp
        .getDoc()!
        .content.find((b) => b.type === 'quiz') as QuizNode;
      expect(quiz.attrs.options).toHaveLength(3);
      expect(quiz.attrs.kind).toBe('multiple');
    });
  });

  describe('image blocks', () => {
    it('uploads through LESSON_ASSET_UPLOADER with progress, then inserts with alt text', async () => {
      let finish!: (v: { url: string; assetId: string }) => void;
      const uploader: LessonAssetUploader = {
        upload: jest.fn((_file, opts) => {
          opts?.onProgress?.(0.4);
          return new Promise((resolve) => (finish = resolve));
        }),
      };
      const { fixture, cmp, el } = await mount(null, uploader);
      toolbarButton(el, 'image').click();
      await settle(fixture);

      const panelDe = fixture.debugElement.query(
        (d) => d.componentInstance instanceof ImagePanel,
      );
      const panel = panelDe.componentInstance as ImagePanel;
      const file = new File(['png'], 'diagram.png', { type: 'image/png' });
      const pending = panel.upload(file);
      await settle(fixture);
      const progress = el.querySelector('progress');
      expect(progress?.getAttribute('aria-label')).toBe('Upload progress 40%');
      expect(
        el.querySelector('.cdf-editor-panel [role="status"]')?.textContent,
      ).toContain('diagram.png');

      finish({ url: 'https://cdn.codify.app/img/a1', assetId: 'a1' });
      await pending;
      await settle(fixture);

      const insertBtn = Array.from(
        el.querySelectorAll<HTMLButtonElement>('.cdf-editor-panel button'),
      ).find((b) => b.textContent?.includes('Insert image'))!;
      expect(insertBtn.disabled).toBe(true); // alt text still missing
      const altInput = Array.from(
        el.querySelectorAll<HTMLInputElement>('.cdf-editor-panel input'),
      ).find((i) => i.closest('label')?.textContent?.includes('Alt text'))!;
      type(altInput, 'Component tree');
      await settle(fixture);
      expect(insertBtn.disabled).toBe(false);
      insertBtn.click();
      await settle(fixture);

      const img = cmp
        .getDoc()!
        .content.find((b) => b.type === 'image') as ImageNode;
      expect(img.attrs).toMatchObject({
        src: 'https://cdn.codify.app/img/a1',
        assetId: 'a1',
        alt: 'Component tree',
      });
      expect(
        el.querySelector('.cdf-node-view--image img')?.getAttribute('alt'),
      ).toBe('Component tree');
      expect(lessonDocSchema.safeParse(cmp.getDoc()).success).toBe(true);
    });

    it('shows upload errors with a retry and rejects unsupported files', async () => {
      const uploader: LessonAssetUploader = {
        upload: jest
          .fn()
          .mockRejectedValueOnce(new Error('network down'))
          .mockResolvedValueOnce({
            url: 'https://cdn.codify.app/img/a2',
            assetId: 'a2',
          }),
      };
      const { fixture, el } = await mount(null, uploader);
      toolbarButton(el, 'image').click();
      await settle(fixture);
      const panel = fixture.debugElement.query(
        (d) => d.componentInstance instanceof ImagePanel,
      ).componentInstance as ImagePanel;

      await panel.upload(new File(['x'], 'notes.txt', { type: 'text/plain' }));
      await settle(fixture);
      expect(el.querySelector('[role="alert"]')?.textContent).toContain(
        'not a supported image type',
      );
      expect(uploader.upload).not.toHaveBeenCalled();

      await panel.upload(new File(['x'], 'a.png', { type: 'image/png' }));
      await settle(fixture);
      const alert = el.querySelector('[role="alert"]');
      expect(alert?.textContent).toContain('Upload failed: network down');
      Array.from(alert!.querySelectorAll('button'))
        .find((b) => b.textContent?.includes('Retry'))!
        .click();
      await new Promise((r) => setTimeout(r));
      await settle(fixture);
      expect(uploader.upload).toHaveBeenCalledTimes(2);
      expect(el.querySelector('[role="alert"]')).toBeNull();
    });

    it('accepts an image URL when no uploader is provided', async () => {
      const { fixture, el } = await mount();
      toolbarButton(el, 'image').click();
      await settle(fixture);
      expect(el.querySelector('input[type="file"]')).toBeNull();
      const urlInput = Array.from(
        el.querySelectorAll<HTMLInputElement>('.cdf-editor-panel input'),
      ).find((i) => i.closest('label')?.textContent?.includes('Image URL'))!;
      type(urlInput, 'javascript:alert(1)');
      await settle(fixture);
      expect(
        el.querySelector('.cdf-editor-panel__help--error')?.textContent,
      ).toContain('http(s)');
    });
  });

  describe('embed blocks', () => {
    async function openEmbed() {
      const ctx = await mount();
      toolbarButton(ctx.el, 'embed').click();
      await settle(ctx.fixture);
      const inputs = ctx.el.querySelectorAll<HTMLInputElement>(
        '.cdf-editor-panel input',
      );
      const submit = Array.from(
        ctx.el.querySelectorAll<HTMLButtonElement>('.cdf-editor-panel button'),
      ).find((b) => b.textContent?.includes('Insert embed'))!;
      return { ...ctx, url: inputs[0], title: inputs[1], submit };
    }

    it('inserts an allowlisted embed with the detected provider', async () => {
      const { fixture, cmp, url, title, submit, el } = await openEmbed();
      type(url, 'https://vimeo.com/76979871');
      type(title, 'Talk recording');
      await settle(fixture);
      expect(
        el.querySelector('.cdf-editor-panel__help')?.textContent,
      ).toContain('Detected Vimeo');
      submit.click();
      await settle(fixture);
      const embed = cmp
        .getDoc()!
        .content.find((b) => b.type === 'embed') as EmbedNode;
      expect(embed.attrs).toEqual({
        aspectRatio: '16:9',
        meta: null,
        provider: 'vimeo',
        url: 'https://vimeo.com/76979871',
        title: 'Talk recording',
      });
      expect(el.querySelector('.cdf-node-view--embed')?.textContent).toContain(
        'Vimeo embed',
      );
    });

    it('refuses non-allowlisted URLs', async () => {
      const { fixture, url, title, submit, el } = await openEmbed();
      type(url, 'https://evil.example/video');
      type(title, 'Nope');
      await settle(fixture);
      expect(submit.disabled).toBe(true);
      expect(el.querySelector('.cdf-editor-panel__help--error')).toBeTruthy();
    });
  });

  describe('links', () => {
    it('opens an inline dialog instead of window.prompt and blocks javascript: hrefs', async () => {
      const promptSpy = jest
        .spyOn(window, 'prompt')
        .mockImplementation(() => null);
      const { fixture, el } = await mount();
      toolbarButton(el, 'link').click();
      await settle(fixture);
      const dialog = el.querySelector<HTMLElement>('[role="dialog"]');
      expect(dialog?.textContent).toContain('Add link');
      const input =
        dialog!.querySelector<HTMLInputElement>('input[type="text"]')!;
      type(input, 'javascript:alert(1)');
      await settle(fixture);
      const apply = Array.from(dialog!.querySelectorAll('button')).find((b) =>
        b.textContent?.includes('Apply'),
      )!;
      expect(apply.disabled).toBe(true);
      expect(input.getAttribute('aria-invalid')).toBe('true');
      expect(promptSpy).not.toHaveBeenCalled();
      promptSpy.mockRestore();
    });
  });

  it('opens the block menu from the toolbar and inserts a ref block', async () => {
    const { fixture, cmp, el } = await mount();
    toolbarButton(el, 'insert').click();
    await settle(fixture);
    const option = el.querySelector<HTMLElement>(
      '[role="option"][data-type="exerciseRef"]',
    );
    expect(option).toBeTruthy();
    option!.click();
    await settle(fixture);
    expect(cmp.getDoc()!.content.some((b) => b.type === 'exerciseRef')).toBe(
      true,
    );
    const card = el.querySelector<HTMLElement>('.cdf-node-view--exerciseRef');
    expect(card?.textContent).toContain('Code exercise');
    type(card!.querySelector('input')!, '0192f3a4-0000-7000-8000-000000000001');
    await settle(fixture);
    const ref = cmp.getDoc()!.content.find((b) => b.type === 'exerciseRef');
    expect(ref).toEqual({
      type: 'exerciseRef',
      attrs: { exerciseId: '0192f3a4-0000-7000-8000-000000000001' },
    });
  });

  describe('quiz kinds (match / order)', () => {
    it('builds a valid matching quiz from rows', async () => {
      const { fixture, cmp, el } = await mount();
      toolbarButton(el, 'quiz').click();
      await settle(fixture);
      const view = el.querySelector<HTMLElement>('.cdf-node-view--quiz')!;
      view.querySelector<HTMLInputElement>('input[value="match"]')!.click();
      await settle(fixture);
      type(view.querySelector('textarea')!, 'Match them');
      const inputs = view.querySelectorAll<HTMLInputElement>(
        '.cdf-nv__option--pair .cdf-nv__option-text',
      );
      expect(inputs).toHaveLength(4);
      ['signal', 'Writable', 'computed', 'Derived'].forEach((v, i) =>
        type(inputs[i], v),
      );
      await settle(fixture);
      const quiz = cmp
        .getDoc()!
        .content.find((b) => b.type === 'quiz') as QuizNode;
      expect(quiz.attrs.kind).toBe('match');
      expect(quiz.attrs.targets?.map((t) => t.text)).toEqual([
        'Writable',
        'Derived',
      ]);
      expect(quiz.attrs.correctOptionIds).toEqual(
        quiz.attrs.options.map(
          (o, i) => `${o.id}:${quiz.attrs.targets![i].id}`,
        ),
      );
      expect(lessonDocSchema.safeParse(cmp.getDoc()).success).toBe(true);
    });

    it('builds an ordering quiz whose key follows the listed order', async () => {
      const { fixture, cmp, el } = await mount();
      toolbarButton(el, 'quiz').click();
      await settle(fixture);
      const view = el.querySelector<HTMLElement>('.cdf-node-view--quiz')!;
      view.querySelector<HTMLInputElement>('input[value="order"]')!.click();
      await settle(fixture);
      type(view.querySelector('textarea')!, 'Order them');
      const inputs = view.querySelectorAll<HTMLInputElement>(
        '.cdf-nv__option-text',
      );
      type(inputs[0], 'First');
      type(inputs[1], 'Second');
      await settle(fixture);
      view
        .querySelector<HTMLButtonElement>('[aria-label="Move item 1 down"]')!
        .click();
      await settle(fixture);
      const quiz = cmp
        .getDoc()!
        .content.find((b) => b.type === 'quiz') as QuizNode;
      expect(quiz.attrs.options.map((o) => o.text)).toEqual([
        'Second',
        'First',
      ]);
      expect(quiz.attrs.correctOptionIds).toEqual(
        quiz.attrs.options.map((o) => o.id),
      );
      expect(lessonDocSchema.safeParse(cmp.getDoc()).success).toBe(true);
    });
  });

  describe('editor UX (docs/06 §9)', () => {
    const codeDoc = (): LessonDoc => ({
      type: 'doc',
      version: 1,
      content: [
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: 'Intro' }],
        },
        { type: 'paragraph', content: [{ type: 'text', text: 'Hello world' }] },
        {
          type: 'codeBlock',
          attrs: { language: 'plaintext' },
          content: [{ type: 'text', text: 'a\nb' }],
        },
      ],
    });

    it('edits code-block language, line numbers and highlighted lines in the properties panel', async () => {
      const { fixture, cmp, el } = await mount(codeDoc());
      const editor = cmp.tiptap!;
      editor.commands.setTextSelection(editor.state.doc.content.size - 2);
      await settle(fixture);
      const panel = el.querySelector<HTMLElement>(
        '[data-testid="block-properties"]',
      )!;
      expect(panel.textContent).toContain('Code block');
      const lang = panel.querySelector<HTMLSelectElement>(
        '[data-testid="code-language"]',
      )!;
      lang.value = 'python';
      lang.dispatchEvent(new Event('change'));
      panel.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click();
      const hl = panel.querySelector<HTMLInputElement>(
        'input[inputmode="numeric"]',
      )!;
      type(hl, '1-x');
      await settle(fixture);
      expect(hl.getAttribute('aria-invalid')).toBe('true');
      type(hl, '2');
      await settle(fixture);
      const code = cmp.getDoc()!.content[2] as { attrs: unknown };
      expect(code.attrs).toMatchObject({
        language: 'python',
        showLineNumbers: true,
        highlightLines: '2',
      });
      expect(lessonDocSchema.safeParse(cmp.getDoc()).success).toBe(true);
    });

    it('moves blocks with the panel buttons and Alt+Shift+Arrow, announcing the move', async () => {
      const { fixture, cmp, el } = await mount(codeDoc());
      const editor = cmp.tiptap!;
      editor.commands.setTextSelection(3); // inside the heading
      await settle(fixture);
      const panel = el.querySelector<HTMLElement>(
        '[data-testid="block-properties"]',
      )!;
      Array.from(panel.querySelectorAll('button'))
        .find((b) => b.textContent?.includes('Move block down'))!
        .click();
      await settle(fixture);
      // (StarterKit keeps a trailing paragraph after the code block.)
      expect(
        cmp
          .getDoc()!
          .content.map((b) => b.type)
          .slice(0, 3),
      ).toEqual(['paragraph', 'heading', 'codeBlock']);
      expect(el.querySelector('.cdf-lesson-editor__sr')?.textContent).toContain(
        'position 2',
      );
      expect(editor.commands.moveTopBlock(-1)).toBe(true);
      expect(cmp.getDoc()!.content[0].type).toBe('heading');
    });

    it('lists headings and interactive blocks in the outline and jumps to them', async () => {
      const { fixture, cmp, el } = await mount(kitchenSinkLessonDoc());
      el.querySelector<HTMLButtonElement>(
        '[data-testid="toggle-outline"]',
      )!.click();
      await settle(fixture);
      const outline = el.querySelector<HTMLElement>(
        '[data-testid="editor-outline"]',
      )!;
      const items = Array.from(outline.querySelectorAll('button')).map((b) =>
        b.textContent?.replace(/\s+/g, ' ').trim(),
      );
      expect(items[0]).toBe('Every block, once');
      expect(items.some((t) => t?.startsWith('Quiz'))).toBe(true);
      expect(items.some((t) => t?.startsWith('Video'))).toBe(true);
      const quizBtn = Array.from(outline.querySelectorAll('button')).find((b) =>
        b.textContent?.includes('Match each API'),
      )!;
      quizBtn.click();
      await settle(fixture);
      const sel = cmp.tiptap!.state.selection;
      expect(cmp.tiptap!.state.doc.nodeAt(sel.from)?.attrs['id']).toBe('q3');
    });

    it('shows the floating marks toolbar for a text selection', async () => {
      const { fixture, cmp, el } = await mount(codeDoc());
      const editor = cmp.tiptap!;
      editor.commands.focus();
      editor.commands.setTextSelection({ from: 8, to: 13 });
      await settle(fixture);
      const bar = el.querySelector<HTMLElement>(
        '[data-testid="marks-toolbar"]',
      );
      expect(bar?.getAttribute('role')).toBe('toolbar');
      bar!.querySelector<HTMLButtonElement>('[data-mark="bold"]')!.click();
      await settle(fixture);
      const p = cmp.getDoc()!.content[1] as {
        content: { marks?: { type: string }[] }[];
      };
      expect(
        p.content.some((t) => t.marks?.some((m) => m.type === 'bold')),
      ).toBe(true);
    });

    it('inserts a video block from the block menu', async () => {
      const { fixture, cmp } = await mount();
      cmp.insertBlock('videoBlock');
      await settle(fixture);
      const video = cmp.getDoc()!.content.find((b) => b.type === 'videoBlock');
      expect(video?.attrs).toMatchObject({ title: 'Video' });
      expect(lessonDocSchema.safeParse(cmp.getDoc()).success).toBe(true);
    });

    it('locks the block structure in translation mode but allows text edits', async () => {
      await TestBed.configureTestingModule({
        imports: [LessonBlockEditor],
        providers: [provideI18n()],
      }).compileComponents();
      await TestBed.inject(I18nService).setLocale('en-US');
      const fixture = TestBed.createComponent(LessonBlockEditor);
      fixture.componentRef.setInput('lockStructure', true);
      const cmp = fixture.componentInstance;
      cmp.writeValue(kitchenSinkLessonDoc());
      await settle(fixture);
      const editor = cmp.tiptap!;
      const before = cmp.structureSignature();
      // Text edits pass.
      editor.commands.setTextSelection(3);
      editor.commands.insertContent('Olá ');
      expect(JSON.stringify(cmp.getDoc())).toContain('Olá ');
      // Structural edits are rejected.
      editor.commands.insertRootBlock({ type: 'horizontalRule' });
      editor.commands.moveTopBlock(1);
      editor.commands.deleteTopBlock();
      expect(cmp.structureSignature()).toBe(before);
      expect(
        fixture.nativeElement.querySelector('[data-testid="drag-handle"]'),
      ).toBeNull();
      expect(fixture.nativeElement.textContent).toContain('Translation mode');
    });
  });
});
