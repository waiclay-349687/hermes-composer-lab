import { SELECTOR } from "./surface.js";
import { isHexColor, needsOverlay } from "./settings.js";
import { caretRect } from "./editor.js";
// One caret is ever visible. Two render modes:
//  - native: the browser caret draws at rest (CSS animates only caret-color);
//    the overlay appears just for the glide between positions;
//  - overlay: effects the native caret cannot draw (block / underline shape,
//    glow, breathing, aurora) use a persistent overlay while the native caret
//    is transparent. Whenever the position is not trustworthy the overlay is
//    released and the native caret shows again.
// Transient effects (ink trail, ripples, sparks) live on a separate fx layer.
const MAX_FX = 24;
export function mountCaret(settings) {
  const styled = new Map();
  const supportsManual = CSS.supports("caret-animation", "manual");
  function styleEditor(el) {
    if (!styled.has(el))
      styled.set(el, {
        value: el.style.getPropertyValue("--cl-caret-color"),
        priority: el.style.getPropertyPriority("--cl-caret-color"),
      });
    const cfg = settings();
    el.dataset.clCursorStyle = "";
    el.toggleAttribute("data-cl-soft", cfg.rest === "fade" && supportsManual);
    el.toggleAttribute("data-cl-steady", cfg.rest === "steady" && supportsManual);
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
    el.removeAttribute("data-cl-steady");
    el.removeAttribute("data-cl-cursor-style");
    el.removeAttribute("data-cl-caret");
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
  const core = document.createElement("b");
  core.className = "cl-caret-core";
  cursor.append(core);
  layer.append(cursor);
  const fx = document.createElement("div");
  fx.className = "cl-fx-layer";
  fx.setAttribute("aria-hidden", "true");
  document.body.append(layer, fx);
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  let editor = null,
    previous = null,
    animation = null,
    frame = 0,
    composing = false,
    compositionEditor = null,
    disposed = false,
    generation = 0,
    burst = false,
    resting = false;
  let lastNode = null,
    lastAt = "";
  function restartRest(el) {
    for (const a of el.getAnimations())
      if (/^cl-(native-fade|rest-)/.test(a.animationName)) a.currentTime = 0;
  }
  function stop() {
    generation++;
    animation?.cancel();
    animation = null;
    resting = false;
    layer.hidden = true;
    editor?.removeAttribute("data-cl-caret");
  }
  function release() {
    stop();
    previous = null;
  }
  // Paint the cursor box for the current settings at rect q.
  function paint(q, cfg, persistent) {
    const cs = getComputedStyle(editor);
    const color = cs.getPropertyValue("--cl-caret-color").trim() || cs.color;
    cursor.style.setProperty("--cl-c", color);
    const h = Math.min(q.height, 32);
    let w = 2,
      dy = 0,
      ch = h;
    if (persistent && cfg.shape !== "bar") {
      w = Math.max(6, Math.round(q.charWidth || h * 0.5));
      if (cfg.shape === "underline") {
        dy = h - 2;
        ch = 2;
      }
    }
    core.style.width = `${w}px`;
    core.style.height = `${ch}px`;
    core.style.transform = dy ? `translateY(${dy}px)` : "";
    cursor.className =
      "cl-caret" +
      (persistent
        ? ` cl-shape-${cfg.shape} cl-rest-${cfg.rest}` +
          (cfg.glow ? " cl-glow" : "") +
          (cfg.aurora ? " cl-aurora" : "")
        : "");
  }
  function charWidthAt(r) {
    const n = r.startContainer,
      o = r.startOffset;
    if (n.nodeType !== 3 || o >= n.length || n.data[o] === "\n") return 0;
    const probe = document.createRange();
    probe.setStart(n, o);
    probe.setEnd(n, o + 1);
    return probe.getBoundingClientRect().width;
  }
  function spawn(el, keyframes, ms) {
    if (fx.childElementCount >= MAX_FX) fx.firstElementChild?.remove();
    fx.append(el);
    const a = el.animate(keyframes, { duration: ms, easing: "cubic-bezier(.2,.8,.3,1)" });
    a.finished.then(() => el.remove(), () => el.remove());
  }
  function inkTrail(from, q, color) {
    if (Math.abs(from.top - q.top) > q.height / 2) return;
    const dx = q.left - from.left;
    if (Math.abs(dx) < 4) return;
    const el = document.createElement("i");
    el.className = "cl-ink";
    el.style.setProperty("--cl-c", color);
    el.style.left = `${Math.min(from.left, q.left)}px`;
    el.style.top = `${q.top}px`;
    el.style.width = `${Math.abs(dx)}px`;
    el.style.height = `${Math.min(q.height, 32)}px`;
    el.style.background = `linear-gradient(${dx > 0 ? 90 : 270}deg, transparent, color-mix(in srgb, ${color} 50%, transparent))`;
    spawn(el, [{ opacity: 0.9, filter: "blur(0)" }, { opacity: 0, filter: "blur(3px)" }], 420);
  }
  function typingBurst(q, kind, color) {
    const x = q.left,
      y = q.top + Math.min(q.height, 32) / 2;
    if (kind === "ripple") {
      const el = document.createElement("i");
      el.className = "cl-ripple";
      el.style.setProperty("--cl-c", color);
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
      spawn(el, [{ transform: "scale(1)", opacity: 0.8 }, { transform: "scale(5)", opacity: 0 }], 600);
      return;
    }
    for (let k = 0; k < 3; k++) {
      const el = document.createElement("i");
      el.className = "cl-spark";
      el.style.setProperty("--cl-c", color);
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
      const dx = (Math.random() - 0.3) * 26,
        dy = -8 - Math.random() * 14;
      spawn(
        el,
        [{ transform: "translate(0,0)", opacity: 1 }, { transform: `translate(${dx}px,${dy}px)`, opacity: 0 }],
        420 + Math.random() * 200,
      );
    }
  }
  function measure() {
    const next = document.activeElement?.closest?.(SELECTOR),
      s = getSelection();
    if (next !== editor) {
      release();
      editor = next;
    }
    const cfg = settings();
    const moved =
      editor?.isConnected &&
      s?.rangeCount &&
      editor.contains(s.focusNode) &&
      (s.focusNode !== lastNode || `${s.focusOffset}` !== lastAt);
    if (moved) {
      lastNode = s.focusNode;
      lastAt = `${s.focusOffset}`;
      restartRest(editor);
      restartRest(core);
    }
    const ime = composing && editor === compositionEditor;
    if (
      reduced.matches ||
      !editor?.isConnected ||
      document.hidden ||
      !s?.rangeCount ||
      (!s.isCollapsed && !ime) ||
      !editor.contains(s.focusNode)
    ) {
      burst = false;
      release();
      return;
    }
    const persistent = needsOverlay(cfg);
    if (!persistent && cfg.motion === "instant" && cfg.trail === "none" && cfg.typing === "none") {
      burst = false;
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
      burst = false;
      release();
      return;
    }
    q.charWidth = persistent && cfg.shape !== "bar" ? charWidthAt(r) : 0;
    const cs = getComputedStyle(editor);
    const color = cs.getPropertyValue("--cl-caret-color").trim() || cs.color;
    if (burst) {
      burst = false;
      if (cfg.typing !== "none") typingBurst(q, cfg.typing, color);
    }
    const same =
      previous &&
      Math.abs(previous.x - q.left) < 0.5 &&
      Math.abs(previous.y - q.top) < 0.5;
    if (persistent) {
      // Keep the overlay up at rest; refresh its look/size even when still.
      paint(q, cfg, true);
      if (same && (resting || animation)) return;
    } else if (!previous || same) {
      previous = { x: q.left, y: q.top };
      return;
    }
    const from =
      animation && !layer.hidden
        ? cursor.getBoundingClientRect()
        : previous
          ? { left: previous.x, top: previous.y }
          : null;
    stop();
    previous = { x: q.left, y: q.top };
    if (from && cfg.trail === "ink" && !same) inkTrail(from, q, color);
    const far =
      !from ||
      Math.abs(from.left - q.left) > 260 ||
      Math.abs(from.top - q.top) > q.height * 2.2;
    const animate = cfg.motion !== "instant" && !far && !same;
    if (!persistent && !animate) return;
    editor.dataset.clCaret = "";
    layer.hidden = false;
    paint(q, cfg, persistent);
    cursor.style.transform = `translate3d(${q.left}px,${q.top}px,0)`;
    const token = ++generation;
    if (!animate) {
      resting = persistent;
      return;
    }
    const spring = cfg.motion === "spring";
    animation = cursor.animate(
      [
        { transform: `translate3d(${from.left}px,${from.top}px,0)` },
        { transform: `translate3d(${q.left}px,${q.top}px,0)` },
      ],
      spring
        ? { duration: 300, easing: "cubic-bezier(.34,1.56,.64,1)" }
        : { duration: ime ? 190 : 165, easing: "cubic-bezier(.16,1,.3,1)" },
    );
    animation.finished.then(
      () => {
        if (disposed || token !== generation) return;
        animation = null;
        if (persistent) resting = true;
        else stop();
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
  const end = (e) => {
    const committed = composing && e?.type === "compositionend" && e.data;
    composing = false;
    compositionEditor = null;
    if (committed) burst = true;
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
  const input = (e) => {
    lastAt = "";
    if (
      !e.isComposing &&
      /^insert(Text|ReplacementText|FromPaste)?$/.test(e.inputType || "") &&
      e.target.closest?.(SELECTOR)
    )
      burst = true;
    schedule();
  };
  const events = [
    ["selectionchange", schedule],
    ["input", input],
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
      release();
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
      fx.remove();
    },
  };
}
