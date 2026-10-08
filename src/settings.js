export const DEFAULT_SETTINGS = Object.freeze({
  caret: true,
  fade: true,
  colorMode: "theme",
  customColor: "",
  lists: true,
  renumber: true,
});
export const isHexColor = (value) =>
  typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
export function normalizeSettings(raw) {
  const v = raw && typeof raw === "object" ? raw : {};
  return {
    caret: typeof v.caret === "boolean" ? v.caret : true,
    fade: typeof v.fade === "boolean" ? v.fade : true,
    colorMode:
      v.colorMode === "custom" && isHexColor(v.customColor)
        ? "custom"
        : "theme",
    customColor: isHexColor(v.customColor) ? v.customColor.toLowerCase() : "",
    lists: typeof v.lists === "boolean" ? v.lists : true,
    renumber: typeof v.renumber === "boolean" ? v.renumber : true,
  };
}
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
