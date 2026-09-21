// Official CodeMirror Markdown commands + Lezer syntax, no second editor UI.
import { EditorState } from "@codemirror/state";
import {
  markdownLanguage,
  insertNewlineContinueMarkupCommand,
  deleteMarkupBackward,
} from "@codemirror/lang-markdown";
import { syntaxTree, ensureSyntaxTree, indentUnit } from "@codemirror/language";
import { structuralEdit } from "./list-structure.js";
const continueMarkup = insertNewlineContinueMarkupCommand({
  nonTightLists: false,
});
let cachedText = null,
  cachedState = null;
function stateFor(text, offset = 0, unit = "  ") {
  if (cachedText !== text) {
    cachedText = text;
    cachedState = EditorState.create({
      doc: text,
      extensions: [markdownLanguage, indentUnit.of(unit)],
    });
    ensureSyntaxTree(cachedState, text.length, 50);
  }
  // Configure indentation on the command state, not on any host editor.
  const state = EditorState.create({
    doc: cachedState.doc,
    selection: { anchor: offset },
    extensions: [markdownLanguage, indentUnit.of(unit)],
  });
  ensureSyntaxTree(state, text.length, 50);
  return state;
}
function marker(item, doc) {
  const mark = item?.getChild("ListMark");
  if (!mark) return null;
  const line = doc.lineAt(mark.from),
    prefix = doc.sliceString(line.from, mark.to);
  const after = doc.sliceString(mark.to, line.to),
    space = /^[ \t]*/.exec(after)[0];
  if (!space) return null;
  let end = mark.to + space.length,
    task = null;
  const m = /^\[([ xX])\][ \t]+/.exec(doc.sliceString(end, line.to));
  if (m) {
    task = m[1].toLowerCase() === "x";
    end += m[0].length;
  }
  let depth = 0;
  for (let n = item.parent?.parent; n; n = n.parent)
    if (n.name === "ListItem") depth++;
  return {
    from: line.from,
    markFrom: mark.from,
    to: end,
    indent: mark.from - line.from,
    prefix: doc.sliceString(line.from, end),
    label: doc.sliceString(mark.from, mark.to),
    task,
    depth,
    item,
  };
}
export function listRows(text) {
  const state = stateFor(text),
    rows = [];
  syntaxTree(state).iterate({
    enter: (n) => {
      if (n.name === "ListItem") {
        const m = marker(n.node, state.doc);
        if (m) rows.push(m);
      }
    },
  });
  return rows;
}
export function markdownEdit(text, offset, key, shift = false) {
  if (text.length > 24000) return null;
  let state = stateFor(text, offset),
    line = state.doc.lineAt(offset),
    item = null;
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
  const row = marker(item, state.doc);
  // Only explicit list-state rows get our key bindings. Code/ordinary lines pass through.
  if (!row || row.from !== line.from) return null;
  let transaction = null;
  const dispatch = (tr) => (transaction = tr);
  if (key === "Enter" && shift) continueMarkup({ state, dispatch });
  else if (key === "Tab" || (key === "Backspace" && offset <= row.to))
    return structuralEdit(text, Math.max(offset, row.to), key, shift, row);
  else if (key === "Backspace") deleteMarkupBackward({ state, dispatch });
  if (!transaction) return null;
  const changes = [];
  transaction.changes.iterChanges((from, to, _a, _b, insert) =>
    changes.push({ start: from, end: to, insert: insert.toString() }),
  );
  return { changes, caret: transaction.newSelection.main.head };
}
