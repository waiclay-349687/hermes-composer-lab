const { _electron } = require("playwright");
const path = require("node:path"),
  fs = require("node:fs"),
  assert = require("node:assert/strict");
const scratch = path.join(require("node:os").tmpdir(), "composer-lab-tests");
fs.mkdirSync(scratch, { recursive: true });
(async () => {
  if (!process.env.HERMES_ELECTRON_PATH)
    throw new Error(
      "Set HERMES_ELECTRON_PATH to an existing Electron executable",
    );
  const app = await _electron.launch({
    executablePath: process.env.HERMES_ELECTRON_PATH,
    args: [path.resolve("tests/electron.cjs")],
    env: { ...process.env, CL_TEST_HOME: path.join(scratch, "safety-profile") },
  });
  const results = [],
    errors = [];
  const p = await app.firstWindow();
  p.on("pageerror", (e) => errors.push(String(e)));
  const check = async (name, fn) => {
    await fn();
    results.push({ name, ok: true });
    console.log("PASS " + name);
  };
  const open = async (name) => {
    await p.goto("file://" + path.resolve("dist/" + name + ".html"));
  };
  try {
    await check(
      "reproduce old implicit submit with actual host Button; explicit type fixes it",
      async () => {
        await open("button-risk");
        await p.getByTestId("old").click();
        assert.equal(await p.evaluate(() => submits), 1);
        await p.getByTestId("fixed").click();
        assert.equal(await p.evaluate(() => submits), 1);
      },
    );
    await check(
      "actual plugin settings button opens without submitting host form",
      async () => {
        await open("settings");
        const opener = p.getByRole("button", { name: "打开输入实验室" });
        for (const size of [24, 28]) {
          await p.evaluate(
            (size) =>
              document.body.style.setProperty(
                "--composer-control-size",
                `${size}px`,
              ),
            size,
          );
          await p.waitForFunction(
            (size) =>
              getComputedStyle(document.querySelector(".cl-toolbar-button"))
                .width === `${size}px`,
            size,
          );
          const dimensions = await opener.evaluate((el) => {
            const s = getComputedStyle(el);
            return [s.width, s.height, s.paddingLeft, s.paddingRight, el.type];
          });
          assert.deepEqual(dimensions, [
            `${size}px`,
            `${size}px`,
            "0px",
            "0px",
            "button",
          ]);
        }
        await p.evaluate(() =>
          document.body.style.removeProperty("--composer-control-size"),
        );
        await opener.click();
        await p.getByRole("dialog").waitFor();
        assert.equal(await p.evaluate(() => submits), 0);
        assert.deepEqual(
          await p
            .getByRole("dialog")
            .locator("button")
            .evaluateAll((ns) =>
              ns.filter((n) => n.type !== "button").map((n) => n.outerHTML),
            ),
          [],
        );
      },
    );
    await check(
      "all settings toggles and reset preserve host draft and cannot submit",
      async () => {
        for (const name of ["微光呼吸", "终端方块", "打字火花", "柔和渐隐"])
          await p.getByRole("button", { name, exact: false }).first().click();
        assert.equal(await p.evaluate(() => saved.settings.rest), "fade");
        await p.getByRole("button", { name: "细调组合 ▾" }).click();
        await p.getByRole("switch", { name: "光晕", exact: true }).click();
        assert.equal(await p.evaluate(() => saved.settings.glow), true);
        assert.ok(await p.getByText("当前为自定义组合").count());
        await p.getByRole("switch", { name: "光晕", exact: true }).click();
        await p.getByRole("button", { name: "列表", exact: true }).click();
        for (const name of ["列表增强", "自动校正编号"]) {
          await p.getByRole("switch", { name, exact: true }).click();
          await p.getByRole("switch", { name, exact: true }).click();
        }
        await p.getByRole("button", { name: "光标", exact: true }).click();
        await p.getByRole("button", { name: "恢复默认" }).click();
        assert.equal(await p.evaluate(() => submits), 0);
        assert.equal(
          await p.locator('[data-slot="composer-rich-input"]').textContent(),
          "Unsent test draft",
        );
      },
    );
    await check(
      "custom color persists; invalid hex is rejected; Enter in settings cannot submit",
      async () => {
        await p.getByRole("button", { name: "自定义", exact: true }).click();
        const field = p.getByRole("textbox", { name: "光标颜色十六进制" });
        await field.fill("#AB12CD");
        await field.press("Enter");
        assert.equal(
          await p.evaluate(() => saved.settings.customColor),
          "#ab12cd",
        );
        await field.fill("invalid");
        await field.press("Enter");
        assert.equal(
          await p.evaluate(() => saved.settings.customColor),
          "#ab12cd",
        );
        assert.equal(await field.getAttribute("aria-invalid"), "true");
        assert.equal(await p.evaluate(() => submits), 0);
        await field.fill("#AB12CD");
        await field.blur();
      },
    );
    await check(
      "safe trial Enter and list continuation never submit or change host draft",
      async () => {
        const demo = p.getByRole("textbox", { name: "安全试写区（不会发送）" });
        await demo.fill("1. preview");
        await demo.press("Shift+Enter");
        await p.keyboard.insertText("第二项");
        await demo.press("Enter");
        assert.equal(await p.evaluate(() => submits), 0);
        assert.equal(
          await p.locator('[data-slot="composer-rich-input"]').textContent(),
          "Unsent test draft",
        );
        await p.getByRole("button", { name: "清空", exact: true }).click();
        assert.equal(await demo.textContent(), "");
      },
    );
    await check(
      "theme color follows live theme variable without changing body text",
      async () => {
        await p.getByRole("button", { name: "跟随主题", exact: true }).click();
        const colors = await p.evaluate(() => {
          const el = document.querySelector(
            '[data-slot="composer-rich-input"]',
          );
          const before = getComputedStyle(el).color;
          document.documentElement.style.setProperty("--ui-accent", "#123abc");
          return {
            caret: getComputedStyle(el).caretColor,
            before,
            after: getComputedStyle(el).color,
          };
        });
        assert.equal(colors.caret, "rgb(18, 58, 188)");
        assert.equal(colors.after, colors.before);
      },
    );
    await p.getByRole("button", { name: "恢复默认" }).click();
    await p.evaluate(() =>
      document.documentElement.style.removeProperty("--ui-accent"),
    );
    await p.setViewportSize({ width: 850, height: 850 });
    await p.evaluate(() => {
      for (const el of document.querySelectorAll(
        '[data-slot="dialog-content"], [data-slot="dialog-content"]>div',
      ))
        el.scrollTop = 0;
    });
    await p.waitForTimeout(240);
    await p.screenshot({ path: path.join(scratch, "settings-dark.png") });
    await p.evaluate(() => {
      document.documentElement.classList.remove("dark");
      const vars = {
        "--ui-bg-elevated": "#ffffff",
        "--primary": "#35735b",
        "--ui-chat-bubble-background": "#ffffff",
        "--dt-background": "#ffffff",
        "--dt-foreground": "#202b30",
        "--dt-input": "#e8edeb",
        "--stroke-nous": "#d3dfd9",
        "--background": "#ffffff",
        "--foreground": "#202b30",
        "--muted-foreground": "#596b73",
        "--ui-bg-primary": "#ffffff",
        "--ui-bg-secondary": "#f4f6f5",
        "--ui-bg-tertiary": "#e8edeb",
        "--ui-bg-field": "#fafcfb",
        "--ui-text-primary": "#202b30",
        "--ui-text-secondary": "#596b73",
        "--ui-text-tertiary": "#63766d",
        "--ui-stroke-secondary": "#d3dfd9",
        "--ui-accent": "#35735b",
      };
      for (const [k, v] of Object.entries(vars))
        document.documentElement.style.setProperty(k, v);
    });
    await p.waitForTimeout(240);
    await p.screenshot({ path: path.join(scratch, "settings-light.png") });
    await check(
      "multiple composer controls open one dialog; narrow viewport stays usable",
      async () => {
        await p.keyboard.press("Escape");
        await p.evaluate(() => mountSecondUI());
        await p.getByRole("button", { name: "打开输入实验室" }).last().click();
        assert.equal(await p.getByRole("dialog").count(), 1);
        assert.equal(await p.evaluate(() => submits), 0);
        await p.setViewportSize({ width: 375, height: 650 });
        const bounds = await p.getByRole("dialog").boundingBox();
        assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 375);
        await p.setViewportSize({ width: 850, height: 850 });
      },
    );
    await check(
      "reduced-motion disables native fade and moving overlay",
      async () => {
        await p.emulateMedia({ reducedMotion: "reduce" });
        await p
          .getByRole("textbox", { name: "安全试写区（不会发送）" })
          .fill("reduced");
        await p.waitForTimeout(60);
        assert.equal(
          await p
            .locator("[data-composer-lab-demo]")
            .evaluate((el) => getComputedStyle(el).animationName),
          "none",
        );
        assert.equal(
          await p
            .locator(".cl-caret-layer")
            .evaluate((el) => getComputedStyle(el).display),
          "none",
        );
        await p.emulateMedia({ reducedMotion: "no-preference" });
      },
    );
    await check(
      "native fade has intermediate alpha and cannot recolor body",
      async () => {
        await open("fixture");
        await p.waitForFunction(() => window.fixture);
        await p.evaluate(() => {
          settings = normalizeSettings({});
          caret.refresh();
          fixture.set("fade test");
        });
        await p.waitForTimeout(220);
        const samples = await p.evaluate(async () => {
          const el = document.getElementById("editor"),
            a = el
              .getAnimations()
              .find((a) => a.animationName === "cl-native-fade");
          if (!a) return null;
          a.pause();
          const out = [];
          for (const t of [0, 660, 840]) {
            a.currentTime = t;
            await new Promise(requestAnimationFrame);
            out.push({
              caret: getComputedStyle(el).caretColor,
              body: getComputedStyle(el).color,
            });
          }
          a.play();
          window.fadeAnimation = a;
          return out;
        });
        assert.ok(samples, "native fade CSS animation must exist");
        assert.notEqual(samples[0].caret, samples[1].caret);
        assert.notEqual(samples[1].caret, samples[2].caret);
        assert.match(samples[1].caret, /rgba\(.+, 0\.5\)/);
        assert.equal(new Set(samples.map((s) => s.body)).size, 1);
      },
    );
    await check(
      "unrelated events preserve fade animation instance and phase",
      async () => {
        const result = await p.evaluate(() => {
          const before = fadeAnimation.currentTime;
          document.dispatchEvent(new Event("selectionchange"));
          document.body.dispatchEvent(
            new MouseEvent("click", { bubbles: true }),
          );
          return new Promise((resolve) =>
            requestAnimationFrame(() => {
              const a = document.getElementById("editor").getAnimations()[0];
              resolve({
                same: a === fadeAnimation,
                advances: a.currentTime >= before,
              });
            }),
          );
        });
        assert.deepEqual(result, { same: true, advances: true });
      },
    );
    await check(
      "IME confirmation and list structural input never submit",
      async () => {
        await p.evaluate(() => {
          fixture.set("1. 草稿");
          window.submitted = null;
          const el = document.getElementById("editor");
          el.dispatchEvent(
            new KeyboardEvent("keydown", {
              key: "Enter",
              keyCode: 229,
              bubbles: true,
            }),
          );
          el.dispatchEvent(
            new CompositionEvent("compositionstart", { bubbles: true }),
          );
          el.dispatchEvent(
            new KeyboardEvent("keydown", {
              key: "Enter",
              isComposing: true,
              bubbles: true,
            }),
          );
          el.dispatchEvent(
            new CompositionEvent("compositionend", { bubbles: true }),
          );
        });
        assert.equal(await p.evaluate(() => submitted), null);
        await p.keyboard.press("Shift+Enter");
        await p.keyboard.insertText("第二项");
        await p.keyboard.press("Tab");
        assert.equal(await p.evaluate(() => submitted), null);
      },
    );
    await check(
      "unload removes fade/color and cannot send or move focus",
      async () => {
        const result = await p.evaluate(() => {
          const el = document.getElementById("editor"),
            before = fixture.read(),
            focus = document.activeElement;
          lists.dispose();
          caret.dispose();
          return {
            same: before === fixture.read(),
            focus: focus === document.activeElement,
            styled: el.hasAttribute("data-cl-cursor-style"),
            animations: el.getAnimations().length,
            submitted,
          };
        });
        assert.deepEqual(result, {
          same: true,
          focus: true,
          styled: false,
          animations: 0,
          submitted: null,
        });
      },
    );
    assert.deepEqual(errors, []);
    fs.writeFileSync(
      path.join(scratch, "safety.json"),
      JSON.stringify(results, null, 2),
    );
    console.log("Artifacts: " + scratch);
  } finally {
    await app.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
