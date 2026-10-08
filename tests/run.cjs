const { _electron: electron } = require("playwright");
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const scratch = require("node:os").tmpdir() + "/composer-lab-tests";
fs.mkdirSync(scratch, { recursive: true });
(async () => {
  const app = await electron.launch({
    executablePath: process.env.HERMES_ELECTRON_PATH,
    args: [path.join(__dirname, "electron.cjs")],
    env: {
      ...process.env,
      CL_TEST_HOME: scratch + "/electron-user",
      ELECTRON_RUN_AS_NODE: "",
    },
  });
  const receipts = [];
  try {
    const page = await app.firstWindow();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.waitForFunction(() => window.fixture);
    const set = async (t) => {
      await page.evaluate((t) => fixture.set(t), t);
      await page.waitForTimeout(90);
    };
    const read = () => page.evaluate(() => fixture.read());
    const key = async (k) => {
      await page.locator("#editor").press(k);
      await page.waitForTimeout(90);
    };
    const check = async (name, fn) => {
      await fn();
      receipts.push({ name, status: "pass" });
      console.log("PASS", name);
    };
    await check(
      "idle uses native caret; external selection/click never installs blink state",
      async () => {
        await set("ordinary");
        await page.waitForTimeout(250);
        const result = await page.evaluate(async () => {
          const root = document.getElementById("editor"),
            before = document.activeElement;
          document.dispatchEvent(new Event("selectionchange"));
          document.body.dispatchEvent(
            new MouseEvent("click", { bubbles: true }),
          );
          await new Promise(requestAnimationFrame);
          return {
            native: !root.hasAttribute("data-cl-caret"),
            hidden: document.querySelector(".cl-caret-layer").hidden,
            focus: document.activeElement === before,
            animations: document.querySelector(".cl-caret").getAnimations()
              .length,
          };
        });
        assert.deepEqual(result, {
          native: true,
          hidden: true,
          focus: true,
          animations: 0,
        });
      },
    );
    await check(
      "one moving cursor; no trail even with old stored trail preference",
      async () => {
        await set("smooth movement");
        await page.waitForTimeout(250);
        await page.evaluate(() => (settings.trail = true));
        await page.locator("#editor").press("ArrowLeft");
        await page.waitForTimeout(30);
        assert.equal(await page.locator(".cl-caret").count(), 1);
        assert.equal(await page.locator(".cl-trail").count(), 0);
        assert.equal(
          await page.locator(".cl-caret-layer").evaluate((e) => e.hidden),
          false,
        );
        await page.waitForTimeout(200);
        assert.equal(await page.locator("[data-cl-caret]").count(), 0);
      },
    );
    await check(
      "Cmd+Backspace deletes list body; Backspace exits without leftover spaces",
      async () => {
        await set("1. parent\n2. content");
        await key("Meta+Backspace");
        assert.equal(await read(), "1. parent\n2. ");
        await key("Backspace");
        assert.equal((await read()).trimEnd(), "1. parent");
        assert.ok(!(await read()).endsWith(" "));
      },
    );
    await check(
      "nested ordered items restart at one and lifting restores outer numbering",
      async () => {
        await set("1. parent\n2. child\n3. next");
        await page.evaluate(() => fixture.caretAt(17));
        await key("Tab");
        assert.equal(await read(), "1. parent\n   1. child\n2. next");
        await key("Shift+Tab");
        assert.equal(await read(), "1. parent\n2. child\n3. next");
      },
    );
    await check(
      "Backspace at list text start lifts without whitespace remnants",
      async () => {
        await set("1. first\n   1. child");
        await page.evaluate(() => fixture.caretAt(15));
        await key("Backspace");
        assert.equal(await read(), "1. first\n2. child");
        // At the very line start Backspace stays native (joins lines).
        await set("- a\n- b");
        await page.evaluate(() => fixture.caretAt(4));
        await key("Backspace");
        assert.equal(await read(), "- a- b");
        // Inside a task box / number it deletes one character only.
        await set("- [x] todo");
        await page.evaluate(() => fixture.caretAt(4));
        await key("Backspace");
        assert.equal(await read(), "- [] todo");
      },
    );
    await check("top-level Shift+Tab keeps the marker; Backspace removes it", async () => {
      await set("1. content");
      await key("Shift+Tab");
      assert.equal(await read(), "1. content");
      assert.equal(await page.evaluate(() => document.activeElement.id), "editor");
      await page.evaluate(() => fixture.caretAt(3));
      await key("Backspace");
      assert.equal(await read(), "content");
    });
    await check("undo/redo recover nested list transaction", async () => {
      await set("1. parent\n2. child");
      await key("Tab");
      const nested = await read();
      await page.evaluate(() => fixture.undo());
      await page.waitForTimeout(90);
      assert.equal(await read(), "1. parent\n2. child");
      await page.evaluate(() => fixture.redo());
      await page.waitForTimeout(90);
      assert.equal(await read(), nested);
    });
    await check(
      "body color stays inherited after typing/deleting and foreign inline color",
      async () => {
        await set("1. white text");
        await key("Meta+Backspace");
        await page.locator("#editor").pressSequentially("white again");
        await page.waitForTimeout(90);
        let result = await page.evaluate(() => {
          const e = document.getElementById("editor"),
            n = [...e.childNodes].filter((n) => n.nodeType === 3).at(-1);
          const span = document.createElement("span");
          span.style.color = "rgb(0,255,0)";
          n.replaceWith(span);
          span.append(n);
          return {
            body: getComputedStyle(span).color,
            root: getComputedStyle(e).color,
          };
        });
        assert.equal(result.body, result.root);
        await key("Backspace");
        await page.locator("#editor").pressSequentially("n");
        await page.waitForTimeout(90);
        result = await page.evaluate(() => {
          const e = document.getElementById("editor");
          return [...e.querySelectorAll("span")]
            .every(
              (n) => getComputedStyle(n).color === getComputedStyle(e).color,
            );
        });
        assert.equal(result, true);
      },
    );
    await check("Enter remains send; Shift+Enter continues list", async () => {
      await set("1. item");
      await key("Enter");
      assert.equal(await page.evaluate(() => window.submitted), "1. item");
      await key("Shift+Enter");
      assert.equal(await read(), "1. item\n2. ");
    });
    await check("non-list Tab passes through unchanged", async () => {
      await set("ordinary");
      assert.equal(
        await page.evaluate(() => {
          const e = new KeyboardEvent("keydown", {
            key: "Tab",
            bubbles: true,
            cancelable: true,
          });
          document.getElementById("editor").dispatchEvent(e);
          return e.defaultPrevented;
        }),
        false,
      );
    });
    await check("reference chip survives list nesting", async () => {
      await set("1. parent\n2. @file:`README.md` text");
      const before = await page.locator("[data-ref-text]").count();
      await key("Tab");
      assert.ok(before > 0);
      assert.equal(await page.locator("[data-ref-text]").count(), before);
      assert.ok((await read()).includes("@file:`README.md`"));
    });
    await check(
      "IME preedit moves smoothly then returns to native caret without text changes",
      async () => {
        await set("1. ");
        await page.waitForTimeout(250);
        const cdp = await page.context().newCDPSession(page);
        await cdp.send("Input.imeSetComposition", {
          text: "zhongwen",
          selectionStart: 8,
          selectionEnd: 8,
        });
        await page.waitForTimeout(30);
        assert.equal(
          await page.locator(".cl-caret-layer").evaluate((e) => e.hidden),
          false,
        );
        await page.waitForTimeout(220);
        assert.equal(await page.locator("[data-cl-caret]").count(), 0);
        await cdp.send("Input.imeSetComposition", {
          text: "中文",
          selectionStart: 0,
          selectionEnd: 2,
        });
        await cdp.send("Input.insertText", { text: "中文" });
        await page.waitForTimeout(250);
        assert.equal(await read(), "1. 中文");
        assert.equal(await page.locator(".cl-trail").count(), 0);
        await cdp.detach();
      },
    );
    await check("host DOM is never restructured; markers are highlights", async () => {
      await set("1. a\n   - b\n- [ ] c");
      await page.waitForTimeout(120);
      const r = await page.evaluate(() => ({
        wrappers: document.querySelectorAll("#editor span:not([data-ref-text]),#editor div,#editor p").length,
        marks: CSS.highlights.get("cl-list-mark")?.size || 0,
        tasks: CSS.highlights.get("cl-list-task")?.size || 0,
      }));
      assert.deepEqual(r, { wrappers: 0, marks: 3, tasks: 1 });
    });
    await check("caret on a fresh empty line never animates from the editor corner", async () => {
      await set("- item");
      await page.waitForTimeout(250);
      await key("Shift+Enter");
      await key("Shift+Enter");
      const samples = [];
      for (let i = 0; i < 6; i++) {
        samples.push(
          await page.evaluate(() => {
            const l = document.querySelector(".cl-caret-layer"),
              e = document.getElementById("editor").getBoundingClientRect(),
              m = /translate3d\(([-\d.]+)px, ([-\d.]+)px/.exec(l.firstChild.style.transform);
            return l.hidden || !m ? null : [Number(m[1]) - e.left, Number(m[2]) - e.top];
          }),
        );
        await page.waitForTimeout(25);
      }
      for (const s of samples.filter(Boolean))
        assert.ok(!(s[0] < 20 && s[1] < 20), `overlay at editor corner ${s}`);
      assert.match(await read(), /^- item\n+$/);
    });
    await check("lost compositionend self-heals on the next real key", async () => {
      await set("- a");
      await page.evaluate(() =>
        document.getElementById("editor").dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true })),
      );
      const prevented = await page.evaluate(() => {
        const ed = document.getElementById("editor"),
          fire = () => {
            const e = new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true, cancelable: true });
            ed.dispatchEvent(e);
            return e.defaultPrevented;
          };
        return [fire(), fire()];
      });
      // First key is left to the host's own recovery, the next one works again.
      assert.deepEqual(prevented, [false, true]);
      assert.equal(await read(), "- a\n- ");
    });
    await check("Tab goes to the host first; indents only when the host leaves it", async () => {
      await set("- a\n- @fil");
      const hostTook = await page.evaluate(() => {
        const ed = document.getElementById("editor"),
          host = (e) => e.key === "Tab" && e.preventDefault();
        ed.addEventListener("keydown", host);
        const e = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
        ed.dispatchEvent(e);
        ed.removeEventListener("keydown", host);
        return e.defaultPrevented;
      });
      assert.equal(hostTook, true);
      assert.equal(await read(), "- a\n- @fil");
      await set("- a\n- see /usr/x");
      await key("Tab");
      assert.equal(await read(), "- a\n  - see /usr/x");
      assert.equal(await page.evaluate(() => document.activeElement.id), "editor");
    });
    await check(
      "disposal restores native source without changing text or focus",
      async () => {
        const before = await read();
        const same = await page.evaluate(() => {
          const active = document.activeElement;
          lists.dispose();
          caret.dispose();
          return active === document.activeElement;
        });
        assert.equal(same, true);
        assert.equal(await read(), before);
        assert.equal(
          await page
            .locator("[data-cl-managed],[data-cl-caret],.cl-caret-layer")
            .count(),
          0,
        );
        assert.equal(await page.evaluate(() => CSS.highlights.size), 0);
      },
    );
    assert.deepEqual(await page.evaluate(() => fixtureErrors), []);
    assert.deepEqual(errors, []);
  } catch (e) {
    receipts.push({ status: "fail", error: e.stack });
    const page = app.windows()[0];
    if (page)
      console.log(
        "DIAGNOSTIC",
        await page.evaluate(() => ({
          html: document.getElementById("editor")?.innerHTML,
          text: window.fixture?.read(),
          errors: window.fixtureErrors,
        })),
      );
    console.error(e);
    process.exitCode = 1;
  } finally {
    fs.writeFileSync(
      scratch + "/regression.json",
      JSON.stringify(receipts, null, 2),
    );
    await app.close();
  }
})();
