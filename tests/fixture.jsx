import React, { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { useComposerUndo } from "@host/app/chat/composer/hooks/use-composer-undo.ts";
import {
  composerPlainText,
  normalizeComposerEditorDom,
  renderComposerContents,
  placeCaretAtOffset,
} from "@host/app/chat/composer/rich-editor.ts";
import { mountLists, textOf, listEdit } from "../src/editor.js";
import { mountCaret } from "../src/caret.js";
window.settings = { lists: true, caret: true, blink: true, trail: false };
window.fixtureErrors = [];
window.listEdit = listEdit;
function Editor() {
  const editorRef = useRef(null),
    composing = useRef(false);
  const [draft, setDraft] = useState("");
  const sync = () => {
    normalizeComposerEditorDom(editorRef.current);
    const t = composerPlainText(editorRef.current);
    setDraft(t);
    return t;
  };
  const { recordUndoPoint, undo, redo, resetUndoHistory } = useComposerUndo({
    editorRef,
    syncDraftFromEditor: sync,
  });
  window.fixture = {
    read: () => composerPlainText(editorRef.current),
    draft: () => draft,
    set(text) {
      renderComposerContents(editorRef.current, text);
      editorRef.current.focus();
      placeCaretAtOffset(editorRef.current, text.length);
      resetUndoHistory();
      sync();
    },
    caretAt(offset) {
      placeCaretAtOffset(editorRef.current, offset);
    },
    undo,
    redo,
  };
  return React.createElement(
    "div",
    {},
    React.createElement(
      "h2",
      {},
      "Composer Lab · isolated host-contract fixture",
    ),
    React.createElement("div", {
      id: "editor",
      "data-slot": "composer-rich-input",
      contentEditable: true,
      suppressContentEditableWarning: true,
      ref: editorRef,
      onBeforeInput: (e) => {
        if (!composing.current)
          recordUndoPoint({
            coalesce: e.nativeEvent.inputType === "insertText",
          });
      },
      onInput: () => {
        if (!composing.current) sync();
      },
      onCompositionStart: () => (composing.current = true),
      onCompositionEnd: () => {
        composing.current = false;
        sync();
      },
      onKeyDown: (e) => {
        if (e.nativeEvent.isComposing || composing.current || e.keyCode === 229)
          return;
        if ((e.metaKey || e.ctrlKey) && e.key === "z") {
          e.preventDefault();
          e.shiftKey ? redo() : undo();
        } else if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          window.submitted = composerPlainText(editorRef.current);
        }
      },
      onPaste: (e) => {
        e.preventDefault();
        recordUndoPoint();
        document.execCommand(
          "insertText",
          false,
          e.clipboardData.getData("text/plain"),
        );
      },
    }),
    React.createElement("pre", { id: "state" }, draft),
  );
}
createRoot(document.getElementById("root")).render(React.createElement(Editor));
window.lists = mountLists({
  enabled: () => settings.lists,
  onError: (e) => fixtureErrors.push(String(e)),
});
window.caret = mountCaret(() => settings);
