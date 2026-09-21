// ProseMirror's schema-list owns nesting/lifting/numbering. No EditorView,
// no replacement input, no focus or idle ownership. Changes map back to host text.
import { EditorState, TextSelection } from "prosemirror-state";
import {
  defaultMarkdownParser,
  defaultMarkdownSerializer,
} from "prosemirror-markdown";
import { sinkListItem, liftListItem } from "prosemirror-schema-list";
import { diffChars } from "diff";
export function structuralEdit(text, offset, key, shift, row) {
  let root = row.item.parent;
  while (root.parent?.name === "ListItem") root = root.parent.parent;
  if (root.parent?.name !== "Document") return null;
  const start = text.lastIndexOf("\n", root.from - 1) + 1,
    end = root.to,
    original = text.slice(start, end);
  let sentinel = "\uE000";
  while (text.includes(sentinel)) sentinel += "\uE001";
  const marked =
    original.slice(0, offset - start) +
    sentinel +
    original.slice(offset - start);
  const parsed = defaultMarkdownParser.parse(marked);
  let at = null;
  parsed.descendants((node, pos) => {
    if (node.isText && node.text.includes(sentinel))
      at = pos + node.text.indexOf(sentinel);
  });
  if (at === null) return null;
  let state = EditorState.create({
    doc: parsed,
    schema: defaultMarkdownParser.schema,
  });
  const clean = state.tr.delete(at, at + sentinel.length);
  state = state.apply(clean.setSelection(TextSelection.create(clean.doc, at)));
  let next = null;
  const command =
    key === "Tab" && !shift
      ? sinkListItem(state.schema.nodes.list_item)
      : liftListItem(state.schema.nodes.list_item);
  if (!command(state, (tr) => (next = state.apply(tr))))
    return { changes: [], caret: offset };
  const markerDoc = next.tr.insertText(sentinel, next.selection.head).doc;
  const serialized = defaultMarkdownSerializer.serialize(markerDoc, {
    tightLists: true,
  });
  const markerPos = serialized.indexOf(sentinel);
  if (markerPos < 0) throw new Error("List caret mapping failed");
  const updated = serialized.replace(sentinel, "");
  const changes = [];
  let pos = start;
  for (const part of diffChars(original, updated)) {
    if (part.removed) {
      changes.push({ start: pos, end: pos + part.value.length, insert: "" });
      pos += part.value.length;
    } else if (part.added) {
      const last = changes.at(-1);
      if (last?.end === pos) last.insert += part.value;
      else changes.push({ start: pos, end: pos, insert: part.value });
    } else pos += part.value.length;
  }
  return { changes, caret: start + markerPos };
}
