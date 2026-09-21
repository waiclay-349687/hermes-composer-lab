import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  DEFAULT_SETTINGS,
  normalizeSettings,
  isHexColor,
} from "../src/settings.js";
import { markdownEdit } from "../src/markdown.js";
const edit = (text, key, shift = false) => {
  const e = markdownEdit(text, text.length, key, shift);
  if (!e) return null;
  for (const c of [...e.changes].reverse())
    text = text.slice(0, c.start) + c.insert + text.slice(c.end);
  return text;
};
test("legacy migration restores fade without inheriting trail/pulse controls", () =>
  assert.deepEqual(
    normalizeSettings({ caret: false, lists: false, pulse: true, trail: true }),
    { ...DEFAULT_SETTINGS, caret: false, lists: false },
  ));
test("custom color accepts only six-digit hex and normalizes case", () => {
  assert.equal(
    normalizeSettings({ colorMode: "custom", customColor: "#ABCDEF" })
      .customColor,
    "#abcdef",
  );
  for (const bad of ["red", "#fff", "url(x)", "var(--other)", null, 32]) {
    assert.equal(isHexColor(bad), false);
    assert.equal(
      normalizeSettings({ colorMode: "custom", customColor: bad }).colorMode,
      "theme",
    );
  }
});
test("theme is default; invalid persisted settings cannot inject CSS", () => {
  assert.deepEqual(normalizeSettings(null), DEFAULT_SETTINGS);
  assert.deepEqual(
    normalizeSettings({ caret: "yes", fade: "no", lists: 1 }),
    DEFAULT_SETTINGS,
  );
});
test("list Enter contract: bare Enter is never handled; Shift+Enter continues", () => {
  assert.equal(edit("1. hello", "Enter"), null);
  assert.equal(edit("1. hello", "Enter", true), "1. hello\n2. ");
});
test("task continuation resets checkbox", () =>
  assert.equal(edit("- [x] done", "Enter", true), "- [x] done\n- [ ] "));
test("empty list item exits cleanly", () =>
  assert.equal(edit("1. done\n2. ", "Enter", true), "1. done\n"));
test("Tab never intercepts ordinary prose", () => {
  assert.equal(edit("hello", "Tab"), null);
  assert.equal(edit("hello", "Tab", true), null);
});
test("top-level unindent removes markup and whitespace", () =>
  assert.equal(edit("1. hello", "Tab", true), "hello"));
test("runtime source has no direct submit, networking, timers or synthetic keys", () => {
  for (const file of fs.readdirSync("src").filter((f) => f.endsWith(".js"))) {
    const s = fs.readFileSync("src/" + file, "utf8");
    assert.doesNotMatch(
      s,
      /\b(?:requestSubmit|fetch|XMLHttpRequest|setInterval|setTimeout)\s*\(|new\s+KeyboardEvent|host\.request\s*\(|\.submit\s*\(/,
      file,
    );
  }
});
test("all explicitly rendered SDK Buttons carry non-submit type", () => {
  const s = fs.readFileSync("src/plugin.js", "utf8");
  const buttons = [...s.matchAll(/jsx\(Button,\s*\{([^}]+)/g)];
  assert.ok(buttons.length >= 3);
  for (const b of buttons) assert.match(b[1], /type:\s*['"]button['"]/);
});
