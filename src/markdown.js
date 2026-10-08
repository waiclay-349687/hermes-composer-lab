// Official CodeMirror Markdown commands + Lezer syntax, no second editor UI.
import { EditorState } from "@codemirror/state";
import {
  markdownLanguage,
  insertNewlineContinueMarkupCommand,
} from "@codemirror/lang-markdown";
import { syntaxTree, ensureSyntaxTree, indentUnit } from "@codemirror/language";
import { markerInfo, structuralEdit } from "./list-structure.js";
const continueMarkup = insertNewlineContinueMarkupCommand({
  nonTightLists: false,
});
// The host splits lines on "\n" only; a stray "\r" must stay a plain
// character so CodeMirror offsets equal host text offsets.
const LF = EditorState.lineSeparator.of("\n");
let cachedText = null,
  cachedState = null;
function stateFor(text, offset = 0, unit = "  ") {
  if (cachedText !== text) {
    cachedText = text;
    cachedState = EditorState.create({
      doc: text,
      extensions: [markdownLanguage, indentUnit.of(unit), LF],
    });
    ensureSyntaxTree(cachedState, text.length, 50);
  }
  if (!offset) return cachedState;
  // Selection-only transaction: reuses the already-parsed syntax tree.
  return cachedState.update({ selection: { anchor: offset } }).state;
}
export function listRows(text) {
  const state = stateFor(text),
    rows = [];
  syntaxTree(state).iterate({
    enter: (n) => {
      if (n.name === "ListItem") {
        const m = markerInfo(n.node, state.doc);
        if (m) rows.push(m);
      }
    },
  });
  return rows;
}
// The list row whose marker line contains `offset`, or null.
export function rowAt(text, offset) {
  if (offset < 0 || offset > text.length) return null;
  const state = stateFor(text, offset),
    line = state.doc.lineAt(offset);
  let item = null;
  for (
    let n = syntaxTree(state).resolveInner(
      Math.min(line.to, line.from + line.text.search(/\S|$/) + 1),
      1,
    );
    n;
    n = n.parent
  )
    if (n.name === "ListItem") {
      item = n;
      break;
    }
  const row = markerInfo(item, state.doc);
  return row && row.from === line.from ? { row, state } : null;
}
export function markdownEdit(text, offset, key, shift = false) {
  if (text.length > 24000 || offset < 0 || offset > text.length) return null;
  const hit = rowAt(text, offset);
  // Only explicit list rows get our key bindings. Code/ordinary lines pass through.
  if (!hit) return null;
  const { row, state } = hit;
  if (key === "Tab") return structuralEdit(text, state.doc, row, offset, key, shift);
  if (key === "Backspace") {
    // Structural only at the content start (after "- " or "- [ ] ") or inside
    // the leading indentation. Inside the marker / number / task box, at the
    // line start, or in the item text, Backspace stays a native 1-char delete.
    const atContent = offset === row.to || offset === row.contentFrom;
    const inIndent = offset > row.from && offset <= row.markFrom;
    if (!atContent && !inIndent) return null;
    return structuralEdit(text, state.doc, row, offset, key, false);
  }
  if (key !== "Enter" || !shift) return null;
  let transaction = null;
  continueMarkup({ state, dispatch: (tr) => (transaction = tr) });
  if (!transaction) return null;
  const changes = [];
  transaction.changes.iterChanges((from, to, _a, _b, insert) =>
    changes.push({ start: from, end: to, insert: insert.toString() }),
  );
  return { changes, caret: transaction.newSelection.main.head };
}
