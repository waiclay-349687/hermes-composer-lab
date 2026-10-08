import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  Switch,
  Input,
  SegmentedControl,
  COMPOSER_AREAS,
  PALETTE_AREA,
  TITLEBAR_AREAS,
  host,
} from "@hermes/plugin-sdk";
import { jsx, jsxs } from "react/jsx-runtime";
import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { mountLists, textOf, SELECTOR } from "./editor.js";
import { mountCaret } from "./caret.js";
import {
  DEFAULT_SETTINGS,
  PRESETS,
  matchPreset,
  normalizeSettings,
  presetValues,
  isHexColor,
  themeHex,
} from "./settings.js";
export const CSS = `
.cl-toolbar-button { width:var(--composer-control-size,24px);height:var(--composer-control-size,24px);padding:0;color:var(--ui-text-tertiary,var(--ui-text-secondary)); }
[data-cl-cursor-style] { caret-color:var(--cl-caret-color,var(--ui-accent)); }
@keyframes cl-native-fade { 0%,40%,100% {caret-color:var(--cl-caret-color,var(--ui-accent));} 70% {caret-color:transparent;} }
@supports (caret-animation:manual) {
 [data-cl-soft]:focus {caret-animation:manual;animation:cl-native-fade 1200ms ease-in-out infinite;}
 [data-cl-steady]:focus {caret-animation:manual;}
}
[data-cl-caret] {caret-color:transparent!important;}
.cl-caret-layer,.cl-fx-layer {position:fixed;inset:0;pointer-events:none!important;z-index:2147483000;overflow:hidden;}
.cl-caret-layer[hidden] {display:none!important;}
.cl-caret {position:fixed;top:0;left:0;pointer-events:none;will-change:transform;display:block;}
.cl-caret-core {display:block;border-radius:1px;background:var(--cl-c);}
.cl-shape-block .cl-caret-core {background:color-mix(in srgb,var(--cl-c) 55%,transparent);border-radius:2px;}
.cl-shape-underline .cl-caret-core {border-radius:1px;}
.cl-glow .cl-caret-core {box-shadow:0 0 6px 1px var(--cl-c),0 0 14px 3px color-mix(in srgb,var(--cl-c) 40%,transparent);}
.cl-rest-fade .cl-caret-core {animation:cl-rest-fade 1200ms ease-in-out infinite;}
.cl-rest-breathe .cl-caret-core {animation:cl-rest-breathe 2400ms ease-in-out infinite;}
.cl-rest-blink .cl-caret-core {animation:cl-rest-blink 1060ms steps(1,end) infinite;}
.cl-aurora {animation:cl-aurora 6s linear infinite;}
@keyframes cl-rest-fade {0%,40%,100% {opacity:1;} 70% {opacity:0;}}
@keyframes cl-rest-breathe {0%,100% {opacity:1;} 50% {opacity:.45;}}
@keyframes cl-rest-blink {0% {opacity:1;} 50% {opacity:0;}}
@keyframes cl-aurora {from {filter:hue-rotate(0deg);} to {filter:hue-rotate(360deg);}}
.cl-ink,.cl-ripple,.cl-spark {position:fixed;pointer-events:none;display:block;}
.cl-ink {border-radius:2px;}
.cl-ripple {width:6px;height:6px;margin:-3px 0 0 -3px;border-radius:50%;border:1px solid var(--cl-c);}
.cl-spark {width:3px;height:3px;margin:-1.5px 0 0 -1.5px;border-radius:50%;background:var(--cl-c);}
::highlight(cl-list-mark) {color:var(--ui-accent);}
::highlight(cl-list-task) {color:var(--ui-text-secondary);}
[data-cl-managed] {white-space:pre-wrap;}
[data-cl-managed] :where(span,font):not([data-ref-text],[data-ref-text] *) {color:inherit!important;-webkit-text-fill-color:currentColor!important;}
@media (prefers-reduced-motion:reduce) {
 [data-cl-soft]:focus {animation:none;caret-animation:auto;}
 .cl-caret-layer,.cl-fx-layer {display:none!important;}
}
.cl-dialog {max-width:min(500px,calc(100vw - 32px))!important;max-height:calc(100dvh - 48px);overflow-y:auto;}
.cl-panel {display:grid;gap:14px;color:var(--ui-text-primary);font-size:.8125rem;}
.cl-tabs {display:flex;justify-content:space-between;align-items:center;gap:12px;}
.cl-group {display:grid;gap:0;}
.cl-section-title {margin:0 0 6px;font-size:.6875rem;font-weight:500;color:var(--ui-text-tertiary,var(--ui-text-secondary));}
.cl-presets {display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;}
.cl-preset {display:grid;gap:1px;text-align:left;padding:7px 9px;border-radius:6px;border:1px solid var(--ui-stroke-secondary);background:transparent;color:var(--ui-text-primary);cursor:pointer;font:inherit;}
.cl-preset:hover {border-color:color-mix(in srgb,var(--ui-accent) 60%,var(--ui-stroke-secondary));}
.cl-preset[aria-pressed=true] {border-color:var(--ui-accent);background:color-mix(in srgb,var(--ui-accent) 10%,transparent);}
.cl-preset:focus-visible {outline:2px solid var(--ui-accent);outline-offset:1px;}
.cl-preset-name {font-size:.75rem;line-height:1.35;}
.cl-preset-tag {font-size:.625rem;color:var(--ui-text-tertiary,var(--ui-text-secondary));}
.cl-setting {display:flex;align-items:center;justify-content:space-between;gap:16px;padding:8px 0;border-bottom:1px solid var(--ui-stroke-secondary);}
.cl-setting:last-child {border-bottom:0;}
.cl-label {font-size:.8125rem;line-height:1.4;}
.cl-detail,.cl-hint {font-size:.6875rem;line-height:1.6;color:var(--ui-text-secondary);}
.cl-detail {margin-top:2px;}
.cl-more {justify-self:start;padding:2px 0;border:0;background:none;color:var(--ui-text-secondary);font:inherit;font-size:.6875rem;cursor:pointer;}
.cl-more:hover {color:var(--ui-text-primary);}
.cl-color-fields {display:flex;align-items:center;gap:8px;padding:2px 0 8px;}
.cl-swatch {flex:none;width:32px;height:28px;padding:3px;cursor:pointer;}
.cl-hex {width:112px;font-family:var(--font-mono,monospace);font-size:.75rem;}
.cl-error {color:var(--ui-danger,var(--ui-text-primary));font-size:.6875rem;}
.cl-shortcuts {display:grid;grid-template-columns:auto 1fr;gap:4px 14px;padding-top:8px;font-size:.6875rem;color:var(--ui-text-secondary);}
.cl-shortcuts kbd {color:var(--ui-text-primary);font-family:var(--font-mono,monospace);font-size:inherit;}
.cl-demo-head {display:flex;justify-content:space-between;align-items:center;}
.cl-demo {padding:10px 12px;border:1px solid var(--ui-stroke-secondary);border-radius:6px;min-height:64px;max-height:130px;overflow:auto;white-space:pre-wrap;outline:none;font-size:.8125rem;line-height:1.6;background:var(--ui-bg-field,var(--ui-bg-secondary));}
.cl-demo:focus {border-color:var(--ui-accent);}
.cl-demo:empty::before {content:attr(data-placeholder);color:var(--ui-text-tertiary,var(--ui-text-secondary));pointer-events:none;}
.cl-preview {margin:6px 0 0;font-family:var(--font-mono,monospace);font-size:.6875rem;line-height:1.5;white-space:pre-wrap;max-height:56px;overflow:auto;color:var(--ui-text-secondary);}
.cl-footer {display:flex;justify-content:space-between;align-items:center;gap:12px;border-top:1px solid var(--ui-stroke-secondary);padding-top:10px;}
`;
export default {
  id: "composer-lab",
  name: "Composer Lab · 输入实验室",
  description:
    "九种可组合的光标效果与 Markdown 列表增强。实验性 DOM 适配，不修改核心。",
  register(ctx) {
    let settings = normalizeSettings(ctx.storage.get("settings", {}));
    ctx.storage.set("settings", settings);
    let opened = null,
      version = 0;
    const subscribers = new Set();
    const signal = () => {
      version++;
      for (const fn of subscribers) fn();
    };
    const style = document.createElement("style");
    style.dataset.composerLab = "0.5.0";
    style.textContent = CSS;
    document.head.append(style);
    const caret = mountCaret(() => settings);
    // A runtime failure pauses lists for this app session only. It is never
    // written to storage: one glitch must not silently switch the feature off
    // for good. Toggling the switch (or a restart) resumes it.
    let listsPaused = false,
      pauseReason = "";
    const lists = mountLists({
      enabled: () => settings.lists && !listsPaused,
      renumber: () => settings.renumber,
      onError: (e) => {
        console.error("[composer-lab] list enhancement paused:", e);
        if (listsPaused) return;
        listsPaused = true;
        pauseReason = String(e?.message || e).slice(0, 80);
        lists?.refresh();
        signal();
        host.notify({
          kind: "error",
          message: `输入实验室：列表增强遇到错误，本次已暂停（${e.message}）。在设置里重新打开开关即可恢复。`,
        });
      },
    });
    function change(patch) {
      if ("lists" in patch) listsPaused = false;
      settings = normalizeSettings({ ...settings, ...patch });
      ctx.storage.set("settings", settings);
      caret.refresh();
      lists.refresh();
      signal();
    }
    // Where the caret was before the dialog took focus, so closing it hands
    // the caret back instead of leaving focus nowhere.
    let returnTo = null;
    function remember() {
      const sel = getSelection(),
        editor = document.activeElement?.closest?.(SELECTOR);
      returnTo =
        editor && !editor.hasAttribute("data-composer-lab-demo")
          ? {
              editor,
              range:
                sel?.rangeCount && editor.contains(sel.anchorNode)
                  ? sel.getRangeAt(0).cloneRange()
                  : null,
            }
          : null;
    }
    function restoreFocus() {
      const back = returnTo;
      returnTo = null;
      if (back?.editor.isConnected && back.editor.offsetParent !== null) {
        back.editor.focus({ preventScroll: true });
        if (back.range && back.editor.contains(back.range.startContainer)) {
          const sel = getSelection();
          sel.removeAllRanges();
          sel.addRange(back.range);
        }
        return;
      }
      try {
        host.composer?.focus?.();
      } catch {
        /* no visible composer: nothing to return to */
      }
    }
    const HEADLESS = "cl-headless";
    function open(e, owner) {
      e?.preventDefault?.();
      const visible = [...document.querySelectorAll("[data-cl-settings-owner]")].find(
        (b) => b.offsetParent !== null && b.getAttribute("data-cl-settings-owner") !== HEADLESS,
      );
      opened = owner || visible?.getAttribute("data-cl-settings-owner") || HEADLESS;
      if (opened === HEADLESS && !headlessMounted) {
        // Overlays (Settings) and chrome-owning pages unmount the titlebar.
        opened = null;
        host.notify({
          kind: "info",
          message: "输入实验室：请先回到对话页或关闭当前设置页，再打开设置。",
        });
      }
      signal();
    }
    let headlessMounted = 0;
    function UI({ headless = false }) {
      const id = useId(),
        owner = headless ? HEADLESS : id;
      useEffect(() => {
        if (!headless) return;
        headlessMounted++;
        return () => {
          headlessMounted--;
        };
      }, [headless]);
      useSyncExternalStore(
        (fn) => {
          subscribers.add(fn);
          return () => subscribers.delete(fn);
        },
        () => version,
      );
      const [preview, setPreview] = useState(""),
        [hexDraft, setHexDraft] = useState(null),
        [tab, setTab] = useState("caret"),
        [more, setMore] = useState(false),
        demo = useRef(null);
      const toggle = (key, label, detail) =>
        jsxs(
          "div",
          {
            className: "cl-setting",
            children: [
              jsxs("div", {
                children: [
                  jsx("label", {
                    className: "cl-label",
                    htmlFor: `cl-${key}`,
                    children: label,
                  }),
                  detail
                    ? jsx("div", {
                        id: `cl-${key}-detail`,
                        className: "cl-detail",
                        children: detail,
                      })
                    : null,
                ],
              }),
              jsx(Switch, {
                id: `cl-${key}`,
                type: "button",
                "aria-describedby": detail ? `cl-${key}-detail` : undefined,
                checked: key === "lists" ? settings.lists && !listsPaused : settings[key],
                onCheckedChange: (v) => change({ [key]: v }),
              }),
            ],
          },
          key,
        );
      const choice = (key, label, options) =>
        jsxs(
          "div",
          {
            className: "cl-setting",
            role: "group",
            "aria-label": label,
            children: [
              jsx("span", { className: "cl-label", children: label }),
              jsx(SegmentedControl, {
                value: settings[key],
                onChange: (v) => change({ [key]: v }),
                options,
              }),
            ],
          },
          key,
        );
      const selectColor = (mode) => {
        setHexDraft(null);
        change({
          colorMode: mode,
          ...(mode === "custom"
            ? { customColor: settings.customColor || themeHex() }
            : {}),
        });
      };
      const hasHexError = hexDraft !== null && !isHexColor(hexDraft);
      const current = matchPreset(settings);
      const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
      const caretTab = [
        jsxs(
          "section",
          {
            className: "cl-group",
            "aria-label": "光标风格",
            children: [
              jsx("h3", {
                className: "cl-section-title",
                children: current ? "风格" : "风格 · 当前为自定义组合",
              }),
              jsx("div", {
                className: "cl-presets",
                children: PRESETS.map((preset) =>
                  jsxs(
                    "button",
                    {
                      type: "button",
                      className: "cl-preset",
                      "aria-pressed": current === preset.id,
                      onClick: () => change(presetValues(preset)),
                      children: [
                        jsx("span", { className: "cl-preset-name", children: preset.name }),
                        jsx("span", { className: "cl-preset-tag", children: preset.tag }),
                      ],
                    },
                    preset.id,
                  ),
                ),
              }),
            ],
          },
          "presets",
        ),
        jsxs(
          "section",
          {
            className: "cl-group",
            "aria-label": "光标颜色",
            children: [
              jsxs("div", {
                className: "cl-setting",
                children: [
                  jsx("span", { className: "cl-label", children: "颜色" }),
                  jsx(SegmentedControl, {
                    value: settings.colorMode,
                    onChange: selectColor,
                    options: [
                      { id: "theme", label: "跟随主题" },
                      { id: "custom", label: "自定义" },
                    ],
                  }),
                ],
              }),
              settings.colorMode === "custom"
                ? jsxs("div", {
                    children: [
                      jsxs("div", {
                        className: "cl-color-fields",
                        children: [
                          jsx(Input, {
                            type: "color",
                            className: "cl-swatch",
                            "aria-label": "选择光标颜色",
                            value: settings.customColor,
                            onChange: (e) => {
                              setHexDraft(null);
                              change({ customColor: e.target.value });
                            },
                          }),
                          jsx(Input, {
                            type: "text",
                            className: "cl-hex",
                            "aria-label": "光标颜色十六进制",
                            "aria-invalid": hasHexError,
                            value: hexDraft ?? settings.customColor,
                            maxLength: 7,
                            spellCheck: false,
                            onChange: (e) => {
                              const v = e.target.value;
                              setHexDraft(v);
                              if (isHexColor(v)) change({ customColor: v });
                            },
                            onBlur: () => {
                              if (!hasHexError) setHexDraft(null);
                            },
                          }),
                          jsx("span", {
                            className: "cl-hint",
                            children: "只改光标，不改正文",
                          }),
                        ],
                      }),
                      hasHexError
                        ? jsx("div", {
                            className: "cl-error",
                            role: "status",
                            children: "请输入 # 加六位十六进制颜色；无效值不会保存。",
                          })
                        : null,
                    ],
                  })
                : null,
              jsx("button", {
                type: "button",
                className: "cl-more",
                "aria-expanded": more,
                onClick: () => setMore(!more),
                children: more ? "收起细调 ▴" : "细调组合 ▾",
              }),
              more
                ? jsxs("div", {
                    className: "cl-group",
                    children: [
                      choice("shape", "形状", [
                        { id: "bar", label: "竖线" },
                        { id: "block", label: "方块" },
                        { id: "underline", label: "下划线" },
                      ]),
                      choice("motion", "移动", [
                        { id: "glide", label: "平滑" },
                        { id: "spring", label: "弹性" },
                        { id: "instant", label: "瞬移" },
                      ]),
                      choice("rest", "静止", [
                        { id: "fade", label: "渐隐" },
                        { id: "breathe", label: "呼吸" },
                        { id: "blink", label: "闪烁" },
                        { id: "steady", label: "常亮" },
                      ]),
                      choice("trail", "移动余韵", [
                        { id: "none", label: "无" },
                        { id: "ink", label: "墨迹" },
                      ]),
                      choice("typing", "输入特效", [
                        { id: "none", label: "无" },
                        { id: "ripple", label: "涟漪" },
                        { id: "sparks", label: "火花" },
                      ]),
                      toggle("glow", "光晕"),
                      toggle("aurora", "极光流转", "颜色在当前色附近缓慢流转。"),
                    ],
                  })
                : null,
            ],
          },
          "color",
        ),
        reducedMotion
          ? jsx(
              "div",
              {
                className: "cl-hint",
                role: "status",
                children: "系统已开启“减少动态效果”：光标动效暂停，只保留颜色。",
              },
              "reduced",
            )
          : null,
      ];
      const listTab = [
        jsxs(
          "section",
          {
            className: "cl-group",
            "aria-label": "列表",
            children: [
              toggle(
                "lists",
                "列表增强",
                listsPaused
                  ? `本次已暂停：遇到错误（${pauseReason}）。重新打开开关即可恢复。`
                  : "续项、缩进、退级都只改行首，正文原样保留。",
              ),
              toggle(
                "renumber",
                "自动校正编号",
                "删除、剪切或粘贴整行后自动排成连续编号；⌘Z 可撤回。",
              ),
              jsx("div", {
                className: "cl-shortcuts",
                children: [
                  ["⇧ Enter", "换行；列表里续出下一项"],
                  ["Tab / ⇧ Tab", "列表项缩进 / 退级"],
                  ["⌫", "紧跟在符号后时退级或去掉符号"],
                  ["Enter", "照常发送（输入法和补全菜单优先）"],
                ].flatMap(([k, v]) => [
                  jsx("kbd", { children: k }, k),
                  jsx("span", { children: v }, k + "-d"),
                ]),
              }),
            ],
          },
          "lists",
        ),
      ];
      return jsxs(Dialog, {
        open: opened === owner,
        onOpenChange: (v) => {
          if (v) opened = owner;
          else if (opened === owner) opened = null;
          signal();
        },
        children: [
          headless
            ? null
            : jsx(Button, {
                type: "button",
                variant: "ghost",
                size: "icon-xs",
                className: "cl-toolbar-button rounded-md",
                title: "输入实验室：光标与列表设置",
                "aria-label": "打开输入实验室",
                "data-cl-settings-owner": owner,
                onPointerDown: remember,
                onKeyDown: (e) => {
                  if (e.key === "Enter" || e.key === " ") remember();
                },
                onClick: (e) => open(e, owner),
                children: "Aa",
              }),
          jsx(DialogContent, {
            className: "cl-dialog",
            onCloseAutoFocus: (e) => {
              e.preventDefault();
              restoreFocus();
            },
            onSubmit: (e) => {
              e.preventDefault();
              e.stopPropagation();
            },
            onKeyDown: (e) => {
              e.stopPropagation();
              if (
                e.key === "Enter" &&
                !e.nativeEvent.isComposing &&
                e.keyCode !== 229 &&
                !e.target.closest("button,[data-composer-lab-demo]")
              )
                e.preventDefault();
            },
            children: jsxs("div", {
              className: "cl-panel",
              children: [
                jsxs(DialogHeader, {
                  children: [
                    jsx(DialogTitle, { children: "输入实验室" }),
                    jsx(DialogDescription, {
                      children: "光标效果与 Markdown 列表 · 0.5.0",
                    }),
                  ],
                }),
                jsx("div", {
                  className: "cl-tabs",
                  children: jsx(SegmentedControl, {
                    value: tab,
                    onChange: setTab,
                    options: [
                      { id: "caret", label: "光标" },
                      { id: "lists", label: "列表" },
                    ],
                  }),
                }),
                ...(tab === "caret" ? caretTab : listTab),
                jsxs("section", {
                  className: "cl-group",
                  "aria-label": "试写区",
                  children: [
                    jsxs("div", {
                      className: "cl-demo-head",
                      children: [
                        jsx("h3", {
                          className: "cl-section-title",
                          children: "试写区 · 不会发送",
                        }),
                        jsx(Button, {
                          type: "button",
                          variant: "ghost",
                          size: "sm",
                          onClick: () => {
                            demo.current?.replaceChildren();
                            setPreview("");
                          },
                          children: "清空",
                        }),
                      ],
                    }),
                    jsx("div", {
                      ref: demo,
                      "data-composer-lab-demo": "",
                      className: "cl-demo",
                      role: "textbox",
                      "aria-label": "安全试写区（不会发送）",
                      "aria-multiline": true,
                      contentEditable: true,
                      suppressContentEditableWarning: true,
                      onInput: (e) => setPreview(textOf(e.currentTarget)),
                      onKeyDown: (e) => {
                        e.stopPropagation();
                        if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                        if (e.key === "Enter" && !e.defaultPrevented) {
                          e.preventDefault();
                          document.execCommand("insertLineBreak");
                        }
                      },
                      "data-placeholder":
                        tab === "caret"
                          ? "在这里打字、移动光标，看看效果…"
                          : "输入 1. 加空格，再按 ⇧Enter / Tab 试试…",
                    }),
                    tab === "lists"
                      ? jsx("pre", {
                          className: "cl-preview",
                          "aria-label": "Markdown 原文",
                          children: preview || "Markdown 原文会显示在这里",
                        })
                      : null,
                  ],
                }),
                jsxs("div", {
                  className: "cl-footer",
                  children: [
                    jsx("span", {
                      className: "cl-hint",
                      children: "即时保存 · 实验性插件，非官方编辑器接口",
                    }),
                    jsx(Button, {
                      type: "button",
                      variant: "ghost",
                      size: "sm",
                      onClick: () => {
                        setHexDraft(null);
                        change(DEFAULT_SETTINGS);
                      },
                      children: "恢复默认",
                    }),
                  ],
                }),
              ],
            }),
          }),
        ],
      });
    }
    ctx.register({
      id: "controls",
      area: COMPOSER_AREAS.actions,
      order: 80,
      render: () => jsx(UI, {}),
    });
    // Invisible host for the dialog so the palette command also works on pages
    // without a composer. `titleBar.center` (not left/right): the host treats
    // any left/right contribution as "this page owns the titlebar" and would
    // hide its own fixed controls on extension pages.
    if (TITLEBAR_AREAS?.center)
      ctx.register({
        id: "dialog-host",
        area: TITLEBAR_AREAS.center,
        order: 9999,
        render: () => jsx(UI, { headless: true }),
      });
    ctx.register({
      id: "settings",
      area: PALETTE_AREA,
      data: {
        id: "composer-lab-settings",
        label: "输入实验室：光标与列表设置",
        run: () => {
          remember();
          open();
        },
      },
    });
    console.info("[composer-lab] 0.5.0 registered");
    ctx.onDispose(() => {
      lists.dispose();
      caret.dispose();
      style.remove();
      subscribers.clear();
    });
  },
};
