#!/usr/bin/env node
/**
 * Seeds the published, fully-free "Python Fundamentals" course: one reading
 * and four auto-graded Python exercises whose reference solutions are
 * verified on the code runner before the course is published.
 *
 *   API_URL=http://localhost:3000/api node tools/scripts/seed-python-course.mjs
 *
 * Requirements: the API must run with JUDGE0_URL set (Python runs on Judge0;
 * the local dev executor only runs JavaScript/TypeScript). Uses the dev
 * admin token (override with SEED_TOKEN).
 *
 * Idempotent and resumable: the course is found by its fixed slug; missing
 * pieces are created, existing exercises are updated to this spec, every
 * reference solution is re-verified, and the course is published last. A
 * second run on a published course only re-verifies.
 */

const API = (process.env.API_URL || 'http://localhost:3000/api').replace(
  /\/+$/,
  '',
);
const TOKEN = process.env.SEED_TOKEN || 'dev-token-admin';
const SLUG = 'python-fundamentals';
const CATEGORY_SLUG = 'programming';

const headers = {
  'content-type': 'application/json',
  authorization: `Bearer ${TOKEN}`,
};

async function call(method, path, body) {
  const r = await fetch(API + path, {
    method,
    headers:
      method === 'GET'
        ? headers
        : { ...headers, 'idempotency-key': crypto.randomUUID() },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  if (!r.ok) {
    const err = new Error(
      `${method} ${path} → ${r.status}: ${typeof json === 'string' ? json : JSON.stringify(json)}`,
    );
    err.status = r.status;
    err.body = json;
    throw err;
  }
  return json;
}
const get = (p) => call('GET', p);
const post = (p, b = {}) => call('POST', p, b);
const patch = (p, b) => call('PATCH', p, b);

const doc = (...paragraphs) => ({
  type: 'doc',
  content: paragraphs.map((p) =>
    p.startsWith('# ')
      ? {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: p.slice(2) }],
        }
      : p.startsWith('```')
        ? {
            type: 'codeBlock',
            attrs: { language: 'python' },
            content: [{ type: 'text', text: p.slice(3) }],
          }
        : { type: 'paragraph', content: [{ type: 'text', text: p }] },
  ),
});

const t = (id, name, args, expected) => ({ id, name, args, expected });

/** The course, in order. `exercise` lessons are graded on the code runner. */
const LESSONS = [
  {
    title: 'Python in five minutes',
    type: 'READING',
    baseXp: 10,
    baseCoins: 5,
    content: doc(
      '# Hello, Python',
      'Python is a friendly, readable language. Functions are defined with def, blocks are indented, and values are returned with return.',
      '```def add(a, b):\n    return a + b',
      'Every exercise in this course asks you to complete one function. "Run" checks it against the visible tests; "Submit" also runs hidden edge cases.',
    ),
  },
  {
    title: 'Say hello',
    type: 'EXERCISE',
    baseXp: 20,
    baseCoins: 10,
    content: doc(
      'Write greet(name) that returns the string "Hello, <name>!". Hint: f-strings like f"Hi {x}" make this easy.',
    ),
    exercise: {
      entryFunction: 'greet',
      starterCode:
        'def greet(name):\n    # return "Hello, <name>!"\n    pass\n',
      solutionCode: 'def greet(name):\n    return f"Hello, {name}!"\n',
      visibleTests: [
        t('v1', 'greets Ada', ['Ada'], 'Hello, Ada!'),
        t('v2', 'greets World', ['World'], 'Hello, World!'),
      ],
      hiddenTests: [
        t('h1', 'empty name', [''], 'Hello, !'),
        t('h2', 'accented name', ['José'], 'Hello, José!'),
      ],
    },
  },
  {
    title: 'FizzBuzz',
    type: 'EXERCISE',
    baseXp: 25,
    baseCoins: 12,
    content: doc(
      'Write fizzbuzz(n) returning a list of strings for 1..n: "Fizz" for multiples of 3, "Buzz" for multiples of 5, "FizzBuzz" for both, otherwise the number as a string.',
    ),
    exercise: {
      entryFunction: 'fizzbuzz',
      starterCode:
        'def fizzbuzz(n):\n    result = []\n    # fill result for 1..n\n    return result\n',
      solutionCode:
        'def fizzbuzz(n):\n    out = []\n    for i in range(1, n + 1):\n        if i % 15 == 0:\n            out.append("FizzBuzz")\n        elif i % 3 == 0:\n            out.append("Fizz")\n        elif i % 5 == 0:\n            out.append("Buzz")\n        else:\n            out.append(str(i))\n    return out\n',
      visibleTests: [
        t('v1', 'first five', [5], ['1', '2', 'Fizz', '4', 'Buzz']),
        t('v2', 'just one', [1], ['1']),
      ],
      hiddenTests: [
        t(
          'h1',
          'up to fifteen',
          [15],
          [
            '1',
            '2',
            'Fizz',
            '4',
            'Buzz',
            'Fizz',
            '7',
            '8',
            'Fizz',
            'Buzz',
            '11',
            'Fizz',
            '13',
            '14',
            'FizzBuzz',
          ],
        ),
        t('h2', 'zero', [0], []),
      ],
    },
  },
  {
    title: 'Count the words',
    type: 'EXERCISE',
    baseXp: 30,
    baseCoins: 15,
    content: doc(
      'Write word_count(text) returning a dict that maps each lower-cased word to how often it appears. Split on whitespace and strip the punctuation .,!?;:"\'() from each word; skip empty words.',
    ),
    exercise: {
      entryFunction: 'word_count',
      starterCode:
        'def word_count(text):\n    counts = {}\n    # your code here\n    return counts\n',
      solutionCode:
        'def word_count(text):\n    counts = {}\n    for raw in text.lower().split():\n        word = raw.strip(".,!?;:\\"\'()")\n        if word:\n            counts[word] = counts.get(word, 0) + 1\n    return counts\n',
      visibleTests: [
        t('v1', 'repeated word', ['the cat the hat'], {
          the: 2,
          cat: 1,
          hat: 1,
        }),
        t('v2', 'single word', ['python'], { python: 1 }),
      ],
      hiddenTests: [
        t('h1', 'empty text', [''], {}),
        t('h2', 'case and punctuation', ['Hello, hello! HELLO?'], { hello: 3 }),
      ],
    },
  },
  {
    title: 'Palindromes',
    type: 'EXERCISE',
    baseXp: 30,
    baseCoins: 15,
    content: doc(
      'Write is_palindrome(s) that returns True when s reads the same backwards, ignoring case and any character that is not a letter or digit.',
    ),
    exercise: {
      entryFunction: 'is_palindrome',
      starterCode:
        'def is_palindrome(s):\n    # ignore case and non-alphanumeric characters\n    return False\n',
      solutionCode:
        'def is_palindrome(s):\n    cleaned = [c.lower() for c in s if c.isalnum()]\n    return cleaned == cleaned[::-1]\n',
      visibleTests: [
        t('v1', 'racecar', ['racecar'], true),
        t('v2', 'hello', ['hello'], false),
      ],
      hiddenTests: [
        t(
          'h1',
          'sentence with punctuation',
          ['A man, a plan, a canal: Panama'],
          true,
        ),
        t('h2', 'empty string', [''], true),
        t('h3', 'digits', ['12321'], true),
      ],
    },
  },
];

