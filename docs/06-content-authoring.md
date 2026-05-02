# 06 — Content Authoring (Tiptap)

Lessons are authored in Tiptap and stored as JSON in `Lesson.contentJson`. This document defines the block catalog, the JSON shape, the rendering contract, and the translation flow.

## 1. Why Tiptap

- Built on ProseMirror (proven schema + transaction model used by Notion, Linear, GitLab).
- Headless — full styling control via Bootstrap (admin) and Ionic (student).
- Extension-driven: every custom block is a `Node` extension we own.
- JSON output that we can validate, version, and migrate.

## 2. Document shape

```ts
// libs/lesson-schema/src/types.ts

export const LESSON_DOC_VERSION = 1;

export type LessonDoc = {
  type: 'doc';
  version: number;            // LESSON_DOC_VERSION at save time
  attrs?: { sourceLocale: string };
  content: BlockNode[];
};

export type BlockNode =
  | ParagraphNode
  | HeadingNode
  | BulletListNode
  | OrderedListNode
  | BlockquoteNode
  | CalloutNode
  | CodeBlockNode
  | ImageNode
  | EmbedNode
  | VideoBlockNode          // shape defined; renderer no-op until video phase
  | DividerNode
  | QuizNode
  | ExerciseRefNode
  | AiPromptNode
  | ScenarioNode
  | TableNode;
```

