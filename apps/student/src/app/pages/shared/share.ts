/**
 * Share a link with the Web Share API when available (mobile browsers,
 * Capacitor web view) and fall back to copying it to the clipboard.
 */
export type ShareOutcome = 'shared' | 'copied' | 'cancelled' | 'failed';

export interface ShareInput {
  title?: string;
  text?: string;
  url: string;
}

export async function shareLink(
  input: ShareInput,
  nav: Partial<Navigator> | undefined = typeof navigator !== 'undefined'
    ? navigator
    : undefined,
): Promise<ShareOutcome> {
  if (nav && typeof nav.share === 'function') {
    try {
      await nav.share(input);
      return 'shared';
    } catch (err) {
      // The user dismissed the share sheet — not an error.
      if ((err as { name?: string })?.name === 'AbortError') return 'cancelled';
      // Otherwise fall through to the clipboard.
    }
  }
  try {
    if (nav?.clipboard && typeof nav.clipboard.writeText === 'function') {
      await nav.clipboard.writeText(input.url);
      return 'copied';
    }
  } catch {
    return 'failed';
  }
  return 'failed';
}
