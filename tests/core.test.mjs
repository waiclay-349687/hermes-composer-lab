import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  DEFAULT_SETTINGS,
  PRESETS,
  matchPreset,
  normalizeSettings,
  presetValues,
  isHexColor,
} from "../src/settings.js";
import { markdownEdit, renumberEdit } from "../src/markdown.js";
const apply = (text, e) => {
  for (const c of [...e.changes].reverse())
    text = text.slice(0, c.start) + c.insert + text.slice(c.end);
  return text;
};
const edit = (text, key, shift = false) => {
  const e = markdownEdit(text, text.length, key, shift);
  return e ? apply(text, e) : null;
};
// `|` marks the caret; returns the edited text with `|` at the new caret.
const at = (marked, key, shift = false) => {
  const offset = marked.indexOf("|"),
    text = marked.replace("|", "");
  const e = markdownEdit(text, offset, key, shift);
  if (!e) return null;
  const out = apply(text, e);
  return out.slice(0, e.caret) + "|" + out.slice(e.caret);
};
test("legacy booleans migrate; unknown/legacy values never inject effects", () => {
  assert.deepEqual(
    normalizeSettings({ caret: false, fade: false, lists: false, pulse: true, trail: true }),
    { ...DEFAULT_SETTINGS, motion: "instant", rest: "blink", lists: false },
  );
  assert.deepEqual(normalizeSettings({ shape: "star", typing: "<b>" }), DEFAULT_SETTINGS);
});
test("every preset round-trips and is recognised", () => {
  for (const p of PRESETS) {
    const s = normalizeSettings({ ...DEFAULT_SETTINGS, ...presetValues(p) });
    assert.equal(matchPreset(s), p.id);
  }
  assert.equal(matchPreset(normalizeSettings({ glow: true })), null);
});
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
    normalizeSettings({ caret: "yes", fade: "no", lists: 1, glow: "on" }),
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
test("top-level Shift+Tab is a consumed no-op; Backspace removes the marker", () => {
  assert.deepEqual(markdownEdit("1. hello", 8, "Tab", true).changes, []);
  assert.equal(at("1. |hello", "Backspace"), "|hello");
});
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

test("Tab nests one level and keeps bullet characters and item text", () => {
  assert.equal(at("- alpha\n- be|ta", "Tab"), "- alpha\n  - be|ta");
  assert.equal(at("+ a\n+ b|", "Tab"), "+ a\n  + b|");
  assert.equal(at("- a_b *c*\n- x\\_y|", "Tab"), "- a_b *c*\n  - x\\_y|");
});
test("Tab on the first item is consumed without changes", () => {
  const e = markdownEdit("- a", 3, "Tab", false);
  assert.deepEqual(e.changes, []);
});
test("Tab keeps task boxes intact (no escaping)", () =>
  assert.equal(at("- [ ] task\n- [ ] t2|", "Tab"), "- [ ] task\n  - [ ] t2|"));
test("ordered Tab restarts at 1, keeps delimiter, renumbers the rest", () => {
  assert.equal(at("1) a\n2) b|\n3) c", "Tab"), "1) a\n   1) b|\n2) c");
  assert.equal(at("1. a\n2. b|\n3. c", "Tab"), "1. a\n   1. b|\n2. c");
});
test("Tab joins an existing sublist with its numbering", () =>
  assert.equal(
    at("1. a\n   1. x\n2. b|", "Tab"),
    "1. a\n   1. x\n   2. b|",
  ));
test("Shift+Tab lifts nested item after its parent and renumbers", () => {
  assert.equal(at("1. a\n   1. b|\n2. c", "Tab", true), "1. a\n2. b|\n3. c");
  assert.equal(at("- a\n  - b|\n  - c", "Tab", true), "- a\n- b|\n  - c");
});
test("Backspace at a top-level marker removes only its prefix", () => {
  assert.equal(at("- a\n- |b", "Backspace"), "- a\n|b");
  assert.equal(at("1) a\n2) |b\n3) c", "Backspace"), "1) a\n|b\n2) c");
});
test("Backspace right after the marker removes it; no blank lines or marker rewrites", () => {
  assert.equal(at("- a\n- |", "Backspace"), "- a\n|");
  assert.equal(at("- a\n- |b", "Backspace"), "- a\n|b");
  assert.equal(at("- a\n  - |b", "Backspace"), "- a\n- |b");
});
test("Backspace in item text or at line start is left to the host", () => {
  assert.equal(at("- a\n- b|", "Backspace"), null);
  assert.equal(at("- a\n|- b", "Backspace"), null);
});
test("nested children move with their item", () =>
  assert.equal(
    at("- a\n- b|\n  - c", "Tab"),
    "- a\n  - b|\n    - c",
  ));

