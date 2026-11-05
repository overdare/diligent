// @summary Node Playwright worker, avoiding Bun's Windows remote-debugging-pipe limitation.
const { chromium } = require("@playwright/test");
const { mkdir } = require("node:fs/promises");
const { resolve, join } = require("node:path");
const assert = require("node:assert/strict");

(async () => {
  const base = process.argv[2];
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe",
    headless: true,
    timeout: 15_000,
  });
  const page = await browser.newPage({ viewport: { width: 1100, height: 780 } });
  page.setDefaultTimeout(process.env.CLAUDE_BROWSER_REAL === "1" ? 30_000 : 10_000);
  // Terminal transport/IME acceptance must not wait for an external font CDN.
  // Native OS composition and the user's actual font environment are checked separately.
  await page.context().route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, (route) => route.abort());
  const errors = [];
  const inputFrames = [];
  let primaryDimensions;
  let primaryOwner = false;
  const statusEvents = [];
  const until = async (condition) => {
    for (let i = 0; i < 400; i++) {
      if (await condition()) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error("Terminal synchronization timed out");
  };
  page.on("websocket", (socket) => {
    socket.on("framereceived", ({ payload }) => {
      try {
        const message = JSON.parse(String(payload));
        if (["reset", "resize"].includes(message.type)) primaryDimensions = [message.cols, message.rows];
        if (message.type === "control") primaryOwner = message.resizeOwner;
        if (message.type === "status") statusEvents.push(message.status);
      } catch {}
    });
    socket.on("framesent", ({ payload }) => {
      try {
        const message = JSON.parse(String(payload));
        if (message.type === "input") inputFrames.push(message.data);
      } catch {}
    });
  });
  page.on("pageerror", (error) => errors.push(error.message));
  const artifacts = resolve("artifacts/claude-host");
  await mkdir(artifacts, { recursive: true });
  const endProcess = async (target) => {
    await target.getByText("···", { exact: true }).click();
    await target.getByRole("button", { name: /^End (Claude|terminal) process$/ }).click();
  };
  let releaseBootstrap;
  try {
    if (process.env.CLAUDE_BROWSER_REAL !== "1") {
      const bootstrapGate = new Promise((resolve) => {
        releaseBootstrap = resolve;
      });
      await page.route("**/claude/bootstrap", async (route) => {
        await bootstrapGate;
        await route.continue();
      });
    }
    await page.goto(`${base}${process.env.CLAUDE_BROWSER_ROOT === "1" ? "/" : "/claude"}`);
    if (process.env.CLAUDE_BROWSER_REAL === "1") {
      await page
        .locator(".xterm-rows")
        .filter({ hasText: /Welcome to Claude Code|Let's get started|Choose the text style/i })
        .waitFor();
      assert.equal(await page.getByRole("alert").count(), 0);
      await page.screenshot({ path: join(artifacts, "claude-code-startup.png"), fullPage: true });
      await endProcess(page);
      await page.getByRole("button", { name: "Resume latest" }).waitFor();
      return;
    }
    await page.getByText("Connecting to your terminal…", { exact: true }).waitFor();
    await page.screenshot({ path: join(artifacts, "terminal-loading.png"), fullPage: true });
    releaseBootstrap();
    await page.getByText("Console fixture ready", { exact: false }).waitFor();
    assert.equal(await page.getByText("Connecting to your terminal…", { exact: true }).count(), 0);
    // During Korean composition the PTY receives only committed text. The preedit
    // must remain visible at the terminal cursor under the actual product CSS.
    await page.locator(".xterm-helper-textarea").focus();
    const beforeComposition = inputFrames.length;
    await page.locator(".xterm-helper-textarea").evaluate((textarea) => {
      textarea.value = "";
      textarea.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "" }));
    });
    for (const syllable of ["ㄱ", "그", "글"]) {
      await page.locator(".xterm-helper-textarea").evaluate((textarea, data) => {
        textarea.value = data;
        textarea.setSelectionRange(data.length, data.length);
        textarea.dispatchEvent(new CompositionEvent("compositionupdate", { bubbles: true, data }));
        textarea.dispatchEvent(
          new InputEvent("input", {
            bubbles: true,
            composed: true,
            inputType: "insertCompositionText",
            isComposing: true,
            data,
          }),
        );
      }, syllable);
      await page.locator(".composition-view.active").filter({ hasText: syllable }).waitFor();
      const preedit = await page.locator(".composition-view.active").evaluate((element) => {
        const box = element.getBoundingClientRect();
        const bounds = document.querySelector('[aria-label="Claude Code terminal"]').getBoundingClientRect();
        const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
        return {
          visible: getComputedStyle(element).display !== "none" && box.width > 0 && box.height > 0,
          inside:
            box.left >= bounds.left &&
            box.top >= bounds.top &&
            box.right <= bounds.right &&
            box.bottom <= bounds.bottom,
          uncovered: hit === element || element.contains(hit),
        };
      });
      assert.deepEqual(preedit, { visible: true, inside: true, uncovered: true });
      assert.deepEqual(inputFrames.slice(beforeComposition), []);
    }
    await page.screenshot({ path: join(artifacts, "korean-preedit.png") });
    await page.locator(".xterm-helper-textarea").evaluate((textarea) => {
      textarea.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "글" }));
      textarea.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: "글" }));
    });
    await page.locator(".composition-view.active").waitFor({ state: "hidden" });
    await page.keyboard.press("Enter");
    await page.getByText("ECHO 글", { exact: true }).waitFor();
    // An embedded input method can deliver IME-tagged text after focus changed,
    // without starting a composition owned by this terminal's helper.
    await page.locator(".xterm-helper-textarea").evaluate((textarea) => {
      textarea.dispatchEvent(
        new KeyboardEvent("keypress", {
          bubbles: true,
          key: "키",
          charCode: "키".charCodeAt(0),
          isComposing: true,
        }),
      );
    });
    await page.keyboard.press("Enter");
    await page.getByText("ECHO 키", { exact: true }).waitFor();
    await page.locator(".xterm-helper-textarea").evaluate((textarea) => {
      textarea.value = "직접";
      textarea.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          composed: true,
          inputType: "insertText",
          isComposing: true,
          data: "직접",
        }),
      );
    });
    await page.keyboard.press("Enter");
    await page.getByText("ECHO 직접", { exact: true }).waitFor();
    await page.locator(".xterm-helper-textarea").evaluate(async (textarea) => {
      textarea.value = "";
      textarea.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "" }));
      textarea.value = "한";
      textarea.setSelectionRange(1, 1);
      textarea.dispatchEvent(new CompositionEvent("compositionupdate", { bubbles: true, data: "한" }));
      await new Promise((resolve) => setTimeout(resolve, 0));
      textarea.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "한" }));
      textarea.dispatchEvent(
        new InputEvent("input", { bubbles: true, composed: true, inputType: "insertText", data: "한" }),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await page.keyboard.press("Enter");
    await page.getByText("ECHO 한", { exact: true }).waitFor();
    await page.locator(".xterm-helper-textarea").evaluate(async (textarea) => {
      textarea.value = "";
      for (const syllable of ["하", "하"]) {
        const prefix = textarea.value;
        textarea.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "" }));
        textarea.value = prefix + syllable;
        textarea.setSelectionRange(textarea.value.length, textarea.value.length);
        textarea.dispatchEvent(new CompositionEvent("compositionupdate", { bubbles: true, data: syllable }));
        await new Promise((resolve) => setTimeout(resolve, 0));
        textarea.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: syllable }));
        textarea.dispatchEvent(
          new InputEvent("input", { bubbles: true, composed: true, inputType: "insertText", data: syllable }),
        );
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    });
    await page.keyboard.press("Enter");
    await page.getByText("ECHO 하하", { exact: true }).waitFor();
    // Embedded Windows key adapters can expose left/right modifier virtual-key
    // codes. xterm recognizes only generic Shift (16), and otherwise flushes IME.
    for (const [key, code, keyCode, isComposing] of [
      ["Shift", "ShiftLeft", 16, false],
      ["Shift", "ShiftLeft", 160, false],
      ["Shift", "ShiftRight", 161, false],
      ["Shift", "ShiftRight", 0, false],
      ["t", "KeyT", 84, true],
      ["Process", "KeyT", 0, false],
      ["HangulMode", "Lang1", 21, false],
      ["Unidentified", "Lang1", 21, false],
    ]) {
      const beforeShift = inputFrames.length;
      const committed = keyCode === 21 ? "해" : "했";
      await page.locator(".xterm-helper-textarea").evaluate(
        async (textarea, [key, code, keyCode, isComposing]) => {
          textarea.value = "";
          textarea.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "" }));
          textarea.value = "해";
          textarea.setSelectionRange(1, 1);
          textarea.dispatchEvent(new CompositionEvent("compositionupdate", { bubbles: true, data: "해" }));
          await new Promise((resolve) => setTimeout(resolve, 0));
          textarea.dispatchEvent(
            new KeyboardEvent("keydown", { bubbles: true, key, code, keyCode, isComposing, shiftKey: key === "Shift" }),
          );
        },
        [key, code, keyCode, isComposing],
      );
      assert.deepEqual(inputFrames.slice(beforeShift), [], `${key} ${keyCode} committed unfinished Korean`);
      await page.locator(".composition-view.active").filter({ hasText: "해" }).waitFor();
      await page.locator(".xterm-helper-textarea").evaluate(async (textarea, committed) => {
        textarea.value = committed;
        textarea.setSelectionRange(1, 1);
        textarea.dispatchEvent(new CompositionEvent("compositionupdate", { bubbles: true, data: committed }));
        await new Promise((resolve) => setTimeout(resolve, 0));
        textarea.dispatchEvent(
          new KeyboardEvent("keyup", { bubbles: true, key: "Shift", code: "ShiftLeft", keyCode: 160 }),
        );
        textarea.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: committed }));
        textarea.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: committed }));
        await new Promise((resolve) => setTimeout(resolve, 0));
      }, committed);
      await until(() => inputFrames.slice(beforeShift).join("") === committed);
      await page.keyboard.press("Enter");
      await page.getByText(`ECHO ${committed}`, { exact: true }).last().waitFor();
    }
    // Non-text onData (for example focus reporting) cannot release ownership of
    // xterm's deferred composition and let the following input commit it twice.
    await page.keyboard.type("FOCUS ON");
    await page.keyboard.press("Enter");
    await page.getByText("FOCUS_REPORTING_ON", { exact: true }).waitFor();
    const beforeFocusCommit = inputFrames.length;
    await page.locator(".xterm-helper-textarea").evaluate(async (textarea) => {
      textarea.value = "";
      textarea.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "" }));
      textarea.value = "한";
      textarea.setSelectionRange(1, 1);
      textarea.dispatchEvent(new CompositionEvent("compositionupdate", { bubbles: true, data: "한" }));
      await new Promise((resolve) => setTimeout(resolve, 0));
      textarea.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "한" }));
      textarea.dispatchEvent(new FocusEvent("focus"));
      textarea.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: "한" }));
    });
    await until(
      () =>
        inputFrames
          .slice(beforeFocusCommit)
          .filter((value) => !/^\x1b\[[IO]$/.test(value))
          .join("") === "한",
    );
    await page.waitForTimeout(25);
    assert.equal(
      inputFrames
        .slice(beforeFocusCommit)
        .filter((value) => !/^\x1b\[[IO]$/.test(value))
        .join(""),
      "한",
    );
    await page.keyboard.press("Control+c");
    await page.keyboard.type("FOCUS OFF");
    await page.keyboard.press("Enter");
    await page.getByText("FOCUS_REPORTING_OFF", { exact: true }).waitFor();
    // A real next key can precede xterm's deferred commit. Preserve the commit
    // and the actual next input, in that order, rather than swallowing either.
    for (const [key, code, keyCode, expected] of [
      ["Enter", "Enter", 13, "\r"],
      ["Backspace", "Backspace", 8, "\x7f"],
      ["a", "KeyA", 65, "a"],
    ]) {
      const beforeNext = inputFrames.length;
      await page.locator(".xterm-helper-textarea").evaluate(
        async (textarea, [key, code, keyCode]) => {
          textarea.value = "";
          textarea.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "" }));
          textarea.value = "한";
          textarea.setSelectionRange(1, 1);
          textarea.dispatchEvent(new CompositionEvent("compositionupdate", { bubbles: true, data: "한" }));
          await new Promise((resolve) => setTimeout(resolve, 0));
          textarea.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "한" }));
          const proceed = textarea.dispatchEvent(
            new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key, code, keyCode }),
          );
          if (key === "a" && proceed)
            textarea.dispatchEvent(
              new KeyboardEvent("keypress", { bubbles: true, key, code, keyCode: 97, charCode: 97 }),
            );
        },
        [key, code, keyCode],
      );
      await until(() => inputFrames.slice(beforeNext).join("") === `한${expected}`).catch(() =>
        assert.equal(inputFrames.slice(beforeNext).join(""), `한${expected}`, `immediate next ${key}`),
      );
      await page.waitForTimeout(25);
      assert.equal(inputFrames.slice(beforeNext).join(""), `한${expected}`);
      await page.keyboard.press("Control+c");
    }
    for (const scenario of ["stale-end", "trailing-English"]) {
      await page.locator(".xterm-helper-textarea").evaluate(async (textarea, scenario) => {
        const actual = scenario === "stale-end" ? "하" : "한";
        textarea.value = "";
        textarea.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "" }));
        textarea.value = actual;
        textarea.setSelectionRange(1, 1);
        textarea.dispatchEvent(new CompositionEvent("compositionupdate", { bubbles: true, data: actual }));
        await new Promise((resolve) => setTimeout(resolve, 0));
        textarea.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "한" }));
        textarea.dispatchEvent(
          new InputEvent("input", { bubbles: true, composed: true, inputType: "insertText", data: actual }),
        );
        if (scenario === "trailing-English") {
          textarea.value += "a";
          textarea.dispatchEvent(
            new InputEvent("input", { bubbles: true, composed: true, inputType: "insertText", data: "a" }),
          );
        }
        await new Promise((resolve) => setTimeout(resolve, 0));
      }, scenario);
      await page.keyboard.press("Enter");
      await page.getByText(scenario === "stale-end" ? "ECHO 하" : "ECHO 한a", { exact: true }).waitFor();
    }
    await page.locator(".xterm-helper-textarea").focus();
    await page.keyboard.insertText("Studio 한글");
    await page.keyboard.press("Enter");
    await page.getByText("ECHO Studio 한글", { exact: false }).waitFor();
    const { id } = await (await page.request.get(`${base}/test/status`)).json();
    await page.goto(base);
    await page.waitForURL(`${base}/claude`);
    await page.getByText("ECHO Studio 한글", { exact: false }).waitFor();
    assert.equal((await (await page.request.get(`${base}/test/status`)).json()).id, id);
    await page.getByRole("link", { name: "Open OVERDARE AI Agent", exact: true }).click();
    await page.waitForURL(`${base}/?view=agent`);
    await page.getByRole("link", { name: "Open Claude Code", exact: true }).waitFor();
    assert.equal((await (await page.request.get(`${base}/studio/view`)).json()).view, "agent");
    await page.goto(base);
    // This terminal fixture intentionally has no Diligent RPC server. Read the
    // real header destination rather than clicking through its offline overlay.
    await page.goto(
      `${base}${await page.getByRole("link", { name: "Open Claude Code", exact: true }).getAttribute("href")}`,
    );
    await page.getByText("ECHO Studio 한글", { exact: false }).waitFor();
    assert.equal((await (await page.request.get(`${base}/test/status`)).json()).id, id);
    const interruptedBefore = await page.getByText("INTERRUPTED", { exact: true }).count();
    await page.keyboard.press("Control+c");
    await until(async () => (await page.getByText("INTERRUPTED", { exact: true }).count()) > interruptedBefore);
    await page.setViewportSize({ width: 760, height: 600 });
    await page.getByText("RESIZED", { exact: false }).last().waitFor();
    await page.reload();
    await page.getByText("ECHO Studio 한글", { exact: false }).waitFor();
    const restored = await (await page.request.get(`${base}/test/status`)).json();
    assert.equal(restored.id, id);
    assert.equal(restored.conversationId, "14b6d3c0-b5b3-4d88-a880-c5ea8cd55d51");
    // A smaller second reader must replay at the shared grid, rather than
    // independently resizing the PTY on every running status or observer callback.
    const observer = await browser.newPage({ viewport: { width: 480, height: 440 } });
    observer.setDefaultTimeout(10_000);
    await observer.context().route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, (route) => route.abort());
    let observerDimensions;
    let observerOwner = false;
    observer.on("pageerror", (error) => errors.push(error.message));
    observer.on("websocket", (socket) => {
      socket.on("framereceived", ({ payload }) => {
        try {
          const message = JSON.parse(String(payload));
          if (["reset", "resize"].includes(message.type)) observerDimensions = [message.cols, message.rows];
          if (message.type === "control") observerOwner = message.resizeOwner;
        } catch {}
      });
    });
    await observer.goto(`${base}/claude`);
    await observer.getByText("ECHO Studio 한글", { exact: false }).waitFor();
    assert.deepEqual(observerDimensions, primaryDimensions);
    assert.equal(primaryOwner, true);
    assert.equal(observerOwner, false);
    const previousDimensions = primaryDimensions;
    await page.setViewportSize({ width: 1000, height: 720 });
    await until(() => JSON.stringify(primaryDimensions) !== JSON.stringify(previousDimensions));
    await until(() => JSON.stringify(observerDimensions) === JSON.stringify(primaryDimensions));
    const screenWidth = (target) =>
      target.locator(".xterm-screen").evaluate((element) => element.getBoundingClientRect().width);
    await observer.waitForFunction(
      (width) => Math.abs(document.querySelector(".xterm-screen").getBoundingClientRect().width - width) < 1,
      await screenWidth(page),
    );
    await observer.getByRole("region", { name: "Claude Code terminal" }).click({ position: { x: 8, y: 8 } });
    await until(() => observerOwner && !primaryOwner && primaryDimensions[0] < previousDimensions[0]);
    await until(() => JSON.stringify(observerDimensions) === JSON.stringify(primaryDimensions));
    await observer.close();
    await until(() => primaryOwner && primaryDimensions[0] > previousDimensions[0]);
    await page.getByRole("button", { name: "Open sidebar", exact: true }).click();
    const dialog = page.getByRole("complementary", { name: "Conversations" });
    await dialog.getByRole("button", { name: /Latest arena/ }).waitFor();
    assert.equal(await dialog.getByRole("button", { name: /Latest arena/ }).getAttribute("aria-current"), "true");
    await page.getByRole("textbox", { name: "Search sessions" }).fill("Older");
    assert.equal(await dialog.getByRole("button", { name: /Latest arena/ }).count(), 0);
    await page.screenshot({ path: join(artifacts, "session-picker.png"), fullPage: true });
    await dialog.getByRole("button", { name: /Older design/ }).click();
    await until(async () => {
      const status = await (await page.request.get(`${base}/test/status`)).json();
      return status.state === "running" && status.conversationId === "24b6d3c0-b5b3-4d88-a880-c5ea8cd55d51";
    });
    const selected = await (await page.request.get(`${base}/test/status`)).json();
    assert.notEqual(selected.id, id, JSON.stringify(statusEvents));
    await page.getByRole("button", { name: "New conversation", exact: true }).click();
    await until(async () => {
      const status = await (await page.request.get(`${base}/test/status`)).json();
      return (
        status.state === "running" &&
        status.conversationId &&
        !["14b6d3c0-b5b3-4d88-a880-c5ea8cd55d51", "24b6d3c0-b5b3-4d88-a880-c5ea8cd55d51"].includes(
          status.conversationId,
        )
      );
    });
    await page.getByText("Console fixture ready", { exact: false }).waitFor();
    assert.equal(await page.getByText("ECHO Studio 한글", { exact: false }).count(), 0);
    assert.deepEqual(errors, []);
    await page.screenshot({ path: join(artifacts, "terminal.png"), fullPage: true });
    const claudeBeforeSwitch = await (await page.request.get(`${base}/test/status`)).json();
    // The plain project shell has an independent PTY and no Claude history UI.
    await page.getByRole("link", { name: "Terminal", exact: true }).click();
    await page.getByRole("region", { name: "Project terminal" }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Open sidebar", exact: true }).count(), 0);
    await until(async () => (await (await page.request.get(`${base}/test/shell-status`)).json()).state === "running");
    const shellBefore = await (await page.request.get(`${base}/test/shell-status`)).json();
    assert.equal(shellBefore.conversationId, undefined);
    const shellView = page.locator(".xterm-rows");
    await shellView.filter({ hasText: process.platform === "win32" ? /PS .*>/ : /[$#]/ }).waitFor();
    await page.locator(".xterm-helper-textarea").focus();
    await page.keyboard.type(
      process.platform === "win32" ? "Write-Output 'OVERDARE_SHELL_READY'" : "printf 'OVERDARE_SHELL_READY\\n'",
    );
    await page.keyboard.press("Enter");
    await page.getByText("OVERDARE_SHELL_READY", { exact: true }).waitFor();
    await page.screenshot({ path: join(artifacts, "project-shell.png"), fullPage: true });
    // Studio panels can be much narrower than a standalone browser window.
    await page.setViewportSize({ width: 240, height: 600 });
    const switchBounds = await page.getByRole("link", { name: "Run Claude Code", exact: true }).boundingBox();
    assert.ok(
      switchBounds && switchBounds.x >= 0 && switchBounds.x + switchBounds.width <= 240,
      "Claude switch is clipped in a narrow Studio panel",
    );
    await page.evaluate(() => {
      window.__terminalDocumentMarker = "preserved";
    });
    await page.getByRole("link", { name: "Run Claude Code", exact: true }).click();
    await page.getByText("Console fixture ready", { exact: false }).waitFor();
    assert.equal(
      await page.evaluate(() => window.__terminalDocumentMarker),
      "preserved",
      "switching terminals must not unload the browser document",
    );
    assert.equal((await (await page.request.get(`${base}/test/status`)).json()).id, claudeBeforeSwitch.id);
    assert.equal((await (await page.request.get(`${base}/test/shell-status`)).json()).id, shellBefore.id);
    await page.getByRole("button", { name: "Open sidebar", exact: true }).click();
    await page
      .getByRole("complementary", { name: "Conversations" })
      .getByRole("button", { name: /Latest arena/ })
      .waitFor();
    await until(async () => {
      const bounds = await page.getByRole("complementary", { name: "Conversations" }).boundingBox();
      return bounds && Math.abs(bounds.x) < 1 && bounds.width === 240;
    });
    await page.screenshot({ path: join(artifacts, "session-picker-compact.png"), fullPage: true });
    await page.getByRole("button", { name: "Close sidebar", exact: true }).click();
    await page.getByRole("region", { name: "Claude Code terminal" }).waitFor();
    await endProcess(page);
    await page.getByRole("button", { name: "Resume latest" }).waitFor();
    await page.getByRole("link", { name: "Terminal", exact: true }).click();
    await page.getByText("OVERDARE_SHELL_READY", { exact: true }).waitFor();
    await endProcess(page);
    await page.getByRole("button", { name: "Start terminal" }).waitFor();
    assert.equal((await (await page.request.get(`${base}/test/shell-status`)).json()).state, "exited");
    assert.deepEqual(errors, []);
    await page.waitForTimeout(250);
    assert.equal((await (await page.request.get(`${base}/test/status`)).json()).state, "exited");
    await page.getByText("Session stopped.", { exact: true }).waitFor();
    await page.screenshot({ path: join(artifacts, "terminal-stopped.png"), fullPage: true });
    await page.goto(`${base}/claude`);
    await until(async () => {
      const status = await (await page.request.get(`${base}/test/status`)).json();
      return status.state === "running" && status.conversationId === "14b6d3c0-b5b3-4d88-a880-c5ea8cd55d51";
    });
    await endProcess(page);
    await page.getByRole("button", { name: "Resume latest" }).waitFor();
  } catch (error) {
    await page.screenshot({ path: join(artifacts, "terminal-failure.png") }).catch(() => {});
    console.error(
      "Browser page:",
      await page
        .locator("body")
        .innerText()
        .catch(() => "unavailable"),
      errors,
    );
    throw error;
  } finally {
    releaseBootstrap?.();
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
