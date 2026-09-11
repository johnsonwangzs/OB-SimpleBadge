import type { Editor, EditorPosition, MarkdownFileInfo } from "obsidian";

export interface EditorTarget {
  position: EditorPosition;
  isValid(): boolean;
}

// Capture the editor, not a file path: several Canvas cards can share one file.
export function captureEditorTarget(
  editor: Editor,
  info: MarkdownFileInfo,
  isAvailable: () => boolean,
  getRevision: () => number,
): EditorTarget {
  const file = info.file;
  const text = editor.getValue();
  const revision = getRevision();
  return {
    position: { ...editor.getCursor("to") },
    isValid: () => isAvailable() && info.file === file
      && (info.editor === undefined || info.editor === editor)
      && getRevision() === revision && editor.getValue() === text,
  };
}
