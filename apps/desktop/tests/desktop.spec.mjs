import { test, expect } from "@playwright/test";
import { mkdtempSync, mkdirSync, rmSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { DesktopController } from "../../../packages/desktop/src/controller.ts";
import { FakeAgent } from "../../../packages/worker/src/fake.ts";
import { makeCli, credentialStore } from "./fixtures.mjs";

let desktop, root, workspace, testsSent, gatewayFailureCode, pickerSelection;
const previousLocalAppData = process.env.LOCALAPPDATA;
test.beforeEach(async ({ page }) => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "shot2agent-ui-")));
  workspace = join(root, "workspace");
  mkdirSync(workspace);
  process.env.LOCALAPPDATA = root;
  makeCli(root, "codex");
  makeCli(root, "claude");
  testsSent = 0;
  pickerSelection = null;
  gatewayFailureCode = "";
  const clipboard = {
    session: "ui-synthetic",
    async sequence() {
      return "1";
    },
    async readImage() {},
    async writeText() {
      return true;
    },
    async cleanFileCache() { return { deleted: 0, retained: 0 }; },
    close() {},
  };
  const discovery = async () =>
    ["codex", "claude"].map((provider) => ({
      provider,
      path: join(root, "npm", `${provider}.cmd`),
      version:
        provider === "claude" ? "2.1.305 (Claude Code)" : "codex-cli m7-test",
      status: "unverified_auth",
    }));
  desktop = new DesktopController(
    root,
    clipboard,
    undefined,
    "codex",
    discovery,
    {
      credentials: credentialStore(),
      testGateway: async (_gateway, token) => {
        if (gatewayFailureCode) throw new Error(gatewayFailureCode);
        testsSent++;
        if (token !== "synthetic-valid-token")
          throw new Error("GATEWAY_AUTH_FAILED");
        return {
          status: "synthetic_image_passed",
          requestsSent: 1,
          model: "glm-5.3-flash",
        };
      },
    },
  );
  await desktop.start();
  await page.exposeBinding("desktopInvoke", async (_source, command, args) => {
    if (command === "plugin:dialog|open") return pickerSelection;
    if (command !== "rpc") return undefined;
    const { request } = args;
    try {
      return { ok: true, value: await desktop.dispatch(request) };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
  await page.addInitScript(() => {
    window.__TAURI_INTERNALS__ = {
      invoke: (command, args) => window.desktopInvoke(command, args),
    };
  });
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto("/");
  await expect(page.getByText("添加你的第一个 AI 助手")).toBeVisible();
});
test.afterEach(async () => {
  await desktop.close();
  rmSync(root, { recursive: true, force: true });
  if (previousLocalAppData === undefined) delete process.env.LOCALAPPDATA;
  else process.env.LOCALAPPDATA = previousLocalAppData;
});
const nav = (page, name) =>
  page
    .getByRole("navigation")
    .getByRole("button", { name, exact: true })
    .click();
async function add(page, provider, id) {
  await nav(page, "AI 助手");
  await page.getByRole("button", { name: "添加 AI 助手", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "添加 AI 助手",
    exact: true,
  });
  await dialog.getByLabel("Agent 类型").selectOption(provider);
  await dialog.getByLabel("Agent 名称", { exact: false }).fill(id);
  if (provider === "claude-compatible-endpoint")
    await dialog
      .getByLabel("GLM Token", { exact: false })
      .fill("synthetic-valid-token");
  await dialog.getByRole("button", { name: "保存 Agent", exact: true }).click();
  await expect(dialog).not.toBeVisible();
}
async function seedTasks(count = 5) {
  const original = desktop.app.registry;
  desktop.app.setRegistry(
    original.map((entry) => ({
      profile: entry.profile,
      adapter: new FakeAgent(),
    })),
    desktop.app.profile.id,
    desktop.app.profile.version,
  );
  const bytes = await sharp({
    create: { width: 24, height: 20, channels: 3, background: "#88aa99" },
  })
    .png()
    .toBuffer();
  for (let i = 0; i < count; i++) {
    await desktop.app.submit(bytes, undefined, true);
    await desktop.app.work();
  }
}

test("real Vue + isolated controller: add, edit prefill, cancel, immutable tasks, default, remove and restore", async ({
  page,
}) => {
  await add(page, "codex", "my-codex");
  expect(testsSent).toBe(0);
  const first = desktop.app.profile.version;
  await seedTasks(1);
  const task = desktop.app.list()[0].submission;
  const codex = page
    .locator(".agent-entry")
    .filter({ has: page.getByRole("heading", { name: "my-codex 默认" }) });
  await expect(codex.getByRole("button", { name: /Token/ })).toHaveCount(0);
  await codex.getByRole("button", { name: "编辑配置" }).click();
  const editor = page.getByRole("dialog", { name: "编辑 Agent 配置" });
  await expect(editor.getByRole("heading")).toBeFocused();
  await expect(editor.getByLabel("Agent 名称", { exact: false })).toHaveValue(
    "my-codex",
  );
  await expect(editor.getByLabel("程序路径")).not.toHaveValue("");
  await editor.getByText("高级配置 · 工作区与提示词").click();
  await expect(editor.getByLabel("工作区", { exact: true })).toHaveValue(
    join(root, "Shot2Agent-Workspace"),
  );
  await editor.getByLabel("默认提示词").fill("Canceled prompt");
  await editor.getByRole("button", { name: "取消", exact: true }).click();
  expect(desktop.app.profile.version).toBe(first);
  await codex.getByRole("button", { name: "编辑配置" }).click();
  await editor.getByText("高级配置 · 工作区与提示词").click();
  await expect(editor.getByLabel("默认提示词")).not.toHaveValue(
    "Canceled prompt",
  );
  await editor.getByLabel("默认提示词").fill("Updated prompt");
  await editor.getByRole("button", { name: "保存 Agent" }).click();
  await expect(editor).not.toBeVisible();
  expect(desktop.app.profile.version).not.toBe(first);
  expect(desktop.app.get(task.taskId).submission.profileVersion).toBe(first);
  await add(page, "claude", "my-claude");
  const card = page
    .locator(".agent-entry")
    .filter({ has: page.getByRole("heading", { name: /^my-codex/ }) });
  await card.getByRole("button", { name: "设为默认" }).click();
  await expect(
    page.getByText("默认助手已更换，仅影响接下来的截图。"),
  ).toBeVisible();
  const claude = page
    .locator(".agent-entry")
    .filter({ has: page.getByRole("heading", { name: /^my-claude/ }) });
  await claude.getByRole("button", { name: "移除 Agent" }).click();
  await page.getByText("已移除的助手（1）").click();
  await page.getByRole("button", { name: "恢复 Agent" }).click();
  await expect(claude.getByRole("button", { name: "设为默认" })).toBeVisible();
});

test("GLM save is local; explicit test has consent, Token errors visible, replacement remains unqualified", async ({
  page,
}) => {
  await add(page, "claude-compatible-endpoint", "my-glm");
  expect(testsSent).toBe(0);
  await expect(page.getByText(/未验证图片能力/)).toBeVisible();
  await page.getByRole("button", { name: "测试连接", exact: true }).click();
  await expect(page.getByText(/合成图片测试通过/)).toBeVisible();
  expect(testsSent).toBe(1);
  await page.getByRole("button", { name: "更换 Token" }).click();
  const dialog = page.getByRole("dialog", { name: "编辑 Agent 配置" });
  await expect(dialog.getByLabel("GLM Token", { exact: false })).toHaveValue(
    "",
  );
  await expect(dialog.getByLabel("模型", { exact: true })).toHaveValue(
    "glm-5.3-flash",
  );
  await expect(dialog.getByLabel("GLM 端点")).toHaveValue(
    "https://open.bigmodel.cn/api/anthropic",
  );
  await dialog
    .getByLabel("GLM Token", { exact: false })
    .fill("synthetic-wrong-token");
  await dialog.getByRole("button", { name: "保存 Agent" }).click();
  await expect(dialog).not.toBeVisible();
  expect(testsSent).toBe(1);
  await page.getByRole("button", { name: "测试连接", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("GLM 拒绝了这个 Token");
  expect(testsSent).toBe(2);
  expect(desktop.app.profile.id).toBe("my-glm");
});

test("history details, Copy, selection, deletion, clear; capture consent and output settings", async ({
  page,
}) => {
  await add(page, "codex", "history-codex");
  await seedTasks();
  await nav(page, "首页");
  await expect(page.locator(".tasks li")).toHaveCount(3);
  await page.getByRole("button", { name: "复制文本" }).first().click();
  await expect(page.getByText("已复制结果，可以粘贴。")).toBeVisible();
  await page.locator(".task-title").first().click();
  await expect(page.getByRole("dialog", { name: "结果详情" })).toBeVisible();
  await page.getByRole("button", { name: "关闭详情" }).click();
  await nav(page, "历史记录");
  await expect(page.locator(".tasks li")).toHaveCount(5);
  await page.getByLabel("搜索历史").fill("no-match");
  await expect(
    page.getByText("没有匹配的任务，试试其他关键词。"),
  ).toBeVisible();
  await page.getByLabel("搜索历史").fill("");
  await page.getByRole("button", { name: "删除", exact: true }).first().click();
  await expect(page.locator(".tasks li")).toHaveCount(4);
  await page.locator(".task-check input").first().check();
  await page.getByRole("button", { name: "删除所选（1）" }).click();
  await expect(page.locator(".tasks li")).toHaveCount(3);
  await page.getByRole("button", { name: "清除成功历史" }).click();
  await expect(page.locator(".tasks li")).toHaveCount(0);
  await nav(page, "设置");
  await page.getByLabel("监听剪贴板中的新图片").check();
  await page.getByLabel("提交方式").selectOption("auto");
  await page
    .getByLabel("我同意新截图自动发送给所选 Agent。云模型会收到图片。")
    .check();
  await page.getByLabel("剪贴板返回").selectOption("manual");
  await page.getByRole("button", { name: "应用设置" }).click();
  await expect(
    page.getByText("设置已保存。仅监听此后新增的图片。"),
  ).toBeVisible();
  expect(desktop.settings.desktop.mode).toBe("auto");
  expect(desktop.settings.delivery.clipboard).toBe("manual");
});

for (const [width, height] of [
  [1040, 760],
  [720, 560],
  [480, 640],
]) {
  test(`layout and visible editor ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await add(page, "codex", "layout-codex");
    await seedTasks(3);
    await nav(page, "历史记录");
    await expect(page.locator(".tasks li")).toHaveCount(3);
    for (const name of ["首页", "AI 助手", "历史记录", "设置"]) {
      await nav(page, name);
      await page.screenshot({
        path: `build/ui-evidence/${width}-${name}.png`,
        fullPage: true,
      });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    }
    await nav(page, "AI 助手");
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.getByRole("button", { name: "编辑配置" }).click();
    const dialog = page.getByRole("dialog", { name: "编辑 Agent 配置" });
    await expect(dialog.getByRole("heading")).toBeFocused();
    await dialog.getByText("高级配置 · 工作区与提示词").click();
    await dialog.getByLabel("默认提示词").scrollIntoViewIfNeeded();
    await expect(dialog.getByLabel("默认提示词")).toBeInViewport();
    await page.screenshot({ path: `build/ui-evidence/${width}-editor.png` });
    expect(
      await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
  });
}

test("first-run, preview, GLM form and errors have visible states; optional test can be canceled", async ({
  page,
}) => {
  await page.screenshot({ path: "build/ui-evidence/first-run.png" });
  await add(page, "claude-compatible-endpoint", "optional-glm");
  page.removeAllListeners("dialog");
  page.on("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "测试连接", exact: true }).click();
  expect(testsSent).toBe(0);
  await page.getByRole("button", { name: "编辑配置" }).click();
  await page.screenshot({ path: "build/ui-evidence/glm-editor.png" });
  await page.keyboard.press("Escape");
  await nav(page, "首页");
  await expect(
    page.getByRole("button", { name: "处理剪贴板图片" }),
  ).toBeEnabled();
  await add(page, "codex", "preview-codex");
  await desktop.dispatch({
    v: 1,
    command: "configure",
    capture: { enabled: true, mode: "confirm" },
    delivery: { clipboard: "manual" },
  });
  const bytes = await sharp({
    create: { width: 240, height: 120, channels: 3, background: "#456956" },
  })
    .png()
    .toBuffer();
  desktop.app.clipboard.sequence = async () => "2";
  desktop.app.clipboard.readImage = async () => ({ bytes, sequence: "2" });
  await desktop.app.observe(false);
  await nav(page, "首页");
  await expect(
    page.getByRole("img", { name: "待确认的截图预览" }),
  ).toBeVisible();
  await page.screenshot({ path: "build/ui-evidence/preview.png" });
  await page.getByRole("button", { name: "丢弃", exact: true }).click();
  await expect(page.getByText("已丢弃预览，没有创建任务。")).toBeVisible();
  expect(desktop.app.list()).toHaveLength(0);
});

test("history pages and searches older than the newest 50 tasks", async ({
  page,
}) => {
  await add(page, "codex", "old-assistant");
  await seedTasks(1);
  await add(page, "codex", "recent-assistant");
  await seedTasks(50);
  await nav(page, "历史记录");
  await expect(page.locator(".tasks li")).toHaveCount(50);
  await page.getByRole("button", { name: "下一页", exact: true }).click();
  await expect(page.locator(".tasks li")).toHaveCount(1);
  await expect(page.locator(".task-title")).toContainText("old-assistant");
  await page.getByLabel("搜索历史").fill("old-assistant");
  await expect(
    page.getByRole("button", { name: "上一页", exact: true }),
  ).toBeDisabled();
  await expect(page.locator(".tasks li")).toHaveCount(1);
  await page.getByRole("button", { name: "复制文本", exact: true }).click();
  await expect(page.getByText("已复制结果，可以粘贴。")).toBeVisible();
  await page.getByRole("button", { name: "删除", exact: true }).click();
  await expect(page.locator(".tasks li")).toHaveCount(0);
  expect(desktop.app.list()).toHaveLength(50);
});

test("appearance switches immediately, persists after reload and does not reconfigure the Worker", async ({
  page,
}) => {
  await add(page, "codex", "theme-codex");
  await nav(page, "设置");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  const settingsBefore = JSON.stringify(desktop.settings);
  await page.getByRole("button", { name: "浅色", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(
    page.getByRole("button", { name: "浅色", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(JSON.stringify(desktop.settings)).toBe(settingsBefore);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(
    page.getByRole("button", { name: "切换为深色主题", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "切换为深色主题", exact: true })
    .click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("appearance storage failure keeps the UI usable and explains persistence failure", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new Error("synthetic storage unavailable");
      },
    });
  });
  await page.reload();
  await nav(page, "设置");
  await page.getByRole("button", { name: "浅色", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.getByText(/主题已切换，但无法保存外观偏好/)).toBeVisible();
});

test("sidebar reports global running and queued work even when history is filtered and capture paused", async ({
  page,
}) => {
  await add(page, "codex", "status-codex");
  await seedTasks(1);
  const profile = desktop.app.profile;
  let release;
  let began;
  let work;
  const started = new Promise((resolve) => {
    began = resolve;
  });
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const adapter = {
    name: "fake",
    version: "1",
    async execute(...args) {
      began();
      await gate;
      return new FakeAgent().execute(...args);
    },
  };
  desktop.app.setRegistry([{ profile, adapter }], profile.id, profile.version);
  const bytes = await sharp({
    create: { width: 20, height: 20, channels: 3, background: "#88aa99" },
  })
    .png()
    .toBuffer();
  try {
    await desktop.app.submit(bytes, undefined, true);
    await desktop.app.submit(bytes, undefined, true);
    work = desktop.app.work();
    await started;
    await desktop.dispatch({
      v: 1,
      command: "configure",
      capture: { enabled: true, mode: "confirm" },
      delivery: { clipboard: "manual" },
    });
    await nav(page, "历史记录");
    await page.getByLabel("搜索历史").fill("synthetic-no-match");
    const status = page.getByRole("status", { name: "运行状态" });
    await expect(status).toContainText("正在监听新图片");
    await expect(status).toContainText("正在处理 1 项 · 排队 1 项");
    await desktop.dispatch({ v: 1, command: "pause", paused: true });
    await expect(status).toContainText("捕获已暂停");
    await expect(status).toContainText("正在处理 1 项");
    await page.screenshot({
      path: "build/ui-evidence/status-paused-running.png",
    });
    release();
    await work;
    await expect(status).toContainText("等待处理 1 项");
  } finally {
    release();
    await work;
  }
});

test("polish spacing and both themes across window sizes, with populated cleanup and accessible selection", async ({
  page,
}) => {
  await add(page, "codex", "polish-codex");
  await seedTasks(1);
  const agent = (await desktop.dispatch({ v: 1, command: "snapshot" }))
    .agents[0];
  await desktop.dispatch({
    v: 1,
    command: "create-profile",
    provider: agent.provider,
    id: agent.id,
    editId: agent.id,
    editVersion: agent.version,
    reuseExisting: true,
    workspace: agent.workspace,
    prompt: "Updated synthetic prompt.",
  });
  for (const [width, height] of [
    [1040, 760],
    [720, 560],
    [480, 640],
  ]) {
    await page.setViewportSize({ width, height });
    for (const theme of ["浅色", "深色"]) {
      await nav(page, "设置");
      await page.getByRole("button", { name: theme, exact: true }).click();
      const hotkeys = page.locator(".hotkeys");
      await hotkeys.locator("summary").click();
      const actions = page.getByRole("group", { name: "立即操作" });
      await actions.scrollIntoViewIfNeeded();
      await expect(actions.getByRole("button")).toHaveCount(5);
      const boxes = await actions.getByRole("button").evaluateAll((nodes) =>
        nodes.map((node) => {
          const r = node.getBoundingClientRect();
          return { x: r.x, y: r.y, right: r.right, bottom: r.bottom };
        }),
      );
      for (let i = 1; i < boxes.length; i++) {
        if (Math.abs(boxes[i].y - boxes[i - 1].y) < 1)
          expect(boxes[i].x - boxes[i - 1].right).toBeGreaterThanOrEqual(7.9);
        else
          expect(boxes[i].y - boxes[i - 1].bottom).toBeGreaterThanOrEqual(7.9);
      }
      await page.screenshot({
        path: `build/ui-evidence/polish-${width}-${theme}-hotkeys.png`,
        fullPage: true,
      });
      await nav(page, "AI 助手");
      await page.locator(".cleanup-panel summary").click();
      const cleanup = page.locator(".cleanup-panel");
      await expect(cleanup.locator(".profile-entry")).toHaveCount(1);
      const gap = await cleanup.evaluate(
        (el) =>
          el.querySelector(".cleanup-actions").getBoundingClientRect().top -
          el.querySelector(".profile-entry").getBoundingClientRect().bottom,
      );
      expect(gap).toBeGreaterThanOrEqual(19.9);
      await page.screenshot({
        path: `build/ui-evidence/polish-${width}-${theme}-cleanup.png`,
        fullPage: true,
      });
      await page.getByRole("button", { name: "编辑配置", exact: true }).click();
      await page.screenshot({
        path: `build/ui-evidence/polish-${width}-${theme}-editor.png`,
      });
      await page.keyboard.press("Escape");
      await nav(page, "历史记录");
      await expect(page.locator(".task-check input")).toHaveAccessibleName(
        /^选择任务 /,
      );
      await expect(page.getByText("选择删除", { exact: true })).toHaveCount(0);
      await page.locator(".task-check input").check();
      await expect(
        page.getByRole("button", { name: "删除所选（1）" }),
      ).toBeEnabled();
      await page.screenshot({
        path: `build/ui-evidence/polish-${width}-${theme}-history.png`,
        fullPage: true,
      });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    }
  }
});

test("missing synthetic resource reports no request and preserves the working GLM configuration", async ({
  page,
}) => {
  await add(page, "claude-compatible-endpoint", "working-glm");
  await page.getByRole("button", { name: "测试连接", exact: true }).click();
  await expect(
    page.getByText(/合成图片测试通过，可处理新的截图/),
  ).toBeVisible();
  const before = JSON.stringify(desktop.settings);
  const sent = testsSent;
  gatewayFailureCode = "GATEWAY_SYNTHETIC_IMAGE_UNAVAILABLE";
  await page.getByRole("button", { name: "测试连接", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("未发送模型请求");
  expect(testsSent).toBe(sent);
  expect(JSON.stringify(desktop.settings)).toBe(before);
});

for (const [width, height, count] of [[1040, 760, 2], [720, 560, 5], [480, 640, 5]]) {
  test(`M8 real Vue composer ${count} images, keyboard and layout ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await add(page, "codex", "batch-agent");
    const paths = [];
    for (let i = 0; i < count; i++) {
      const path = join(root, `synthetic-${i}.png`);
      writeFileSync(path, await sharp({ create: { width: 48, height: 32, channels: 3, background: { r: i * 40, g: 90, b: 140 } } }).png().toBuffer());
      paths.push(path);
    }
    pickerSelection = paths;
    await nav(page, "首页");
    await page.getByRole("button", { name: "添加图片文件…" }).click();
    await expect(page.locator(".composer-images li")).toHaveCount(count);
    expect(desktop.app.list()).toHaveLength(0);
    const initialIds = (await desktop.dispatch({ v: 1, command: "snapshot" })).composer.map(i => i.id);
    const move = page.getByRole("button", { name: "下移第 1 张", exact: true });
    await move.focus(); await page.keyboard.press("Enter");
    await expect.poll(async () => (await desktop.dispatch({ v: 1, command: "snapshot" })).composer[1].id).toBe(initialIds[0]);
    await page.getByRole("button", { name: "移除第 1 张", exact: true }).click();
    await expect(page.locator(".composer-images li")).toHaveCount(count - 1);
    pickerSelection = [paths[0]]; await page.getByRole("button", { name: "添加图片文件…" }).click();
    await expect(page.locator(".composer-images li")).toHaveCount(count);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.locator(".composer").screenshot({ path: `build/ui-evidence/m8-composer-${width}.png` });
    const original = desktop.app.registry;
    desktop.app.setRegistry(original.map(e => ({ profile: e.profile, adapter: new FakeAgent() })), desktop.app.profile.id, desktop.app.profile.version);
    await page.getByRole("button", { name: `提交 ${count} 张为一个任务`, exact: true }).click();
    await expect(page.locator(".composer-images li")).toHaveCount(0);
    expect(desktop.app.list()).toHaveLength(1); expect(desktop.app.list()[0].submission.images).toHaveLength(count);
    await desktop.app.work();
    await nav(page, "历史记录");
    await expect(page.locator(".tasks li")).toHaveCount(1);
  });
}
test("M8 GUI independent capture/output controls, native picker boundary and history-only", async ({ page }) => {
  await add(page, "claude-compatible-endpoint", "glm-direct");
  await nav(page, "首页");
  await expect(page.getByRole("button", { name: "处理剪贴板图片", exact: true })).toBeEnabled(); expect(testsSent).toBe(0);
  const folder = realpathSync(mkdtempSync(join(tmpdir(), "m8-ui-folder-")));
  try {
    await nav(page, "设置");
    await page.getByLabel("剪贴板返回").selectOption("off");
    for (const [clip, file] of [[false, true], [true, false], [true, true], [false, false]]) {
      await page.getByLabel("监听剪贴板中的新图片", { exact: true }).setChecked(clip);
      await page.getByLabel("监听截图文件夹（仅此目录）", { exact: true }).setChecked(file);
      if (file) { pickerSelection = folder; await page.getByRole("button", { name: "选择截图文件夹…" }).click(); }
      await page.getByRole("button", { name: "应用设置", exact: true }).click();
      await expect(page.getByText("设置已保存。仅监听此后新增的图片。")).toBeVisible();
      expect(desktop.settings.desktop.enabled).toBe(clip); expect(desktop.settings.desktop.folderEnabled).toBe(file);
    }
    await page.getByLabel("自动复制内容").selectOption("files");
    await page.getByLabel("完成时显示 Windows 通知", { exact: true }).check();
    await page.getByRole("button", { name: "应用设置", exact: true }).click();
    expect(desktop.settings.delivery.clipboardPayload).toBe("files"); expect(desktop.settings.delivery.notification).toBe(true); expect(testsSent).toBe(0);
    await page.screenshot({ path: "build/ui-evidence/m8-input-output-settings.png", fullPage: true });
  } finally { rmSync(folder, { recursive: true, force: true }); }
});

test("M8 home capture status follows applied sources, mode, pause and external changes", async ({ page }) => {
  await add(page, "codex", "capture-status-agent");
  await desktop.dispatch({ v: 1, command: "configure", capture: { enabled: true, mode: "confirm" }, delivery: { clipboard: "manual" } });
  await nav(page, "首页");
  const summary = page.locator(".capture-toolbar .hint");
  await expect(summary).toContainText("确认后提交");
  await page.getByRole("button", { name: "暂停捕获", exact: true }).click();
  await expect(summary).toContainText("捕获已暂停");
  await page.getByRole("button", { name: "恢复捕获", exact: true }).click();
  await expect(summary).toContainText("剪贴板");
  await desktop.dispatch({ v: 1, command: "configure", capture: { enabled: false, mode: "auto" }, autoConsent: true, delivery: { clipboard: "off" } });
  await expect(summary).toContainText("自动提交");
  await expect(summary).toContainText("捕获已关闭");
  const folder = realpathSync(mkdtempSync(join(tmpdir(), "m8-status-folder-")));
  try {
    await desktop.dispatch({ v: 1, command: "configure", capture: { enabled: false, folderEnabled: true, folderDirectory: folder } });
    await expect(summary).toContainText("文件夹");
    await expect(summary).not.toContainText("剪贴板");
    await desktop.dispatch({ v: 1, command: "configure", capture: { enabled: true } });
    await expect(summary).toContainText("剪贴板 + 文件夹");
    await nav(page, "设置");
    await page.getByLabel("提交方式").selectOption("confirm");
    await page.getByRole("button", { name: "应用设置", exact: true }).click();
    await nav(page, "首页");
    await expect(summary).toContainText("确认后提交");
  } finally { rmSync(folder, { recursive: true, force: true }); }
});


test("M8 Copy files distinguishes native replacement from verified success without AI rerun", async ({ page }) => {
  await add(page, "codex", "copy-feedback-agent"); await seedTasks(1); await nav(page, "首页");
  let writes = 0;
  desktop.app.clipboard.writeFiles = async () => { writes++; throw Error("CLIPBOARD_REPLACED_AFTER_WRITE"); };
  await page.getByRole("button", { name: "复制文件", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "随后被其他剪贴板活动替换" })).toBeVisible();
  expect(writes).toBe(1);
  await expect(page.getByText(/^已写入并验证 Markdown 文件/)).not.toBeVisible();
  expect(desktop.app.state.get(desktop.app.list()[0].submission.taskId, "clipboard").code).toBe("CLIPBOARD_REPLACED_AFTER_WRITE");
  desktop.app.clipboard.writeFiles = async paths => { writes++; expect(paths.length).toBe(1); return true; };
  await page.getByRole("button", { name: "复制文件", exact: true }).click();
  await expect(page.getByText(/^已写入并验证 Markdown 文件/)).toBeVisible(); expect(writes).toBe(2);
  expect(desktop.app.list()[0].attempts.length).toBe(1);
});

// Browser/controller evidence only. Actual locked clipboard cleanup runs in Windows CI.
test("M9 settings show version, cache, backup guidance and confirmed cleanup", async ({ page }) => {
  await nav(page, "设置");
  await expect(page.getByRole("heading", { name: "Shot2Agent 1.0.1" })).toBeVisible();
  await expect(page.getByRole("region", { name: "文件复制缓存" })).toContainText("0 / 1000");
  await page.getByRole("button", { name: "清理旧复制缓存" }).click();
  await expect(page.getByText(/已清理 0 个旧缓存文件/)).toBeVisible();
  await expect(page.getByRole("region", { name: "版本与备份" })).toContainText("Windows 凭据管理器");
  await expect(page.getByRole("button", { name: "清理旧复制缓存" })).toBeEnabled();
});

// Decorative icons must keep visible/accessible action names and fit both themes.
test("Local v1 icons preserve labels, keyboard navigation and compact layouts", async ({ page }) => {
  await add(page, "codex", "my-codex");
  await desktop.dispatch({ v: 1, command: "configure", capture: { enabled: true, mode: "confirm" }, delivery: { clipboard: "manual" } });
  for (const theme of ["dark", "light"]) {
    await nav(page, "设置");
    await page.getByRole("button", { name: theme === "dark" ? "深色" : "浅色", exact: true }).click();
    for (const width of [1040, 720, 480]) {
      await page.setViewportSize({ width, height: 760 });
      await nav(page, "首页");
      const navigation = page.getByRole("navigation", { name: "主要导航" });
      await expect(navigation.locator("svg[aria-hidden='true']")).toHaveCount(4);
      await expect(page.getByRole("button", { name: "处理剪贴板图片", exact: true })).toBeEnabled();
      await expect(page.getByRole("button", { name: "暂停捕获", exact: true })).toBeEnabled();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `build/ui-evidence/v1-${theme}-${width}-home.png`, fullPage: true });
    }
    await nav(page, "设置");
    await expect(page.getByRole("button", { name: "清理旧复制缓存", exact: true })).toBeEnabled();
    await expect(page.locator("svg.app-icon:not([aria-hidden='true'])")).toHaveCount(0);
    await page.screenshot({ path: `build/ui-evidence/v1-${theme}-settings.png`, fullPage: true });
  }
  await page.getByRole("navigation").getByRole("button", { name: "首页", exact: true }).focus();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("navigation").getByRole("button", { name: "AI 助手", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("region", { name: "AI 助手管理" })).toBeVisible();
});

