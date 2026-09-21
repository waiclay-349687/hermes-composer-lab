// Experimental DOM adapter: no host module imports or core file patches.
// It DOES mutate the host input DOM; this is not a supported SDK editor seam.
import { listRows, markdownEdit } from "./markdown.js";
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
    if (node.nodeType === 3 && left <= length) {
      const mark = node.parentElement;
      if (
        left === length &&
        mark?.hasAttribute("data-cl-marker") &&
        mark.nextSibling?.nodeType === 3
      )
        return [mark.nextSibling, 0];
      return [node, left];
    }
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
export function undecorate(editor) {
  for (const span of [
    ...editor.querySelectorAll("[data-cl-line], [data-cl-marker]"),
  ].reverse())
    span.replaceWith(...span.childNodes);
}
// Only structural changes rebuild rows. Plain typing keeps DOM/IME anchors stable.
const decoratedSignatures = new WeakMap();
export function decorate(editor) {
  const before = textOf(editor),
    s = getSelection();
  if (s?.rangeCount && editor.contains(s.anchorNode) && !s.isCollapsed) return;
  if (before.length > 16000 || before.split("\n").length > 150) return;
  if (editor.querySelector("div,p,ol,ul,li,pre")) return;
  const rows = listRows(before),
    lines = before.split("\n");
  const byLine = new Map();
  let position = 0;
  for (let i = 0; i < lines.length; i++) {
    const row = rows.find((r) => r.from === position);
    if (row) byLine.set(i, row);
    position += lines[i].length + 1;
  }
  const signature = JSON.stringify(
    lines.map((_, i) => {
      const r = byLine.get(i);
      return r ? [r.prefix, r.depth, r.task] : null;
    }),
  );
  const roots = [...editor.childNodes];
  const intact =
    roots.length === lines.length &&
    roots.every((n) => n.nodeType === 1 && n.hasAttribute("data-cl-line"));
  const markersIntact = roots.every(
    (n, i) =>
      !byLine.has(i) ||
      n.querySelector?.("[data-cl-marker]")?.textContent ===
        byLine.get(i).prefix,
  );
  if (intact && markersIntact && decoratedSignatures.get(editor) === signature)
    return;
  const offset = caretOffset(editor)?.length;
  undecorate(editor);
  if (!rows.length) {
    decoratedSignatures.delete(editor);
    if (offset != null) selectOffset(editor, offset);
    return;
  }
  const groups = [[]];
  for (const n of [...editor.childNodes]) {
    if (n.nodeType === 3 && n.data.includes("\n"))
      n.data.split("\n").forEach((part, i) => {
        if (i) {
          groups.at(-1).push(document.createElement("br"));
          groups.push([]);
        }
        if (part) groups.at(-1).push(document.createTextNode(part));
      });
    else {
      groups.at(-1).push(n);
      if (n.nodeName === "BR") groups.push([]);
    }
  }
  const frag = document.createDocumentFragment();
  groups.forEach((group, i) => {
    const line = document.createElement("span");
    line.dataset.clLine = "";
    for (const n of group) {
      if (n.nodeType === 3 && line.lastChild?.nodeType === 3)
        line.lastChild.appendData(n.data);
      else line.append(n);
    }
    const row = byLine.get(i);
    if (
      row &&
      line.firstChild?.nodeType === 3 &&
      line.firstChild.length >= row.prefix.length
    ) {
      const first = line.firstChild,
        suffix = first.splitText(row.prefix.length),
        mark = document.createElement("span");
      mark.dataset.clMarker = "";
      mark.contentEditable = "false";
      mark.dataset.clLabel =
        row.task === null
          ? /^[-+*]$/.test(row.label)
            ? "•"
            : row.label
          : row.task
            ? "☑"
            : "☐";
      mark.append(first);
      line.insertBefore(mark, suffix);
      line.dataset.clList = "";
      line.style.setProperty("--cl-indent", `${row.depth * 1.4}em`);
      line.style.setProperty(
        "--cl-marker-width",
        `${Math.max(1.7, row.label.length * 0.65 + 0.55)}em`,
      );
    }
    frag.append(line);
  });
  editor.replaceChildren(frag);
  if (textOf(editor) !== before) {
    undecorate(editor);
    throw new Error("List decoration changed Markdown");
  }
  decoratedSignatures.set(editor, signature);
  if (offset != null) selectOffset(editor, offset);
}
export const listEdit = markdownEdit;
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
  undecorate(editor);
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
  selectOffset(editor, edit.caret);
  editor.dispatchEvent(
    new InputEvent("input", {
      bubbles: true,
      inputType: "insertText",
      data: null,
    }),
  );
}
export function mountLists({ enabled, onError }) {
  const states = new Map();
  function attach(editor) {
    if (states.has(editor)) return;
    editor.dataset.clManaged = "";
    let composing = false,
      frame = 0;
    const observer = new MutationObserver(schedule);
    function schedule() {
      if (composing || frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        observer.disconnect();
        try {
          if (enabled()) decorate(editor);
          else {
            const n = caretOffset(editor)?.length;
            undecorate(editor);
            if (n != null && getSelection()?.isCollapsed)
              selectOffset(editor, n);
          }
        } catch (e) {
          onError(e);
        }
        observer.observe(editor, {
          childList: true,
          characterData: true,
          subtree: true,
        });
      });
    }
    const key = (e) => {
      if (
        !["Enter", "Tab", "Backspace"].includes(e.key) ||
        (e.key === "Enter" && !e.shiftKey)
      )
        return;
      if (
        !enabled() ||
        composing ||
        e.isComposing ||
        e.keyCode === 229 ||
        e.defaultPrevented ||
        !getSelection()?.isCollapsed
      )
        return;
      if (
        e.metaKey &&
        e.key === "Backspace" &&
        !e.ctrlKey &&
        !e.altKey &&
        !e.shiftKey &&
        editor.querySelector("[data-cl-line]")
      ) {
        const before = caretOffset(editor);
        if (before == null) return;
        const text = textOf(editor),
          offset = before.length,
          start = text.lastIndexOf("\n", offset - 1) + 1;
        const row = listRows(text).find((r) => r.from === start),
          from = row ? Math.min(offset, row.to) : start;
        const edit =
          from < offset
            ? {
                changes: [{ start: from, end: offset, insert: "" }],
                caret: from,
              }
            : row
              ? listEdit(text, offset, "Backspace", false)
              : null;
        if (edit) {
          e.preventDefault();
          e.stopImmediatePropagation();
          observer.disconnect();
          applyEdit(editor, edit);
          observer.observe(editor, {
            childList: true,
            characterData: true,
            subtree: true,
          });
          schedule();
        }
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      // A completion menu always wins, even if it is portal-rendered.
      if (
        document.querySelector(
          '[role="listbox"], [data-slot="composer-trigger-popover"]',
        )
      )
        return;
      const before = caretOffset(editor);
      if (before == null) return;
      const edit = listEdit(textOf(editor), before.length, e.key, e.shiftKey);
      if (!edit) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      observer.disconnect();
      applyEdit(editor, edit);
      observer.observe(editor, {
        childList: true,
        characterData: true,
        subtree: true,
      });
      schedule();
    };
    const begin = () => {
      composing = true;
      cancelAnimationFrame(frame);
      frame = 0;
    };
    const end = () => {
      composing = false;
      schedule();
    };
    editor.addEventListener("keydown", key, true);
    editor.addEventListener("compositionstart", begin);
    editor.addEventListener("compositionend", end);
    observer.observe(editor, {
      childList: true,
      characterData: true,
      subtree: true,
    });
    schedule();
    states.set(editor, {
      schedule,
      dispose() {
        editor.removeAttribute("data-cl-managed");
        observer.disconnect();
        cancelAnimationFrame(frame);
        editor.removeEventListener("keydown", key, true);
        editor.removeEventListener("compositionstart", begin);
        editor.removeEventListener("compositionend", end);
        const n = caretOffset(editor)?.length;
        undecorate(editor);
        if (n != null && getSelection()?.isCollapsed) selectOffset(editor, n);
      },
    });
  }
  const scan = () => {
    document.querySelectorAll(SELECTOR).forEach(attach);
    for (const [el, state] of states)
      if (!el.isConnected) {
        state.dispose();
        states.delete(el);
      }
  };
  // Only discover added/removed editors; do not rescan on text keystrokes.
  const rootObserver = new MutationObserver((records) => {
    if (
      records.some((r) =>
        [...r.addedNodes, ...r.removedNodes].some(
          (n) =>
            n.nodeType === 1 &&
            (n.matches?.(SELECTOR) || n.querySelector?.(SELECTOR)),
        ),
      )
    )
      scan();
  });
  rootObserver.observe(document.body, { childList: true, subtree: true });
  scan();
  return {
    refresh() {
      for (const s of states.values()) s.schedule();
    },
    dispose() {
      rootObserver.disconnect();
      for (const s of states.values()) s.dispose();
      states.clear();
    },
  };
}
