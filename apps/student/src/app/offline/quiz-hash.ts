/**
 * Offline quiz answer check (docs/16 §5). Same algorithm as
 * `hashQuizAnswer` / `checkQuizAnswerHash` in @codify/lesson-schema —
 * SHA-256 over `salt \0 quizId \0 sorted-unique-option-ids joined by \u0001`
 * — duplicated here (≈15 lines, pinned by a spec vector) so the app shell
 * doesn't pull zod + the lesson schema into its initial bundle.
 */
export async function quizAnswerHash(
  salt: string,
  quizId: string,
  optionIds: readonly string[],
): Promise<string> {
  const canonical = [...new Set(optionIds)].sort().join('\u0001');
  const data = new TextEncoder().encode(
    `${salt}\u0000${quizId}\u0000${canonical}`,
  );
  const digest = await globalThis.crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function checkQuizAnswer(
  expectedHash: string,
  salt: string,
  quizId: string,
  selected: readonly string[],
): Promise<boolean> {
  return (await quizAnswerHash(salt, quizId, selected)) === expectedHash;
}
