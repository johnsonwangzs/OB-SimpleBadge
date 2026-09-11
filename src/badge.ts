import type { Editor, EditorPosition } from "obsidian";
import { isThemeColor, normalizeBadge, serializeBadges, type Badge } from "./model";

export function renderBadge(container: HTMLElement, badge: Badge): HTMLSpanElement {
  const { text, color } = normalizeBadge(badge);
  const span = container.createSpan({ cls: `badge badge-${isThemeColor(color) ? color : "custom"}`, text });
  if (!isThemeColor(color)) span.style.setProperty("--simple-badge-color", color);
  return span;
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
