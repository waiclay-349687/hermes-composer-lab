import { SELECTOR } from "./surface.js";
import { isHexColor } from "./settings.js";
import { caretRect } from "./editor.js";
// Movement uses one temporary overlay. At rest CSS animates ONLY the native
// caret-color: no idle clock, synthetic keystroke, focus(), or text color change.
export function mountCaret(settings) {
  const styled = new Map();
  const supportsFade = CSS.supports("caret-animation", "manual");
  function styleEditor(el) {
    if (!styled.has(el))
      styled.set(el, {
        value: el.style.getPropertyValue("--cl-caret-color"),
        priority: el.style.getPropertyPriority("--cl-caret-color"),
      });
    const cfg = settings();
    el.dataset.clCursorStyle = "";
    el.toggleAttribute("data-cl-soft", !!cfg.fade && supportsFade);
    el.style.setProperty(
      "--cl-caret-color",
      cfg.colorMode === "custom" && isHexColor(cfg.customColor)
        ? cfg.customColor
        : "var(--ui-accent, currentColor)",
    );
  }
  function unstyle(el, saved) {
    for (const a of el.getAnimations())
      if (a.animationName === "cl-native-fade") a.cancel();
    el.removeAttribute("data-cl-soft");
    el.removeAttribute("data-cl-cursor-style");
    if (saved.value)
      el.style.setProperty("--cl-caret-color", saved.value, saved.priority);
    else el.style.removeProperty("--cl-caret-color");
  }
  function scan() {
    document.querySelectorAll(SELECTOR).forEach((el) => {
      if (!styled.has(el)) styleEditor(el);
    });
    for (const [el, saved] of styled)
      if (!el.isConnected) {
        unstyle(el, saved);
        styled.delete(el);
      }
  }
  let scanFrame = 0;
  const discovery = new MutationObserver((records) => {
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
  discovery.observe(document.body, { childList: true, subtree: true });
  scan();
  const layer = document.createElement("div");
  layer.className = "cl-caret-layer";
  layer.hidden = true;
  layer.setAttribute("aria-hidden", "true");
  const cursor = document.createElement("i");
  cursor.className = "cl-caret";
  layer.append(cursor);
  document.body.append(layer);
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  let editor = null,
    previous = null,
    animation = null,
    frame = 0,
    composing = false,
    compositionEditor = null,
    disposed = false,
    generation = 0;
  let lastNode = null,
    lastAt = "";
  function restartFade(el) {
    for (const a of el.getAnimations())
      if (a.animationName === "cl-native-fade") a.currentTime = 0;
  }
  function stop() {
    generation++;
    animation?.cancel();
    animation = null;
    layer.hidden = true;
    editor?.removeAttribute("data-cl-caret");
  }
  function release() {
    stop();
    previous = null;
  }
  function measure() {
    const next = document.activeElement?.closest?.(SELECTOR),
      s = getSelection();
    if (next !== editor) {
      release();
      editor = next;
    }
    // Fade restarts fully opaque whenever the caret moves or text changes,
    // like a native caret; it only fades while the caret rests.
    if (editor?.isConnected && s?.rangeCount && editor.contains(s.focusNode)) {
      const at = `${s.focusOffset}`;
      if (s.focusNode !== lastNode || at !== lastAt) {
        lastNode = s.focusNode;
        lastAt = at;
        restartFade(editor);
      }
    }
    const ime = composing && editor === compositionEditor;
    if (
      !settings().caret ||
      reduced.matches ||
      !editor?.isConnected ||
      document.hidden ||
      !s?.rangeCount ||
      (!s.isCollapsed && !ime) ||
      !editor.contains(s.focusNode)
    ) {
      release();
      return;
    }
    const r = document.createRange();
    r.setStart(s.focusNode, s.focusOffset);
    r.collapse(true);
    // No trustworthy box (between elements, empty line): show the native
    // caret instead of guessing a position.
    const q = caretRect(r),
      bounds = editor.getBoundingClientRect();
    if (
      !q?.height ||
      q.top < bounds.top - 1 ||
      q.top > bounds.bottom ||
      q.left < bounds.left - 2 ||
      q.left > bounds.right + 2
    ) {
      release();
      return;
    }
    if (!previous) {
      previous = { x: q.left, y: q.top };
      return;
    }
    if (
      Math.abs(previous.x - q.left) < 0.5 &&
      Math.abs(previous.y - q.top) < 0.5
    )
      return;
    const from =
      animation && !layer.hidden
        ? cursor.getBoundingClientRect()
        : { left: previous.x, top: previous.y };
    stop();
    previous = { x: q.left, y: q.top };
    if (
      Math.abs(from.left - q.left) > 260 ||
      Math.abs(from.top - q.top) > q.height * 2.2
    )
      return;
    editor.dataset.clCaret = "";
    layer.hidden = false;
    const cs = getComputedStyle(editor);
    cursor.style.background =
      cs.getPropertyValue("--cl-caret-color").trim() || cs.color;
    cursor.style.height = `${Math.min(q.height, 32)}px`;
    cursor.style.transform = `translate3d(${q.left}px,${q.top}px,0)`;
    const token = ++generation;
    animation = cursor.animate(
      [
        { transform: `translate3d(${from.left}px,${from.top}px,0)` },
        { transform: `translate3d(${q.left}px,${q.top}px,0)` },
      ],
      { duration: ime ? 190 : 165, easing: "cubic-bezier(.16,1,.3,1)" },
    );
    animation.finished.then(
      () => {
        if (!disposed && token === generation) stop();
      },
      () => {},
    );
  }
  function update() {
    frame = 0;
    if (disposed) return;
    try {
      measure();
    } catch {
      release();
    }
    if (
      composing &&
      !document.hidden &&
      document.activeElement === compositionEditor
    )
      schedule();
  }
  function schedule() {
    if (!disposed && !frame) frame = requestAnimationFrame(update);
  }
  const start = (e) => {
    if (e.target.closest?.(SELECTOR)) {
      composing = true;
      compositionEditor = e.target.closest(SELECTOR);
      schedule();
    }
  };
  const end = () => {
    composing = false;
    compositionEditor = null;
    schedule();
  };
  // compositionend can be lost (focus jump, input-source switch): recover on
  // the next non-composing key or when focus leaves, like the host does.
  const heal = (e) => {
    if (composing && !e.isComposing && e.keyCode !== 229) end();
  };
  const leave = () => {
    if (composing) end();
    else schedule();
  };
  const events = [
    ["selectionchange", schedule],
    ["input", () => {
      lastAt = "";
      schedule();
    }],
    ["focusin", schedule],
    ["focusout", leave],
    ["keydown", heal],
    ["scroll", schedule],
    ["visibilitychange", schedule],
    ["compositionstart", start],
    ["compositionupdate", schedule],
    ["compositionend", end],
  ];
  for (const [type, fn] of events) document.addEventListener(type, fn, true);
  window.addEventListener("resize", schedule);
  reduced.addEventListener("change", schedule);
  schedule();
  return {
    refresh() {
      for (const el of styled.keys()) styleEditor(el);
      schedule();
    },
    dispose() {
      disposed = true;
      discovery.disconnect();
      cancelAnimationFrame(scanFrame);
      for (const [el, saved] of styled) unstyle(el, saved);
      styled.clear();
      release();
      cancelAnimationFrame(frame);
      for (const [t, f] of events) document.removeEventListener(t, f, true);
      window.removeEventListener("resize", schedule);
      reduced.removeEventListener("change", schedule);
      layer.remove();
    },
  };
}
