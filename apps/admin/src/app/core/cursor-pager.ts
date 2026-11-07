/**
 * Back/forward over keyset-paged API lists (`nextCursor` only): keeps the
 * cursor that loaded each visited page so "previous" can reload it.
 */
export class CursorPager {
  /** Cursor that loaded each visited page; [0] is the first page. */
  private stack: (string | undefined)[] = [undefined];

  /** Cursor for the page currently shown. */
  get current(): string | undefined {
    return this.stack[this.stack.length - 1];
  }

  /** 1-based number of the page currently shown. */
  get page(): number {
    return this.stack.length;
  }

  get canGoBack(): boolean {
    return this.stack.length > 1;
  }

  /** Move forward to the page `next` loads; returns that cursor. */
  forward(next: string): string {
    this.stack.push(next);
    return next;
  }

  /** Move back one page; returns the cursor that reloads it. */
  back(): string | undefined {
    if (this.stack.length > 1) this.stack.pop();
    return this.current;
  }

  reset(): void {
    this.stack = [undefined];
  }
}