test("v1.0.1 chooses detected installations without steering to GLM or changing defaults", async ({ page }) => {
  await nav(page,"AI 助手");
  await page.getByRole('button', { name:'添加 AI 助手', exact:true }).click();
  const editor = page.getByRole('dialog');
  await expect(editor.getByLabel('Agent 类型')).toHaveValue('');
  await expect(editor.getByLabel('GLM Token', {exact:false})).toHaveCount(0);
  await page.keyboard.press('Escape');
  // One compatible provider => select that installation, never an online gateway.
  desktop.discovery = desktop.discovery.filter(c => c.provider === 'claude');
  await page.reload(); await nav(page,'AI 助手');
  await page.getByRole('button', { name:'添加 AI 助手', exact:true }).click();
  await expect(editor.getByLabel('Agent 类型')).toHaveValue('claude');
  await expect(editor.getByLabel('GLM Token', {exact:false})).toHaveCount(0);
  await page.keyboard.press('Escape');
  desktop.discovery = [];
  await page.reload(); await nav(page,'AI 助手');
  await page.getByRole('button', { name:'添加 AI 助手', exact:true }).click();
  await expect(editor.getByLabel('Agent 类型')).toHaveValue('');
  expect(testsSent).toBe(0);
  expect(desktop.settings.agents?.selected).toBeUndefined();
});

