#!/usr/bin/env node
/**
 * Seeds one clean, fully-free, published "Codify Demo" course that exercises
 * every interactive lesson type (reading, exercise, AI prompt, scenario) so a
 * human can walk the whole experience end-to-end and earn a certificate.
 *
 *   node tools/scripts/seed-demo-course.mjs
 */

const API = 'http://localhost:3000/api';
const A = { 'content-type': 'application/json', authorization: 'Bearer dev-token-admin' };
const post = async (p, b) => {
  const r = await fetch(API + p, { method: 'POST', headers: { ...A, 'idempotency-key': crypto.randomUUID() }, body: JSON.stringify(b) });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`${p} → ${r.status}: ${JSON.stringify(j)}`);
  return j;
};
const patch = async (p, b) => {
  const r = await fetch(API + p, { method: 'PATCH', headers: { ...A, 'idempotency-key': crypto.randomUUID() }, body: JSON.stringify(b) });
  if (!r.ok) throw new Error(`PATCH ${p} → ${r.status}: ${await r.text()}`);
  return r.json().catch(() => null);
};

const reading = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Welcome to Codify' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'This short demo course shows every kind of lesson: a reading, a coding exercise, an AI-graded answer, and a branching scenario. Finish them all to earn a certificate.' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'Tip: each completed lesson awards XP and coins, and keeps your daily streak alive.' }] },
  ],
};

async function main() {
  const sfx = Date.now().toString(36);
  const cat = await post('/categories', { slug: `demo-${sfx}`, name: 'Demo' });
  const course = await post('/courses', { slug: `codify-demo-${sfx}`, title: 'Codify Demo', description: 'A guided tour of every lesson type.', categoryIds: [cat.id] });
  const mod = await post(`/courses/${course.id}/modules`, { title: 'The grand tour' });

  // 1. Reading (content saved via the lesson update endpoint, not create)
  const l1 = await post(`/modules/${mod.id}/lessons`, { title: 'Welcome (reading)', type: 'READING', isFree: true, baseXp: 10, baseCoins: 5 });
  await patch(`/lessons/${l1.id}`, { contentJson: reading });

  // 2. Exercise
  const l2 = await post(`/modules/${mod.id}/lessons`, { title: 'Sum two numbers (exercise)', type: 'EXERCISE', isFree: true, baseXp: 25, baseCoins: 12 });
  await post(`/lessons/${l2.id}/exercise`, {
    language: 'javascript', entryFunction: 'solution',
    starterCode: 'function solution(a, b) {\n  // return the sum of a and b\n}',
    solutionCode: 'function solution(a, b) { return a + b; }',
    visibleTests: [ { id: 'v1', name: '1 + 2 = 3', args: [1, 2], expected: 3 }, { id: 'v2', name: '0 + 0 = 0', args: [0, 0], expected: 0 } ],
    hiddenTests: [ { id: 'h1', name: 'negatives', args: [-4, 1], expected: -3 } ],
  });

  // 3. AI prompt
  const l3 = await post(`/modules/${mod.id}/lessons`, { title: 'Explain error handling (AI-graded)', type: 'AI_PROMPT', isFree: true, baseXp: 30, baseCoins: 15 });
  await post(`/lessons/${l3.id}/ai-prompt`, {
    promptText: 'Explain how to handle errors in JavaScript and why it matters.',
    contextText: 'Audience: a beginner. 2–4 sentences.',
    passThreshold: 70,
    rubric: [
      { id: 'kw', label: 'Mentions try/catch', weight: 2, kind: 'keyword', config: { all: ['try', 'catch'] } },
      { id: 'len', label: 'Explains in enough detail', weight: 1, kind: 'minWords', config: { min: 20 } },
      { id: 'why', label: 'Explains WHY it matters', weight: 2, kind: 'llm', config: { concepts: ['crash', 'user', 'recover', 'graceful'] } },
    ],
  });

  // 4. Scenario
  const l4 = await post(`/modules/${mod.id}/lessons`, { title: 'The angry customer (scenario)', type: 'SCENARIO', isFree: true, baseXp: 28, baseCoins: 14 });
  await post(`/lessons/${l4.id}/scenario`, {
    graph: {
      startId: 'start',
      nodes: {
        start: { id: 'start', speaker: 'Customer', text: 'My order never arrived and no one told me!', choices: [ { id: 'a', label: 'Apologise and investigate', to: 'mid' }, { id: 'b', label: 'Blame the courier', ending: true, outcome: 'bailed' } ] },
        mid: { id: 'mid', speaker: 'Customer', text: 'Okay… so what are you going to do about it?', choices: [ { id: 'x', label: 'Offer a refund or reship', ending: true, outcome: 'resolved' }, { id: 'y', label: 'Tell them to be patient', ending: true, outcome: 'escalated' } ] },
      },
    },
  });

  await post(`/courses/${course.id}/publish`, {});
  console.log(`\n✅ Seeded "Codify Demo" — slug: codify-demo-${sfx}`);
  console.log(`   Lessons: reading, exercise, AI prompt, scenario (all free).`);
  console.log(`   Open the student app → Catalog → "Codify Demo".`);
}

main().catch((e) => { console.error('❌', e.message); process.exit(1); });
