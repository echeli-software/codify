/**
 * Mount an Angular component as a Tiptap/ProseMirror node view.
 *
 * The component is a plain standalone component with signal inputs
 * `attrs` + `editable` and outputs `attrsChange` (partial patch) and
 * optionally `remove`. It is attached to the ApplicationRef so it change-
 * detects like any other view; ProseMirror owns the host element.
 */

import {
  ApplicationRef,
  createComponent,
  type ComponentRef,
  type EnvironmentInjector,
  type InputSignal,
  type OutputEmitterRef,
  type Type,
} from '@angular/core';
import type { NodeViewRenderer, NodeViewRendererProps } from '@tiptap/core';

export interface LessonNodeViewComponent {
  attrs: InputSignal<Record<string, unknown>>;
  editable: InputSignal<boolean>;
  attrsChange: OutputEmitterRef<Record<string, unknown>>;
  remove?: OutputEmitterRef<void>;
}

/** What the node views need from Angular's DI to mount components. */
export interface NodeViewHost {
  injector: EnvironmentInjector;
}

const INTERACTIVE =
  'input, textarea, select, button, label, option, [data-node-view-interactive]';

export function angularNodeView(
  component: Type<LessonNodeViewComponent>,
  host: NodeViewHost,
): NodeViewRenderer {
  return (props: NodeViewRendererProps) => {
    const { editor, getPos } = props;
    let node = props.node;
    const dom = document.createElement('div');
    dom.className = `cdf-node-view cdf-node-view--${node.type.name}`;
    dom.setAttribute('data-node-view', node.type.name);
    dom.contentEditable = 'false';

    const ref: ComponentRef<LessonNodeViewComponent> = createComponent(
      component,
      {
        environmentInjector: host.injector,
        hostElement: document.createElement('div'),
      },
    );
    dom.appendChild(ref.location.nativeElement);
    const appRef = host.injector.get(ApplicationRef);
    appRef.attachView(ref.hostView);

    const sync = (): void => {
      ref.setInput('attrs', { ...node.attrs });
      ref.setInput('editable', editor.isEditable);
      ref.changeDetectorRef.detectChanges();
    };
    sync();

    const subs = [
      ref.instance.attrsChange.subscribe((patch) => {
        const pos = typeof getPos === 'function' ? getPos() : undefined;
        if (typeof pos !== 'number') return;
        const current = editor.state.doc.nodeAt(pos);
        if (!current || current.type !== node.type) return;
        editor.view.dispatch(
          editor.state.tr.setNodeMarkup(pos, undefined, {
            ...current.attrs,
            ...patch,
          }),
        );
      }),
    ];
    if (ref.instance.remove) {
      subs.push(
        ref.instance.remove.subscribe(() => {
          const pos = typeof getPos === 'function' ? getPos() : undefined;
          if (typeof pos !== 'number') return;
          editor.view.dispatch(
            editor.state.tr.delete(pos, pos + node.nodeSize),
          );
          editor.commands.focus();
        }),
      );
    }

    return {
      dom,
      update: (next) => {
        if (next.type !== node.type) return false;
        node = next;
        sync();
        return true;
      },
      selectNode: () => dom.classList.add('is-selected'),
      deselectNode: () => dom.classList.remove('is-selected'),
      // Let form controls inside the view handle their own events.
      stopEvent: (event: Event) => {
        const target = event.target as HTMLElement | null;
        return !!target?.closest?.(INTERACTIVE) && dom.contains(target);
      },
      ignoreMutation: () => true,
      destroy: () => {
        subs.forEach((s) => s.unsubscribe());
        appRef.detachView(ref.hostView);
        ref.destroy();
      },
    };
  };
}
