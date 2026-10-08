// Line-based list structure edits. Only leading indentation and list markers
// change: item text, task boxes, bullet characters and ordered delimiters are
// preserved byte-for-byte (no Markdown re-serialization).
const LIST_NODES = new Set(["BulletList", "OrderedList"]);

export function lineStart(text, pos) {
  return text.lastIndexOf("\n", pos - 1) + 1;
}

// Marker facts for one Lezer ListItem node. Offsets are absolute in `doc`.
export function markerInfo(item, doc) {
  const mark = item?.getChild("ListMark");
  if (!mark) return null;
  const line = doc.lineAt(mark.from);
  const space = /^[ \t]*/.exec(doc.sliceString(mark.to, line.to))[0];
  if (!space) return null;
  const contentFrom = mark.to + space.length;
  let to = contentFrom,
    task = null;
  const m = /^\[([ xX])\][ \t]+/.exec(doc.sliceString(contentFrom, line.to));
  if (m) {
    task = m[1].toLowerCase() === "x";
    to += m[0].length;
  }
  let depth = 0;
  for (let n = item.parent?.parent; n; n = n.parent)
    if (n.name === "ListItem") depth++;
  const label = doc.sliceString(mark.from, mark.to);
  const num = /^\d+/.exec(label);
  return {
    from: line.from,
    markFrom: mark.from,
    markTo: mark.to,
    contentFrom,
    to,
    indent: mark.from - line.from,
    prefix: doc.sliceString(line.from, to),
    label,
    number: num ? Number(num[0]) : null,
    delim: num ? label.slice(num[0].length) : null,
    task,
    depth,
    item,
  };
}

function itemLineStarts(text, item) {
  let end = item.to;
  while (end > item.from && text[end - 1] === "\n") end--;
  const last = lineStart(text, end),
    out = [];
  for (let p = lineStart(text, item.from); p <= last; ) {
    out.push(p);
    const nl = text.indexOf("\n", p);
    if (nl < 0) break;
    p = nl + 1;
  }
  return out;
}

function shiftLine(text, start, delta, changes) {
  if (!delta) return;
  const nl = text.indexOf("\n", start),
    line = text.slice(start, nl < 0 ? text.length : nl);
  if (!line.trim()) return;
  if (delta > 0) changes.push({ start, end: start, insert: " ".repeat(delta) });
  else {
    const k = Math.min(-delta, /^ */.exec(line)[0].length);
    if (k) changes.push({ start, end: start + k, insert: "" });
  }
}

const listItems = (list) => list.getChildren("ListItem");
const sameNode = (a, b) => a.from === b.from && a.to === b.to;
function childList(item) {
  let last = null;
  for (let c = item.firstChild; c; c = c.nextSibling)
    if (LIST_NODES.has(c.name)) last = c;
  return last;
}
function setNumber(info, n, changes) {
  if (info?.number == null || info.number === n) return;
  changes.push({
    start: info.markFrom,
    end: info.markFrom + String(info.number).length,
    insert: String(n),
  });
}
// Renumber `items` (ordered list members) sequentially from `start`.
function renumber(items, doc, start, changes) {
  let n = start;
  for (const item of items) setNumber(markerInfo(item, doc), n++, changes);
}

export function mapPos(changes, pos) {
  let delta = 0;
  for (const c of changes) {
    if (c.end <= pos) delta += c.insert.length - (c.end - c.start);
    else if (c.start < pos) return c.start + delta + c.insert.length;
    else break;
  }
  return pos + delta;
}

function finish(changes, caret) {
  changes.sort((a, b) => a.start - b.start || a.end - b.end);
  for (let i = 1; i < changes.length; i++)
    if (changes[i].start < changes[i - 1].end)
      throw new Error("List edit produced overlapping changes");
  return { changes, caret: mapPos(changes, caret) };
}

// Rewrite the row's indentation + marker; returns the content-column shift.
function relabel(row, indent, label, changes) {
  changes.push({
    start: row.from,
    end: row.markTo,
    insert: " ".repeat(indent) + label,
  });
  const space = row.contentFrom - row.markTo;
  return indent + label.length + space - (row.contentFrom - row.from);
}
function shiftTail(text, item, delta, changes) {
  for (const s of itemLineStarts(text, item).slice(1))
    shiftLine(text, s, delta, changes);
}

function sink(text, doc, row, offset) {
  const list = row.item.parent,
    items = listItems(list),
    idx = items.findIndex((i) => sameNode(i, row.item));
  const noop = { changes: [], caret: offset };
  if (idx <= 0) return noop;
  const prev = markerInfo(items[idx - 1], doc);
  if (!prev) return noop;
  const sub = childList(items[idx - 1]);
  let indent, label;
  if (sub) {
    const subRows = listItems(sub)
      .map((i) => markerInfo(i, doc))
      .filter(Boolean);
    if (!subRows.length) return noop;
    const last = subRows.at(-1);
    indent = subRows[0].indent;
    label =
      last.number !== null
        ? `${last.number + 1}${last.delim}`
        : row.number === null
          ? row.label
          : last.label;
  } else {
    indent = prev.contentFrom - prev.from;
    label = row.number !== null ? `1${row.delim}` : row.label;
  }
  const changes = [];
  shiftTail(text, row.item, relabel(row, indent, label, changes), changes);
  if (list.name === "OrderedList") {
    const rest = items.filter((_, i) => i !== idx);
    renumber(rest, doc, markerInfo(items[0], doc)?.number ?? 1, changes);
  }
  return finish(changes, Math.max(offset, row.to));
}

function lift(text, doc, row, offset) {
  const list = row.item.parent,
    parentItem = list.parent,
    items = listItems(list),
    idx = items.findIndex((i) => sameNode(i, row.item)),
    changes = [];
  if (parentItem?.name !== "ListItem") {
    // Top level: drop the marker; the line becomes plain text.
    changes.push({ start: row.from, end: row.to, insert: "" });
    if (list.name === "OrderedList") {
      const first = markerInfo(items[0], doc)?.number ?? 1;
      renumber(items.slice(idx + 1), doc, idx === 0 ? first : first + idx, changes);
    }
    return finish(changes, Math.max(offset, row.to));
  }
  const parent = markerInfo(parentItem, doc),
    outer = parentItem.parent;
  if (!parent) return { changes: [], caret: offset };
  const label =
    parent.number !== null ? `${parent.number + 1}${parent.delim}` : parent.label;
  shiftTail(text, row.item, relabel(row, parent.indent, label, changes), changes);
  // Later siblings become children of the lifted item (document order is kept).
  const later = items.slice(idx + 1);
  const pad =
    parent.indent + label.length + (row.contentFrom - row.markTo) - row.indent;
  if (pad > 0)
    for (const item of later)
      for (const s of itemLineStarts(text, item)) shiftLine(text, s, pad, changes);
  if (list.name === "OrderedList") renumber(later, doc, 1, changes);
  if (outer?.name === "OrderedList" && parent.number !== null) {
    const outerItems = listItems(outer),
      at = outerItems.findIndex((i) => sameNode(i, parentItem));
    renumber(outerItems.slice(at + 1), doc, parent.number + 2, changes);
  }
  return finish(changes, Math.max(offset, row.to));
}

export function structuralEdit(text, doc, row, offset, key, shift) {
  if (key === "Tab")
    return shift ? lift(text, doc, row, offset) : sink(text, doc, row, offset);
  if (key === "Backspace") return lift(text, doc, row, offset);
  return null;
}
