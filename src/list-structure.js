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
// Replace an ordered item's number, keeping zero padding ("03." -> "02."). A
// width change ("9." -> "10.") shifts the item's continuation lines and
// children by the same amount so they stay attached to it.
function setNumber(text, info, n, changes) {
  if (info?.number == null || info.number === n) return;
  const end = info.markTo - info.delim.length,
    old = text.slice(info.markFrom, end),
    next = old.startsWith("0") ? String(n).padStart(old.length, "0") : String(n);
  if (next === old) return;
  changes.push({ start: info.markFrom, end, insert: next });
  shiftTail(text, info.item, next.length - old.length, changes);
}
// Renumber `items` (ordered list members) sequentially from `start`.
function renumber(text, items, doc, start, changes) {
  let n = start;
  for (const item of items) setNumber(text, markerInfo(item, doc), n++, changes);
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
    renumber(text, rest, doc, markerInfo(items[0], doc)?.number ?? 1, changes);
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
    if (idx === 0) {
      // The item's own lines/children move out with it, so they do not end up
      // as an indented orphan block under a plain paragraph.
      shiftTail(text, row.item, -(row.contentFrom - row.from), changes);
      if (list.name === "OrderedList") {
        // The next item now follows a paragraph (or the item's former child
        // list): only "1." may interrupt a paragraph, so restart there unless
        // it continues an ordered child list.
        const own = childList(row.item),
          ownRows =
            own?.name === "OrderedList"
              ? listItems(own).map((i) => markerInfo(i, doc)).filter(Boolean)
              : [];
        const start = ownRows.length ? (ownRows.at(-1).number ?? 0) + 1 : 1;
        renumber(text, items.slice(1), doc, start, changes);
      }
    } else if (list.name === "OrderedList") {
      // A middle item becomes a lazy continuation of the previous item.
      const first = markerInfo(items[0], doc)?.number ?? 1;
      renumber(text, items.slice(idx + 1), doc, first + idx, changes);
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
  if (list.name === "OrderedList" && later.length) {
    // Later siblings join the lifted item's own child list (if any): continue
    // its numbering instead of restarting at 1.
    const own = childList(row.item),
      ownRows = own?.name === "OrderedList"
        ? listItems(own).map((i) => markerInfo(i, doc)).filter(Boolean)
        : [];
    const start = ownRows.length ? (ownRows.at(-1).number ?? 0) + 1 : 1;
    renumber(text, later, doc, start, changes);
  }
  if (outer?.name === "OrderedList" && parent.number !== null) {
    const outerItems = listItems(outer),
      at = outerItems.findIndex((i) => sameNode(i, parentItem));
    renumber(text, outerItems.slice(at + 1), doc, parent.number + 2, changes);
  }
  return finish(changes, Math.max(offset, row.to));
}

// Markdown measures indentation in columns (a tab = up to 4). Prefix edits here
// count characters, so a list that uses tab indentation is left alone: Tab is
// consumed as a no-op (focus must not leave the composer), Backspace is native.
function usesTabIndent(text, row) {
  let top = row.item.parent;
  while (top.parent?.name === "ListItem") top = top.parent.parent;
  return /(^|\n)[ ]*\t/.test(text.slice(lineStart(text, top.from), top.to));
}
export function structuralEdit(text, doc, row, offset, key, shift) {
  if (usesTabIndent(text, row))
    return key === "Tab" ? { changes: [], caret: offset } : null;
  if (key === "Tab")
    return shift ? lift(text, doc, row, offset) : sink(text, doc, row, offset);
  if (key === "Backspace") return lift(text, doc, row, offset);
  return null;
}

// Make every ordered list in the draft sequential again after a line was
// removed / pasted / dropped (rules follow Markdown All in One's autoRenumber:
// keep each list's first number, count up per sibling). Lists written in the
// all-same-number style ("1. 1. 1.") are left alone, and so is anything while
// the caret sits inside an ordered marker (the user is editing that number).
export function orderedLists(tree) {
  const lists = [];
  tree.iterate({
    enter: (n) => {
      if (n.name === "OrderedList") lists.push(n.node);
    },
  });
  return lists;
}
// `starts`: each ordered list's first number BEFORE the edit (same order), so
// cutting the first item of a "1." list renumbers from 1 again, while a list
// the user started at 5 keeps starting at 5.
export function renumberDoc(text, doc, tree, caret, starts = null) {
  const lists = orderedLists(tree);
  if (starts && starts.length !== lists.length) starts = null;
  const changes = [];
  for (const [k, list] of lists.entries()) {
    const items = listItems(list),
      infos = items.map((i) => markerInfo(i, doc));
    if (infos.some((i) => !i || i.number === null)) continue;
    // Caret inside a number: the user is editing it, do not fight.
    if (caret != null && infos.some((i) => caret > i.markFrom && caret <= i.markTo))
      return null;
    if (infos.every((i) => i.number === infos[0].number) && infos.length > 1) continue;
    renumber(text, items, doc, starts?.[k] ?? infos[0].number, changes);
  }
  if (!changes.length) return null;
  return finish(changes, caret ?? 0);
}