test("v1.0.1 retry appears only for safe enabled failures and never re-executes AI", async ({ page }) => {
  await add(page,'codex','retry-agent'); await seedTasks(1);
  await nav(page,'历史记录');
  const retry = page.getByRole('button',{name:'重试结果投递',exact:true});
  await expect(retry).toHaveCount(0);
  const id = desktop.app.list()[0].submission.taskId;
  await desktop.dispatch({v:1,command:'configure',delivery:{clipboard:'smart'}});
  for (const classification of ['conflict','ambiguous']) {
    desktop.app.state.put(id,'clipboard',{status:'failed',attempts:1,code:'SYNTHETIC',classification});
    await page.reload(); await nav(page,'历史记录'); await expect(retry).toHaveCount(0);
  }
  desktop.app.state.put(id,'clipboard',{status:'blocked_by_clipboard_change',attempts:0});
  await page.reload(); await nav(page,'历史记录'); await expect(retry).toHaveCount(0);
  desktop.app.state.put(id,'clipboard',{status:'failed',attempts:1,code:'CLIPBOARD_BUSY',classification:'transient'});
  await page.reload(); await nav(page,'历史记录'); await expect(retry).toBeVisible();
  await expect(page.getByText(/重试只重新复制、保存或通知/)).toBeVisible();
  await retry.click(); await expect(retry).toHaveCount(0);
  expect(desktop.app.get(id).attempts.length).toBe(1);
  expect(testsSent).toBe(0);
});

