// Experimental DOM adapter: no host module imports or core file patches.
// Marker styling never touches the host DOM (CSS Custom Highlight API). Only an
// explicit list key (⇧Enter / Tab / ⇧Tab / ⌫ / ⌘⌫ on a list row) edits the host
// text, in the host's own shape (text nodes + <br>). Not a supported SDK seam.
import { listRows, markdownEdit, rowAt } from "./markdown.js";
import { SELECTOR } from "./surface.js";
export { SELECTOR };
export const LIST = /^( *)(\d{1,6}[.)]|[-+*])([ \t]+)(.*)$/;
export function textOf(node) {
  if (node.nodeType === 3) return node.data;
  if (node.nodeType !== 1 && node.nodeType !== 11) return "";
  if (node.dataset?.refText) return node.dataset.refText;
  if (
    node.matches?.(SELECTOR) &&
    node.childNodes.length === 1 &&
    node.firstChild.nodeName === "BR"
  )
    return "";
  if (node.nodeName === "BR") return "\n";
  const text = [...node.childNodes].map(textOf).join("");
  return /^(DIV|P)$/.test(node.nodeName) && !node.matches?.(SELECTOR) && text
    ? text + "\n"
    : text;
}
export function caretOffset(editor) {
  const s = getSelection();
  if (
    !s?.rangeCount ||
    !editor.contains(s.anchorNode) ||
    !editor.contains(s.focusNode)
  )
    return null;
  const r = s.getRangeAt(0).cloneRange();
  r.selectNodeContents(editor);
  r.setEnd(s.focusNode, s.focusOffset);
  const box = document.createElement("span");
  box.append(r.cloneContents());
  return textOf(box);
}
function units(root) {
  const out = [];
  const visit = (n) => {
    if (n.nodeType === 3) out.push({ node: n, length: n.length });
    else if (n.nodeType === 1 && (n.dataset.refText || n.nodeName === "BR"))
      out.push({ node: n, length: n.dataset.refText?.length || 1 });
    else for (const c of n.childNodes) visit(c);
  };
  visit(root);
  return out;
}
export function pointAt(editor, offset) {
  let left = offset;
  for (const { node, length } of units(editor)) {
    if (node.nodeType === 3 && left <= length) return [node, left];
    if (node.nodeType === 1 && left < length)
      return [node.parentNode, [...node.parentNode.childNodes].indexOf(node)];
    left -= length;
  }
  return [editor, editor.childNodes.length];
}
export function selectOffset(editor, offset) {
  const [node, n] = pointAt(editor, offset);
  const r = document.createRange();
  r.setStart(node, n);
  r.collapse(true);
  const s = getSelection();
  s.removeAllRanges();
  s.addRange(r);
}
// Remove DOM wrappers left by Composer Lab <= 0.3.x (block line spans and
// contenteditable=false markers). 0.4+ never restructures the host editor.
export function undecorate(editor) {
  const legacy = [
    ...editor.querySelectorAll("[data-cl-line], [data-cl-marker]"),
  ].reverse();
  if (!legacy.length) return false;
  for (const span of legacy) span.replaceWith(...span.childNodes);
  editor.normalize();
  return true;
}
// Chromium sometimes leaves <div>/<p> wrappers mid-draft. The host serializer
// counts a virtual "\n" after each block that has no DOM position of its own,
// so text offsets and DOM points cannot be mapped 1:1: stay hands-off.
export const hasBlocks = (editor) => !!editor.querySelector("div,p");
const MAYBE_LIST = /^[ \t]*(?:[-+*]|\d{1,9}[.)])(?:[ \t]|$)/m;
// Marker styling uses the CSS Custom Highlight API: ranges over the host's own
// text nodes, zero DOM mutation, so caret movement, IME, selection, deletion and
// the host serializer all see exactly the DOM the host rendered.
export const HIGHLIGHTS = { mark: "cl-list-mark", task: "cl-list-task" };
export function markerRanges(editor) {
  if (hasBlocks(editor)) return [];
  const text = textOf(editor);
  if (!MAYBE_LIST.test(text)) return [];
  if (text.length > 16000 || text.split("\n").length > 400) return [];
  const rows = listRows(text);
  if (!rows.length) return [];
  // One pass over the DOM units, binary search per offset.
  const list = units(editor),
    starts = [];
  let acc = 0;
  for (const u of list) {
    starts.push(acc);
    acc += u.length;
  }
  const point = (offset) => {
    let lo = 0,
      hi = list.length - 1,
      i = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (starts[mid] <= offset) {
        i = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    // Prefer the text node that ENDS at offset over an element starting there.
    for (let k = Math.max(0, i - 1); k <= i && k < list.length; k++) {
      const { node, length } = list[k],
        left = offset - starts[k];
      if (node.nodeType === 3 && left >= 0 && left <= length) return [node, left];
    }
    if (i >= 0 && list[i].node.nodeType === 1) {
      const n = list[i].node,
        idx = [...n.parentNode.childNodes].indexOf(n);
      return [n.parentNode, offset - starts[i] < list[i].length ? idx : idx + 1];
    }
    return [editor, editor.childNodes.length];
  };
  const range = (a, b) => {
    const r = document.createRange();
    r.setStart(...point(a));
    r.setEnd(...point(b));
    return r;
  };
  const out = [];
  for (const row of rows) {
    out.push({ kind: "mark", range: range(row.markFrom, row.markTo) });
    if (row.task !== null)
      out.push({ kind: "task", range: range(row.contentFrom, row.to) });
  }
  return out;
}
export const listEdit = markdownEdit;
// ⌘⌫ on a list row deletes the item text but keeps the marker; at the marker
// it behaves like ⌫ (outdent / remove marker).
export function cmdBackspace(text, offset) {
  const hit = rowAt(text, offset);
  if (!hit) return null;
  const { row } = hit;
  if (offset > row.to)
    return { changes: [{ start: row.to, end: offset, insert: "" }], caret: row.to };
  return listEdit(text, offset, "Backspace", false);
}
export function applyEdit(editor, edit) {
  if (!edit.changes.length) return;
  // Preserve the host undo history via its React textInput compatibility path.
  editor.dispatchEvent(
    new InputEvent("textInput", {
      bubbles: true,
      data: "\n",
      inputType: "insertFromPaste",
    }),
  );
  for (const change of [...edit.changes].reverse()) {
    const r = document.createRange();
    r.setStart(...pointAt(editor, change.start));
    r.setEnd(...pointAt(editor, change.end));
    r.deleteContents();
    const frag = document.createDocumentFragment();
    change.insert.split("\n").forEach((t, i) => {
      if (i) frag.append(document.createElement("br"));
      if (t) frag.append(document.createTextNode(t));
    });
    r.insertNode(frag);
  }
  editor.normalize();
  // A caret after a trailing line break has no line box to sit on: Chromium
  // would draw (and type) it at the end of the previous line. Add the same
  // placeholder break Chromium itself adds on a native Shift+Enter at the end.
  const text = textOf(editor);
  if (edit.caret >= text.length && text.endsWith("\n")) {
    editor.append(document.createElement("br"));
    const r = document.createRange();
    r.setStartBefore(editor.lastChild);
    r.collapse(true);
    getSelection().removeAllRanges();
    getSelection().addRange(r);
  } else selectOffset(editor, edit.caret);
  revealCaret(editor);
  editor.dispatchEvent(
    new InputEvent("input", {
      bubbles: true,
      inputType: "insertText",
      data: null,
    }),
  );
}
// Client rect of a collapsed caret, including element positions (after a
// <br> or chip) where Chromium reports no box. null when unknowable.
export function caretRect(range) {
  const q = range.getClientRects()[0];
  if (q?.height) return { left: q.left, top: q.top, bottom: q.bottom, height: q.height };
  const n = range.startContainer,
    o = range.startOffset;
  if (n.nodeType === 3) {
    if (!n.length) return null;
    const probe = document.createRange();
    probe.setStart(n, Math.max(0, o - 1));
    probe.setEnd(n, Math.min(n.length, Math.max(o, 1)));
    const rects = probe.getClientRects(),
      b = o ? rects[rects.length - 1] : rects[0];
    return b?.height
      ? { left: o ? b.right : b.left, top: b.top, bottom: b.bottom, height: b.height }
      : null;
  }
  if (n.nodeType !== 1) return null;
  const after = n.childNodes[o],
    before = n.childNodes[o - 1];
  if (after?.nodeName === "BR") {
    const b = after.getBoundingClientRect();
    if (b.height) return { left: b.left, top: b.top, bottom: b.bottom, height: b.height };
  }
  if (before?.nodeType === 1 && before.dataset?.refText) {
    const b = before.getBoundingClientRect();
    if (b.height) return { left: b.right, top: b.top, bottom: b.bottom, height: b.height };
  }
  if (before?.nodeType === 3 && before.length) {
    const r = document.createRange();
    r.setStart(before, before.length);
    return caretRect(r);
  }
  if (after?.nodeType === 3 && after.length) {
    const r = document.createRange();
    r.setStart(after, 0);
    return caretRect(r);
  }
  return null;
}
// Keep the caret inside the editor's scrollport after a programmatic edit
// (native typing does this itself; Range edits do not).
export function revealCaret(editor) {
  const s = getSelection();
  if (!s?.rangeCount || !editor.isConnected) return;
  const q = caretRect(s.getRangeAt(0));
  if (!q) return;
  const box = editor.getBoundingClientRect(),
    pad = 4;
  if (q.bottom > box.bottom - pad) editor.scrollTop += q.bottom - box.bottom + pad;
  else if (q.top < box.top + pad) editor.scrollTop -= box.top + pad - q.top;
}
// A completion drawer owned by this composer wins every key we would take.
function completionOpen(editor) {
  if (editor.getAttribute("aria-expanded") === "true") return true;
  const root =
    editor.closest('[data-slot="composer-root"],[data-slot="aui_edit-composer-root"]') ||
    document;
  return !!(
    document.querySelector(
      '[data-slot="composer-completion-drawer"],[data-slot="composer-trigger-popover"]',
    ) || root.querySelector('[role="listbox"]')
  );
}
// The host consumes Tab for "@path" descent and for committing a typed
// "/command arg" even before (or without) a visible drawer.
export function triggerTokenBeforeCaret(text, offset) {
  const line = text.slice(text.lastIndexOf("\n", offset - 1) + 1, offset);
  return /(?:^|\s)[@/]\S*$/.test(line) || /^\s*(?:[-+*]|\d+[.)])\s+\/\S+\s/.test(line);
}
// Does the caret sit on the same visual line as text offset `at`?
function sameVisualLine(editor, at) {
  const s = getSelection();
  if (!s?.rangeCount) return false;
  const here = caretRect(s.getRangeAt(0)),
    r = document.createRange();
  r.setStart(...pointAt(editor, at));
  const there = caretRect(r);
  return !!(here && there && Math.abs(here.top - there.top) < Math.min(here.height, there.height) / 2);
}
export function mountLists({ enabled, onError }) {
  const states = new Map();
  const canHighlight =
    typeof Highlight === "function" && !!globalThis.CSS?.highlights;
  function paint() {
    if (!canHighlight) return;
    const groups = { mark: [], task: [] };
    for (const st of states.values())
      for (const r of st.ranges) groups[r.kind].push(r.range);
    for (const [kind, name] of Object.entries(HIGHLIGHTS))
      if (groups[kind].length)
        CSS.highlights.set(name, new Highlight(...groups[kind]));
      else CSS.highlights.delete(name);
  }
  function attach(editor) {
    if (states.has(editor)) return;
    editor.dataset.clManaged = "";
    undecorate(editor);
    const st = { ranges: [], frame: 0, composing: false };
    const observer = new MutationObserver(() => schedule());
    function measure() {
      st.frame = 0;
      try {
        st.ranges =
          enabled() && canHighlight && editor.isConnected
            ? markerRanges(editor)
            : [];
      } catch (e) {
        st.ranges = [];
        onError(e);
      }
      paint();
    }
    function schedule() {
      if (st.composing || st.frame) return;
      st.frame = requestAnimationFrame(measure);
    }
    function run(e, edit) {
      e.preventDefault();
      e.stopImmediatePropagation();
      try {
        applyEdit(editor, edit);
      } catch (err) {
        onError(err);
      }
      schedule();
    }
    const key = (e) => {
      // Self-heal a composition flag whose compositionend never arrived
      // (focus jump / input-source switch), exactly like the host does.
      if (st.composing && !e.isComposing && e.keyCode !== 229) {
        st.composing = false;
        schedule();
      }
      if (
        !["Enter", "Tab", "Backspace"].includes(e.key) ||
        (e.key === "Enter" && !e.shiftKey)
      )
        return;
      if (
        !enabled() ||
        st.composing ||
        e.isComposing ||
        e.keyCode === 229 ||
        e.defaultPrevented ||
        !getSelection()?.isCollapsed
      )
        return;
      if (e.key === "Backspace" && e.metaKey) {
        if (e.ctrlKey || e.altKey || e.shiftKey) return;
      } else if (e.metaKey || e.ctrlKey || e.altKey || completionOpen(editor))
        return;
      if (hasBlocks(editor)) return;
      const before = caretOffset(editor);
      if (before == null) return;
      const text = textOf(editor),
        // An editor holding only its placeholder <br> serializes as "" while a
        // caret after that <br> measures 1: clamp so they always agree.
        offset = Math.min(before.length, text.length);
      if (e.key === "Tab" && triggerTokenBeforeCaret(text, offset)) return;
      let edit = null;
      try {
        if (e.metaKey) {
          edit = cmdBackspace(text, offset);
          // On a soft-wrapped item, ⌘⌫ deletes the visual line natively.
          const row = edit && rowAt(text, offset)?.row;
          if (row && offset > row.to && !sameVisualLine(editor, row.to)) return;
        } else edit = listEdit(text, offset, e.key, e.shiftKey);
      } catch (err) {
        // Planning failed before touching the DOM: leave the key to the host.
        console.warn("[composer-lab] list key skipped:", err);
        return;
      }
      if (edit) run(e, edit);
    };
    const begin = () => {
      st.composing = true;
      cancelAnimationFrame(st.frame);
      st.frame = 0;
    };
    const end = () => {
      st.composing = false;
      schedule();
    };
    editor.addEventListener("keydown", key, true);
    editor.addEventListener("compositionstart", begin);
    editor.addEventListener("compositionend", end);
    editor.addEventListener("blur", end);
    observer.observe(editor, {
      childList: true,
      characterData: true,
      subtree: true,
    });
    schedule();
    states.set(editor, {
      get ranges() {
        return st.ranges;
      },
      schedule,
      dispose() {
        editor.removeAttribute("data-cl-managed");
        observer.disconnect();
        cancelAnimationFrame(st.frame);
        editor.removeEventListener("keydown", key, true);
        editor.removeEventListener("compositionstart", begin);
        editor.removeEventListener("compositionend", end);
        editor.removeEventListener("blur", end);
        st.ranges = [];
      },
    });
  }
  const scan = () => {
    document.querySelectorAll(SELECTOR).forEach(attach);
    let removed = false;
    for (const [el, state] of states)
      if (!el.isConnected) {
        state.dispose();
        states.delete(el);
        removed = true;
      }
    if (removed) paint();
  };
  // Discover added/removed editors at most once per frame: one native
  // querySelectorAll instead of walking every node the transcript streams in.
  let scanFrame = 0;
  const rootObserver = new MutationObserver((records) => {
    if (scanFrame) return;
    for (const r of records)
      if (r.addedNodes.length || r.removedNodes.length) {
        scanFrame = requestAnimationFrame(() => {
          scanFrame = 0;
          scan();
        });
        return;
      }
  });
  rootObserver.observe(document.body, { childList: true, subtree: true });
  scan();
  return {
    refresh() {
      for (const s of states.values()) s.schedule();
    },
    dispose() {
      rootObserver.disconnect();
      cancelAnimationFrame(scanFrame);
      for (const s of states.values()) s.dispose();
      states.clear();
      if (canHighlight)
        for (const name of Object.values(HIGHLIGHTS)) CSS.highlights.delete(name);
    },
  };
}