async function findCourse() {
  try {
    return await get(`/courses/${SLUG}`);
  } catch (err) {
    if (err.status === 404) return null;
    throw err;
  }
}

async function ensureCategory() {
  const { items } = await get('/categories?take=200');
  const found = items.find((c) => c.slug === CATEGORY_SLUG);
  return (
    found ??
    (await post('/categories', { slug: CATEGORY_SLUG, name: 'Programming' }))
  );
}

async function main() {
  let course = await findCourse();
  if (!course) {
    const category = await ensureCategory();
    await post('/courses', {
      slug: SLUG,
      title: 'Python Fundamentals',
      description:
        'Five short lessons: write and test your first Python functions.',
      sourceLocale: 'en',
      difficulty: 1,
      estimatedMinutes: 45,
      categoryIds: [category.id],
    });
    course = await findCourse();
    console.log(`• created course ${SLUG}`);
  } else {
    console.log(`• course ${SLUG} exists (${course.status})`);
  }

  const modules = await get(`/courses/${course.id}/modules`);
  const mod =
    modules[0] ??
    (await post(`/courses/${course.id}/modules`, {
      title: 'Your first functions',
    }));

  // Existing lessons in the module, by title (the detail view resolves titles).
  const existing = new Map(
    (course.modules?.find((m) => m.id === mod.id)?.lessons ?? []).map((l) => [
      l.title,
      l,
    ]),
  );

  for (const spec of LESSONS) {
    let lesson = existing.get(spec.title);
    if (!lesson) {
      lesson = await post(`/modules/${mod.id}/lessons`, {
        title: spec.title,
        type: spec.type,
        isFree: true,
        baseXp: spec.baseXp,
        baseCoins: spec.baseCoins,
      });
      await patch(`/lessons/${lesson.id}`, { contentJson: spec.content });
      console.log(`• lesson "${spec.title}" created`);
    }
    if (!spec.exercise) continue;

    const body = {
      language: 'python',
      timeLimitMs: 2000,
      memoryLimitKb: 128000,
      ...spec.exercise,
    };
    let exercise = await get(`/lessons/${lesson.id}/exercise/admin`);
    try {
      exercise = exercise
        ? await patch(`/exercises/${exercise.id}`, body)
        : await post(`/lessons/${lesson.id}/exercise`, body);
    } catch (err) {
      if (err.body?.code === 'LANGUAGE_NOT_SUPPORTED') {
        throw new Error(
          'The API cannot run Python. Start it with JUDGE0_URL (and JUDGE0_AUTH_TOKEN) pointing at a Judge0 instance, then re-run this script.',
        );
      }
      throw err;
    }
    const check = await post(`/exercises/${exercise.id}/verify`);
    if (!check.ok) {
      throw new Error(
        `Reference solution for "${spec.title}" did not pass (${check.verdict}): ${JSON.stringify(check.results.filter((r) => !r.passed))}${check.message ? `\n${check.message}` : ''}`,
      );
    }
    console.log(
      `• "${spec.title}": reference solution verified (${check.results.length} tests)`,
    );
  }

  if (course.status !== 'PUBLISHED') {
    await post(`/courses/${course.id}/publish`);
    console.log('• published');
  }
  console.log(
    `\n✅ Python Fundamentals ready — slug: ${SLUG} (${LESSONS.length} lessons, all free)`,
  );
}

main().catch((err) => {
  console.error(`\n❌ ${err.message}`);
  process.exit(1);
});