test("Backspace inside a marker, number or task box deletes one character natively", () => {
  assert.equal(at("- [x|] todo", "Backspace"), null);
  assert.equal(at("12|. item", "Backspace"), null);
  assert.equal(at("1|. item", "Backspace"), null);
  assert.equal(at("- [ ] |todo", "Backspace"), "|todo");
});
test("CRLF drafts keep host offsets and never throw", () => {
  assert.doesNotThrow(() => markdownEdit("1. a\r\n2. b", 10, "Tab", false));
  assert.doesNotThrow(() => markdownEdit("1. a\r\n2. b", 10, "Enter", true));
});
test("out-of-range caret offsets are ignored", () => {
  assert.equal(markdownEdit("- a", 9, "Tab", false), null);
  assert.equal(markdownEdit("- a", -1, "Tab", false), null);
});

test("renumbering across a width change keeps children attached", () =>
  assert.equal(
    at("8. a\n   - b|\n9. c\n   - d", "Tab", true),
    "8. a\n9. b|\n10. c\n    - d",
  ));
test("lifting an item with children continues their numbering", () =>
  assert.equal(
    at("1. a\n   1. b|\n      1. x\n   2. c", "Tab", true),
    "1. a\n2. b|\n   1. x\n   2. c",
  ));
test("zero-padded numbers are replaced over their full width", () =>
  assert.equal(at("01. a\n02. b|\n03. c", "Tab"), "01. a\n    1. b|\n02. c"));
test("tab-indented lists are never rewritten", () => {
  assert.deepEqual(markdownEdit("- a\n\t- b", 7, "Tab", true).changes, []);
  assert.equal(markdownEdit("- a\n\t- b", 7, "Backspace", false), null);
});

test("removing the first marker keeps the next items a list", () => {
  assert.equal(at("3. |a\n4. b", "Backspace"), "|a\n1. b");
  assert.equal(at("1. |a\n   1. x\n2. b", "Backspace"), "|a\n1. x\n2. b");
  assert.equal(at("- |a\n  - x\n- b", "Backspace"), "|a\n- x\n- b");
});

const fix = (text, caret = null, starts = null) => {
  const e = renumberEdit(text, caret, starts);
  return e ? apply(text, e) : null;
};
test("auto renumber closes gaps and keeps the list's first number", () => {
  assert.equal(fix("1. a\n2. b\n4. d"), "1. a\n2. b\n3. d");
  assert.equal(fix("3) a\n5) b"), "3) a\n4) b");
  assert.equal(fix("1. a\n   1. x\n   3. y\n3. b"), "1. a\n   1. x\n   2. y\n2. b");
});
test("auto renumber keeps children attached across width changes", () =>
  assert.equal(fix("9. a\n11. b\n    - kid"), "9. a\n10. b\n    - kid"));
test("auto renumber leaves 1-1-1 style, sequential lists and prose alone", () => {
  assert.equal(fix("1. a\n1. b\n1. c"), null);
  assert.equal(fix("1. a\n2. b"), null);
  assert.equal(fix("no list 3. here"), null);
});
test("auto renumber never fights a number being edited", () =>
  assert.equal(fix("1. a\n1. b\n5. c", 11), null));

test("auto renumber runs with the caret at the start of the next item", () =>
  assert.equal(fix("1. a\n3. c\n4. d", 5), "1. a\n2. c\n3. d"));
test("auto renumber restores the list's previous start after cutting item 1", () => {
  assert.equal(fix("2. b\n3. c", 0, [1]), "1. b\n2. c");
  assert.equal(fix("6. b\n8. c", 0, [5]), "5. b\n6. c");
  assert.equal(fix("6. b\n8. c", 0, [1, 1]), "6. b\n7. c");
});