test("v1.0.1 pending does not move focus and tray open returns to the preview", async ({ page }) => {
  await add(page,'codex','pending-agent');
  await desktop.dispatch({v:1,command:'configure',capture:{enabled:true,mode:'confirm'},delivery:{clipboard:'manual'}});
  await nav(page,'历史记录');
  const search = page.getByLabel('搜索历史'); await search.focus();
  await desktop.app.ingest(await sharp({create:{width:20,height:20,channels:3,background:'red'}}).png().toBuffer(),false,undefined,'synthetic');
  await expect(page.locator('.status-pill')).toContainText('等待确认');
  await expect(search).toBeFocused(); expect(desktop.app.list()).toHaveLength(0);
  await page.evaluate(() => window.dispatchEvent(new window.Event('shot2agent-open-preview')));
  await expect(page.getByRole('img',{name:'待确认的截图预览'})).toBeVisible();
  await expect(page.getByRole('button',{name:'提交图片',exact:true})).toBeEnabled();
});

test("v1.0.1 faults show Chinese recovery and refuse staging controls in normal mode", async ({ page }) => {
  await add(page,'codex','fault-agent');
  await expect(page.getByRole('button',{name:'模拟捕获故障'})).toHaveCount(0);
  await expect(desktop.dispatch({v:1,command:'staging-fault',kind:'capture'})).rejects.toThrow('STAGING_ONLY');
  await desktop.dispatch({v:1,command:'configure',capture:{enabled:true,mode:'confirm'},delivery:{clipboard:'manual'}});
  desktop.app.clipboard.readImage = async () => { throw Error('CLIPBOARD_HELPER_STOPPED'); };
  desktop.app.clipboard.sequence = async () => 'changed';
  await desktop.tick();
  await expect(page.getByRole('alert')).toContainText('剪贴板');
  await expect(page.getByRole('alert')).not.toContainText('CLIPBOARD_HELPER_STOPPED');
  await expect(page.locator('.status-pill')).toContainText('需要处理');
  desktop.app.clipboard.readImage = async () => undefined;
  await page.getByRole('button',{name:'重新连接剪贴板'}).click();
  await expect(page.locator('.status-pill')).toContainText('正在监听');
  await nav(page,'设置');
  await page.screenshot({path:'build/ui-evidence/v101-recovery-settings.png',fullPage:true});
});
