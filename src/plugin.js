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
  normalizeSettings,
  isHexColor,
  themeHex,
} from "./settings.js";
export const CSS = `
.cl-toolbar-button { width:var(--composer-control-size,24px);height:var(--composer-control-size,24px);padding:0;color:var(--ui-text-tertiary,var(--ui-text-secondary)); }
[data-cl-cursor-style] { caret-color:var(--cl-caret-color,var(--ui-accent)); }
@keyframes cl-native-fade { 0%,40%,100% {caret-color:var(--cl-caret-color,var(--ui-accent));} 70% {caret-color:transparent;} }
@supports (caret-animation:manual) {
 [data-cl-soft]:focus {caret-animation:manual;animation:cl-native-fade 1200ms ease-in-out infinite;}
}
[data-cl-caret] {caret-color:transparent!important;}
.cl-caret-layer {position:fixed;inset:0;pointer-events:none!important;z-index:2147483000;overflow:hidden;}
.cl-caret-layer[hidden] {display:none!important;}
.cl-caret {position:fixed;top:0;left:0;width:2px;border-radius:1px;pointer-events:none;will-change:transform;}
::highlight(cl-list-mark) {color:var(--ui-accent);}
::highlight(cl-list-task) {color:var(--ui-text-secondary);}
[data-cl-managed] :where(span,font):not([data-ref-text],[data-ref-text] *) {color:inherit!important;-webkit-text-fill-color:currentColor!important;}
@media (prefers-reduced-motion:reduce) {
 [data-cl-soft]:focus {animation:none;caret-animation:auto;}
 .cl-caret-layer {display:none!important;}
}
.cl-dialog {max-width:min(480px,calc(100vw - 32px))!important;max-height:calc(100dvh - 48px);}
.cl-panel {display:grid;gap:16px;color:var(--ui-text-primary);font-size:.8125rem;}
.cl-group {display:grid;gap:0;}
.cl-section-title {margin:0 0 4px;font-size:.6875rem;font-weight:500;color:var(--ui-text-tertiary,var(--ui-text-secondary));}
.cl-setting {display:flex;align-items:center;justify-content:space-between;gap:20px;padding:10px 0;border-bottom:1px solid var(--ui-stroke-secondary);}
.cl-setting:last-child {border-bottom:0;}
.cl-label {font-size:.8125rem;line-height:1.4;}
.cl-detail,.cl-hint {font-size:.6875rem;line-height:1.6;color:var(--ui-text-secondary);}
.cl-detail {margin-top:3px;}
.cl-color-fields {display:flex;align-items:center;gap:8px;padding:4px 0 8px;}
.cl-swatch {flex:none;width:32px;height:28px;padding:3px;cursor:pointer;}
.cl-hex {width:112px;font-family:var(--font-mono,monospace);font-size:.75rem;}
.cl-error {color:var(--ui-danger,var(--ui-text-primary));font-size:.6875rem;}
.cl-shortcuts {display:flex;flex-wrap:wrap;gap:6px 14px;padding-top:6px;font-size:.6875rem;color:var(--ui-text-secondary);}
.cl-shortcuts kbd {color:var(--ui-text-primary);font-family:var(--font-mono,monospace);font-size:inherit;}
.cl-demo {padding:10px 12px;border:1px solid var(--ui-stroke-secondary);border-radius:6px;min-height:72px;max-height:140px;overflow:auto;white-space:pre-wrap;outline:none;font-size:.8125rem;line-height:1.6;background:var(--ui-bg-field,var(--ui-bg-secondary));}
.cl-demo:focus {border-color:var(--ui-accent);}
.cl-demo:empty::before {content:attr(data-placeholder);color:var(--ui-text-tertiary,var(--ui-text-secondary));pointer-events:none;}
.cl-preview {margin:6px 0 0;font-family:var(--font-mono,monospace);font-size:.6875rem;line-height:1.5;white-space:pre-wrap;max-height:64px;overflow:auto;color:var(--ui-text-secondary);}
.cl-footer {display:flex;justify-content:space-between;align-items:center;gap:12px;border-top:1px solid var(--ui-stroke-secondary);padding-top:12px;}
`;
export default {
  id: "composer-lab",
  name: "Composer Lab · 输入实验室",
  description:
    "主题色光标、柔和渐隐渐现与 Markdown 列表增强。实验性 DOM 适配，不修改核心。",
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
    style.dataset.composerLab = "0.4.0";
    style.textContent = CSS;
    document.head.append(style);
    const caret = mountCaret(() => settings);
    // A runtime failure pauses lists for this app session only. It is never
    // written to storage: one glitch must not silently switch the feature off
    // for good. Toggling the switch (or a restart) resumes it.
    let listsPaused = false;
    const lists = mountLists({
      enabled: () => settings.lists && !listsPaused,
      onError: (e) => {
        console.error("[composer-lab] list enhancement paused:", e);
        if (listsPaused) return;
        listsPaused = true;
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
                  jsx("div", {
                    id: `cl-${key}-detail`,
                    className: "cl-detail",
                    children: detail,
                  }),
                ],
              }),
              jsx(Switch, {
                id: `cl-${key}`,
                type: "button",
                "aria-describedby": `cl-${key}-detail`,
                checked: key === "lists" ? settings.lists && !listsPaused : settings[key],
                onCheckedChange: (v) => change({ [key]: v }),
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
                      children: "光标与列表 · 0.4.0 实验版",
                    }),
                  ],
                }),
                jsxs("section", {
                  className: "cl-group",
                  "aria-label": "光标",
                  children: [
                    jsx("h3", {
                      className: "cl-section-title",
                      children: "光标",
                    }),
                    toggle(
                      "fade",
                      "柔和渐隐渐现",
                      "停留时柔和淡入淡出；不改变输入框的焦点和 idle。",
                    ),
                    toggle(
                      "caret",
                      "平滑移动",
                      "单一光标跟随输入位置，不叠加重影或拖尾。",
                    ),
                    jsxs("div", {
                      className: "cl-setting",
                      children: [
                        jsx("span", {
                          className: "cl-label",
                          children: "光标颜色",
                        }),
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
                                    if (isHexColor(v))
                                      change({ customColor: v });
                                  },
                                  onBlur: () => {
                                    if (!hasHexError) setHexDraft(null);
                                  },
                                }),
                                jsx("span", {
                                  className: "cl-hint",
                                  children: "仅改变光标，不改变正文",
                                }),
                              ],
                            }),
                            hasHexError
                              ? jsx("div", {
                                  className: "cl-error",
                                  role: "status",
                                  children:
                                    "请输入 # 加六位十六进制颜色；无效值不会保存。",
                                })
                              : null,
                          ],
                        })
                      : jsx("div", {
                          className: "cl-hint",
                          children:
                            "使用当前主题的强调色，切换主题时自动跟随。",
                        }),
                    !globalThis.CSS.supports("caret-animation", "manual")
                      ? jsx("div", {
                          className: "cl-hint",
                          role: "status",
                          children:
                            "此浏览器不支持柔和原生光标，已回退为系统闪烁。",
                        })
                      : null,
                    matchMedia("(prefers-reduced-motion: reduce)").matches
                      ? jsx("div", {
                          className: "cl-hint",
                          children:
                            "系统已开启“减少动态效果”，光标动效随之停用。",
                        })
                      : null,
                  ],
                }),
                jsxs("section", {
                  className: "cl-group",
                  "aria-label": "列表",
                  children: [
                    jsx("h3", {
                      className: "cl-section-title",
                      children: "列表",
                    }),
                    toggle(
                      "lists",
                      "列表增强",
                      "保留 Markdown 原文；自动续号、缩进与空项退出。",
                    ),
                    jsxs("div", {
                      className: "cl-shortcuts",
                      children: [
                        jsxs("span", {
                          children: [
                            jsx("kbd", { children: "Enter" }),
                            " 发送",
                          ],
                        }),
                        jsxs("span", {
                          children: [
                            jsx("kbd", { children: "⇧ Enter" }),
                            " 换行 / 续项",
                          ],
                        }),
                        jsxs("span", {
                          children: [
                            jsx("kbd", { children: "Tab / ⇧ Tab" }),
                            " 列表缩进",
                          ],
                        }),
                      ],
                    }),
                    jsx("div", {
                      className: "cl-detail",
                      children:
                        "输入法候选确认和补全菜单优先；发送始终由 Hermes 处理。",
                    }),
                  ],
                }),
                jsxs("section", {
                  className: "cl-group",
                  "aria-label": "安全试写",
                  children: [
                    jsxs("div", {
                      className: "cl-setting",
                      children: [
                        jsx("h3", {
                          className: "cl-section-title",
                          children: "安全试写 · 不会发送消息",
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
                        if (e.nativeEvent.isComposing || e.keyCode === 229)
                          return;
                        if (e.key === "Enter" && !e.defaultPrevented) {
                          e.preventDefault();
                          document.execCommand("insertLineBreak");
                        }
                      },
                      "data-placeholder": "输入 1. 空格，或直接试试中文…",
                    }),
                    jsx("pre", {
                      className: "cl-preview",
                      "aria-label": "Markdown 原文",
                      children: preview || "Markdown 原文会显示在这里",
                    }),
                  ],
                }),
                jsx("div", {
                  className: "cl-hint",
                  children:
                    "使用实验性 DOM 适配，非官方稳定编辑器接口。复杂粘贴或超长草稿会跳过排版。",
                }),
                jsxs("div", {
                  className: "cl-footer",
                  children: [
                    jsx("span", {
                      className: "cl-hint",
                      children: "即时保存 · 无需重启",
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
    console.info("[composer-lab] 0.4.0 registered");
    ctx.onDispose(() => {
      lists.dispose();
      caret.dispose();
      style.remove();
      subscribers.clear();
    });
  },
};
