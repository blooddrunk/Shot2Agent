import { test, expect } from "@playwright/test";
import { mkdtempSync, mkdirSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { DesktopController } from "../../../packages/desktop/src/controller.ts";
import { FakeAgent } from "../../../packages/worker/src/fake.ts";
import { makeCli, credentialStore } from "./fixtures.mjs";

let desktop, root, workspace, testsSent;
const previousLocalAppData = process.env.LOCALAPPDATA;
test.beforeEach(async ({ page }) => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "shot2agent-ui-")));
  workspace = join(root, "workspace");
  mkdirSync(workspace);
  process.env.LOCALAPPDATA = root;
  makeCli(root, "codex");
  makeCli(root, "claude");
  testsSent = 0;
  const clipboard = {
    session: "ui-synthetic",
    async sequence() {
      return "1";
    },
    async readImage() {},
    async writeText() {
      return true;
    },
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
  await page.getByRole("button", { name: "复制结果" }).first().click();
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
    page.getByText("设置已保存。从下一次剪贴板变化开始监听。"),
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
  ).toBeDisabled();
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
  await page.getByRole("button", { name: "复制结果", exact: true }).click();
  await expect(page.getByText("已复制结果，可以粘贴。")).toBeVisible();
  await page.getByRole("button", { name: "删除", exact: true }).click();
  await expect(page.locator(".tasks li")).toHaveCount(0);
  expect(desktop.app.list()).toHaveLength(50);
});
