// Caret effects are independent axes; presets are named combinations of them.
export const CARET_AXES = Object.freeze({
  shape: ["bar", "block", "underline"],
  motion: ["glide", "spring", "instant"],
  rest: ["fade", "breathe", "blink", "steady"],
  trail: ["none", "ink"],
  typing: ["none", "ripple", "sparks"],
});
const EFFECT_DEFAULTS = {
  shape: "bar",
  motion: "glide",
  rest: "fade",
  glow: false,
  aurora: false,
  trail: "none",
  typing: "none",
};
export const DEFAULT_SETTINGS = Object.freeze({
  ...EFFECT_DEFAULTS,
  colorMode: "theme",
  customColor: "",
  lists: true,
  renumber: true,
});
export const PRESETS = Object.freeze([
  { id: "fade", name: "柔和渐隐", tag: "安静", values: {} },
  { id: "glow", name: "微光呼吸", tag: "神秘", values: { rest: "breathe", glow: true } },
  { id: "ink", name: "墨迹余韵", tag: "神秘", values: { trail: "ink" } },
  { id: "spring", name: "弹性跟随", tag: "灵动", values: { motion: "spring" } },
  { id: "block", name: "终端方块", tag: "复古", values: { shape: "block", motion: "instant", rest: "blink" } },
  { id: "underline", name: "下划线", tag: "极简", values: { shape: "underline" } },
  { id: "ripple", name: "落字涟漪", tag: "灵动", values: { typing: "ripple" } },
  { id: "aurora", name: "极光流转", tag: "华丽", values: { aurora: true } },
  { id: "sparks", name: "打字火花", tag: "热闹", values: { typing: "sparks" } },
]);
export const presetValues = (preset) => ({ ...EFFECT_DEFAULTS, ...preset.values });
export function matchPreset(settings) {
  return (
    PRESETS.find((p) => {
      const v = presetValues(p);
      return Object.keys(EFFECT_DEFAULTS).every((k) => settings[k] === v[k]);
    })?.id ?? null
  );
}
export const isHexColor = (value) =>
  typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
const pick = (value, allowed, fallback) =>
  allowed.includes(value) ? value : fallback;
const bool = (value, fallback) => (typeof value === "boolean" ? value : fallback);
export function normalizeSettings(raw) {
  const v = raw && typeof raw === "object" ? raw : {};
  // 0.3/0.4 stored `caret` (smooth movement) and `fade` booleans.
  const legacyMotion = v.caret === false ? "instant" : undefined;
  const legacyRest = v.fade === false ? "blink" : undefined;
  return {
    shape: pick(v.shape, CARET_AXES.shape, "bar"),
    motion: pick(v.motion ?? legacyMotion, CARET_AXES.motion, "glide"),
    rest: pick(v.rest ?? legacyRest, CARET_AXES.rest, "fade"),
    glow: bool(v.glow, false),
    aurora: bool(v.aurora, false),
    trail: pick(v.trail, CARET_AXES.trail, "none"),
    typing: pick(v.typing, CARET_AXES.typing, "none"),
    colorMode:
      v.colorMode === "custom" && isHexColor(v.customColor) ? "custom" : "theme",
    customColor: isHexColor(v.customColor) ? v.customColor.toLowerCase() : "",
    lists: bool(v.lists, true),
    renumber: bool(v.renumber, true),
  };
}
// Effects the native caret cannot draw need the persistent overlay caret.
export const needsOverlay = (s) =>
  s.shape !== "bar" || s.glow || s.aurora || s.rest === "breathe";
export function themeHex() {
  const probe = document.createElement("span");
  probe.style.color = "var(--ui-accent, currentColor)";
  document.body.append(probe);
  const color = getComputedStyle(probe).color;
  probe.remove();
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 1, 1);
  return (
    "#" +
    [...ctx.getImageData(0, 0, 1, 1).data]
      .slice(0, 3)
      .map((n) => n.toString(16).padStart(2, "0"))
      .join("")
  );
}
