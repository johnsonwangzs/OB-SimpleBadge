import type { Editor, EditorPosition } from "obsidian";
import { serializeBadges, type Badge } from "./model";

export function renderBadge(container: HTMLElement, badge: Badge): HTMLSpanElement {
  return container.createSpan({ cls: `badge badge-${badge.color}`, text: badge.text });
}

export function insertBadges(editor: Editor, position: EditorPosition, badges: readonly Badge[]): void {
  const text = serializeBadges(badges);
  if (!text) return;
  const cursor = { line: position.line, ch: position.ch + text.length };

  // One editor transaction preserves the surrounding text and undo history.
  editor.transaction({
    changes: [{ from: position, to: position, text }],
    selection: { from: cursor, to: cursor },
  }, "simple-badge");
  editor.focus();
}
