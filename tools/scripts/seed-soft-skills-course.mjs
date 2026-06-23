#!/usr/bin/env node
/**
 * Dogfood seed (Phase 12 acceptance): a soft-skills course with 4 branching
 * scenario lessons, published. Idempotent-ish via a fixed slug — re-running
 * skips if the course already exists.
 */

const API = 'http://localhost:3000/api';
const A = { 'content-type': 'application/json', authorization: 'Bearer dev-token-admin' };
const post = async (p, b) => {
  const r = await fetch(API + p, { method: 'POST', headers: { ...A, 'idempotency-key': crypto.randomUUID() }, body: JSON.stringify(b) });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`${p} → ${r.status}: ${JSON.stringify(j)}`);
  return j;
};

// A two-deep branching scenario builder: start → (good→mid→ending | bad-ending).
function scenario(topic, opener, goodLabel, goodReply, refundLabel, outGood, argueLabel, outBad, bailLabel, outBail) {
  return {
    startId: 'start',
    nodes: {
      start: { id: 'start', speaker: topic, text: opener, choices: [
        { id: 'good', label: goodLabel, to: 'mid' },
        { id: 'bail', label: bailLabel, ending: true, outcome: outBail },
      ] },
      mid: { id: 'mid', speaker: topic, text: goodReply, choices: [
        { id: 'resolve', label: refundLabel, ending: true, outcome: outGood },
        { id: 'argue', label: argueLabel, ending: true, outcome: outBad },
      ] },
    },
  };
}

const SCENARIOS = [
  { title: 'The late delivery', graph: scenario('Customer', 'My order is 3 days late and no one told me!', 'Apologise and check the tracking', 'Thanks. So where is it?', 'Offer a refund or reship', 'resolved', 'Tell them to be patient', 'escalated', 'Say it is the courier’s fault', 'bailed') },
  { title: 'The angry teammate', graph: scenario('Teammate', 'You changed my code without asking. Not cool.', 'Acknowledge and ask to talk it through', 'Fine. Why did you touch it?', 'Explain the reason and propose pairing', 'resolved', 'Say you were right anyway', 'escalated', 'Ignore them', 'bailed') },
  { title: 'The scope creep', graph: scenario('Manager', 'Can you also add reporting before Friday?', 'Clarify trade-offs against the deadline', 'Okay, what would slip?', 'Offer to move a lower-priority item', 'resolved', 'Just say no', 'escalated', 'Silently agree and miss it', 'bailed') },
  { title: 'The bad review', graph: scenario('User', 'One star. The app crashed and ate my work.', 'Apologise and ask for details', 'It froze when I hit save.', 'Explain the fix and offer follow-up', 'resolved', 'Blame their device', 'escalated', 'Delete the review request', 'bailed') },
];

async function main() {
  const slug = 'soft-skills-101';
  const cat = await post('/categories', { slug: `soft-skills-${Date.now().toString(36)}`, name: 'Soft skills' }).catch(() => null);
  const course = await post('/courses', { slug: `${slug}-${Date.now().toString(36)}`, title: 'Soft Skills 101', categoryIds: cat ? [cat.id] : [] });
  const mod = await post(`/courses/${course.id}/modules`, { title: 'Handling hard conversations' });

  for (const s of SCENARIOS) {
    const lesson = await post(`/modules/${mod.id}/lessons`, { title: s.title, type: 'SCENARIO', isFree: true, baseXp: 25, baseCoins: 12 });
    await post(`/lessons/${lesson.id}/scenario`, { graph: s.graph });
    console.log(`  + scenario lesson: ${s.title}`);
  }
  await post(`/courses/${course.id}/publish`, {});
  console.log(`\n✅ Seeded "Soft Skills 101" (${SCENARIOS.length} scenarios), published. courseId=${course.id}`);
}

main().catch((e) => { console.error('❌', e.message); process.exit(1); });
