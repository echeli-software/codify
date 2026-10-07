/**
 * Rendering contract (docs/06 §5). Framework-agnostic so this lib stays
 * free of Angular: the UI libs instantiate it with `Type<unknown>`.
 *
 * The admin (Bootstrap) and student (Ionic) apps each provide an
 * implementation; `resolve()` returning `null` means "use the default
 * renderer for this block". A resolved component receives the inputs
 * described by `BlockRenderInputs`.
 */

import type { AnyBlockNode, BlockType } from './types.js';

export interface BlockRendererProtocol<TComponent = unknown> {
  /** Component class for a given block type, or null for the default. */
  resolve(blockType: BlockType | string): TComponent | null;
}

/** Inputs every resolved block component receives. */
export interface BlockRenderInputs<N extends AnyBlockNode = AnyBlockNode> {
  node: N;
}

/** Payload emitted when the student activates a ref block (runner mount). */
export type LessonRefActivation =
  | { kind: 'exercise'; id: string }
  | { kind: 'aiPrompt'; id: string }
  | { kind: 'scenario'; id: string };