(Each block's full attrs/content shape is enumerated below.)

## 3. Block catalog

### Text & structure

#### Paragraph
```json
{ "type": "paragraph", "content": [{ "type": "text", "text": "..." }] }
```
Marks: `bold`, `italic`, `underline`, `strike`, `code`, `link` (`{ href, target }`), `highlight`, `kbd`.

#### Heading
```json
{ "type": "heading", "attrs": { "level": 2 }, "content": [...] }
```
Levels 2 and 3 only (lesson title is metadata, not in body).

#### Lists
- `bulletList` containing `listItem` containing block(s).
- `orderedList` with optional `attrs.start`.

#### Blockquote
Wraps block(s).

#### Callout (custom)
```json
{
  "type": "callout",
  "attrs": { "kind": "info" },  // info | tip | warn | danger | success
  "content": [...]
}
```
Renders with token color and an icon.

#### CodeBlock (custom)
```json
{
  "type": "codeBlock",
  "attrs": {
    "language": "typescript",
    "showLineNumbers": true,
    "highlightLines": "3,7-9",
    "copyable": true
  },
  "content": [{ "type": "text", "text": "...source..." }]
}
```
Renderer uses Shiki (admin + student) with shared theme tokens.

#### Image
```json
{
  "type": "image",
  "attrs": {
    "assetId": "uuid",
    "alt": "...",
    "caption": "...",
    "align": "center",
    "width": "full"  // full | wide | inline
  }
}
```
`assetId` resolves through the media library; URLs are constructed by the renderer (image proxy with Cloudflare image resizing).

#### Embed
```json
{
  "type": "embed",
  "attrs": {
    "provider": "youtube",  // youtube | codepen | codesandbox | stackblitz | figma
    "url": "...",
    "aspectRatio": "16:9"
  }
}
```
Allowlist of providers; URL validated and oEmbed-style metadata fetched on author save.

#### Video block (deferred render)
Shape ready; renderer falls back to a "Video coming soon" placeholder until the Cloudflare Stream pipeline phase.

#### Divider
```json
{ "type": "divider" }
```

#### Table
Standard Tiptap table extension; rows / cells; no merged cells initially.

### Interactive blocks

#### Quiz (custom)
```json
{
  "type": "quiz",
  "attrs": {
    "id": "q1",
    "kind": "single",         // single | multi | match | order
    "shuffleOptions": true,
    "explanation": "Markdown for after-answer explanation"
  },
  "content": [
    { "type": "quizPrompt", "content": [...] },
    {
      "type": "quizOption",
      "attrs": { "id": "a", "correct": true },
      "content": [...]
    },
    { "type": "quizOption", "attrs": { "id": "b" }, "content": [...] },
    { "type": "quizOption", "attrs": { "id": "c" }, "content": [...] }
  ]
}
```
- `single`: one correct.
- `multi`: zero or more correct.
- `match`: pairs (`leftId` ↔ `rightId`).
- `order`: drag-to-order; correct sequence by option order in the array.
- Server validates: at least one option marked `correct: true` for `single`/`multi`.

#### ExerciseRef (custom)
```json
{ "type": "exerciseRef", "attrs": { "exerciseId": "uuid" } }
```
The exercise itself lives in the `Exercise` model. The ref block tells the renderer to mount `ExerciseRunner` inline. A `LessonType=EXERCISE` lesson typically has exactly one of these as its terminal block.

#### AiPrompt (custom)
```json
{
  "type": "aiPrompt",
  "attrs": {
    "promptId": "uuid",
    "task": "Plain-language description shown to the student",
    "rubric": [
      { "id": "r1", "criterion": "Mentions input validation", "weight": 1, "match": { "kind": "regex", "value": "valid(at|ation)", "flags": "i" } },
      { "id": "r2", "criterion": "Avoids hallucinated function names", "weight": 1, "match": { "kind": "absent_of", "values": ["foobar()", "doStuff()"] } },
      { "id": "r3", "criterion": "Quality is good (LLM-judged)", "weight": 2, "match": { "kind": "llm_judge", "rubric": "Is the answer specific, accurate, and complete?" } }
    ],
    "minScorePct": 60,
    "modelHint": "claude-haiku"  // suggestion to backend; backend picks final model
  }
}
```
- Deterministic rubric items run first (no LLM call needed → fast path).
- LLM-judged items run only when deterministic items don't decide pass/fail conclusively.
- See [12-code-execution.md](./12-code-execution.md) and the `ai-grading` module in API for the executor.

#### Scenario (custom)
```json
{
  "type": "scenario",
  "attrs": {
    "scenarioId": "uuid"
  }
}
```
Scenario tree stored separately (extension to `Exercise`-like model later) to keep `LessonDoc` tidy. Renderer mounts `ScenarioRunner` referencing the scenario id. v1 stores tree inline in the `attrs.tree` for simplicity; a dedicated `Scenario` table arrives when a teacher needs to reuse trees.

## 4. Tiptap extension wiring

`libs/lesson-schema/src/tiptap.ts` exports an array of extensions:

```ts
export const tiptapExtensions: Extensions = [
  Document,
  Paragraph,
  Text,
  Heading.configure({ levels: [2, 3] }),
  Bold, Italic, Underline, Strike, Code, Highlight, Link.configure({ openOnClick: false }),
  BulletList, OrderedList, ListItem,
  Blockquote,
  Divider,
  Callout,                  // custom node
  CodeBlock,                // custom node (Shiki-themed)
  ImageBlock,               // custom node
  Embed,                    // custom node
  VideoBlock,               // custom node (deferred render)
  Table, TableRow, TableHeader, TableCell,
  Quiz, QuizPrompt, QuizOption,
  ExerciseRef,
  AiPrompt,
  Scenario,
  History,
  Placeholder.configure({ placeholder: ({ node }) => placeholderFor(node) }),
];
```

Editor and renderer share the same extension definitions; the renderer instantiates Tiptap in `editable: false` mode but with all custom node views so interactivity (quiz, exercise) works.

## 5. Rendering contract

`libs/lesson-schema/src/render.ts`:

```ts
export interface BlockRendererProtocol {
  // Return an Angular component class for a given block type.
  resolve(blockType: string): Type<unknown> | null;
}
```

The student app implements this with Ionic-styled components. The admin app implements it with Bootstrap-styled components for the preview pane. Custom node views in the editor itself reuse the admin renderer's components for WYSIWYG fidelity.

## 6. Validation

`lessonDocSchema` (zod) validates the full document:
- Block type whitelist.
- Allowed nesting per block (`callout` cannot contain `callout`; `quiz` only contains the quiz subtypes).
- Quiz must have ≥ 2 options and ≥ 1 correct (for single/multi).
- `exerciseRef.exerciseId` must reference an existing `Exercise`.
- `image.assetId` must reference an existing asset.
- `embed.url` must match an allowlisted provider pattern.

Validation runs client-side (admin) on save and server-side (API) before persisting.

## 7. Versioning & migration

- Each save writes `version: LESSON_DOC_VERSION` into `attrs`.
- On load, `migrateLessonDoc(doc)` runs registered migrations from the doc's version up to current.
- Migration function signature: `(doc: any) => any`.
- Migrations are pure and tested with snapshot fixtures.
- Bumping `LESSON_DOC_VERSION` requires a migration; CI fails if no migration is registered for the new version.

## 8. Translations

Translatable surfaces in a lesson:
- Lesson `title` (in `Lesson` table — `ContentTranslation(LESSON, id, locale, "title")`).
- Lesson `contentJson` itself (translation stores the *whole translated doc* as `value`, JSON-encoded; not field-by-field). Reason: it's far easier for a translator to operate on the full doc with their own editor open.
- Quiz `attrs.explanation`, `quizPrompt` text, `quizOption` text — all live inside `contentJson`, so they translate as part of the doc.
- `aiPrompt.attrs.task` and `rubric[*].criterion` — translated as part of the doc; rubric `match` rules are language-agnostic and shared across locales.

Missing-translation fallback: render in `course.sourceLocale` with a one-time toast: "This lesson hasn't been translated to [language] yet."

## 9. Authoring UX details

- **Slash-commands** (`/`) open the block menu — same set as floating toolbar.
- **Drag handles** on the left gutter to reorder blocks.
- **Floating toolbar** for inline marks (bold, italic, link, code).
- **Right-side properties panel** (sticky) for the currently selected block (e.g. callout kind, code language, quiz options).
- **Preview as student** modal renders the doc in mobile + desktop viewport simultaneously.
- **Outline view** (toggle) shows a tree of headings + interactive blocks for quick nav in long lessons.
- **AI assist** (later phase): "Generate quiz from this section" → calls server → preview → insert.

## 10. Asset pipeline

- Uploads go through admin → API → Cloudflare R2.
- API records an `Asset` row (not in the v1 schema for brevity; add when needed): id, mime, size, dimensions, uploaderId, sha256.
- Image rendering URL: `https://cdn.codify.app/img/<assetId>?w=&h=&fmt=` — Cloudflare Image Resizing in front of R2.
- Allowed types: PNG, JPEG, WebP, SVG, GIF (no autoplay), MP4 (later video phase only).
- SVG sanitized via DOMPurify before storage.

## 11. Storage & query patterns

- `Lesson.contentJson` is JSONB. Indexed minimally; we read the whole doc when rendering.
- Deep-search across content (e.g. "find all lessons referencing Stripe") uses Postgres `jsonb_path_query` initially; move to Meilisearch if it gets heavy.
- Doc size budget: 100KB per lesson typical, 500KB hard limit. Long content should be split into multiple lessons (also better for engagement / streaks).

## 12. Out of scope (initial)

- Real-time multi-author editing (Tiptap supports it via Yjs; defer until we have multiple co-authors per course).
- Inline comments / suggestions (also Yjs-based; defer).
- Markdown import/export (nice-to-have; can be added by writing a converter that walks the doc).
- Custom CSS per block (open-ended; rely on tokens).
