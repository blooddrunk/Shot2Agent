import { test, expect } from "@playwright/test";
import { mkdtempSync, mkdirSync, rmSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { DesktopController } from "../../../packages/desktop/src/controller.ts";
import { FakeAgent, FAKE_PROFILE } from "../../../packages/worker/src/fake.ts";
import { makeCli, credentialStore } from "./fixtures.mjs";
import { openCore } from '../../../packages/core/src/core.ts';
import { createRelay } from '../../../services/relay/src/server.ts';
import { RemoteClient } from '../../../services/relay/src/client.ts';
import { runOnce } from '../../../packages/worker/src/worker.ts';
import { APP_VERSION } from '../../../packages/desktop/src/version.ts';

let desktop, root, workspace, testsSent, gatewayFailureCode, pickerSelection, nativeRequests, nativeRuntime;
const previousLocalAppData = process.env.LOCALAPPDATA;
test.beforeEach(async ({ page }) => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "shot2agent-ui-")));
  workspace = join(root, "workspace");
  mkdirSync(workspace);
  process.env.LOCALAPPDATA = root;
  makeCli(root, "codex");
  makeCli(root, "claude");
  testsSent = 0;
  nativeRequests = []; nativeRuntime = undefined;
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
      if (['capture-monitor', 'type-latest', 'type-result', 'type-clipboard', 'stop-typing', 'native-monitors'].includes(request.command)) {
        nativeRequests.push(request);
        if (request.command === 'native-monitors') return { ok: true, value: [{ id: 'synthetic-display', width: 3840, height: 2160, primary: true }] };
        if (request.command === 'capture-monitor') await new Promise(resolve => setTimeout(resolve, 250));
        const value = await desktop.dispatch({ v: 1, command: 'snapshot' });
        nativeRuntime = { capturing: false, captureStatus: 'saved', typing: request.command === 'capture-monitor' ? {} : { phase: request.command === 'stop-typing' ? 'TYPING_CANCELED' : 'preparing', active: request.command !== 'stop-typing', sent: 0, total: 20 } };
        value.nativeRuntime = nativeRuntime;
        return { ok: true, value };
      }
      const value = await desktop.dispatch(request);
      if (nativeRuntime && request.command === 'snapshot') value.nativeRuntime = nativeRuntime;
      return { ok: true, value };
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

for (const width of [1040, 720, 480]) test(`M10 Remote GUI setup, secure token, target selection, batch/history and Local return ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 760 });
  const core = openCore(join(root, 'relay-test'), 'remote');
  const relay = await createRelay(core, [ { ownerId: 'ui-test', deviceId: 'a', role: 'desktop', token: 'a'.repeat(40) }, { ownerId: 'ui-test', deviceId: 'b', role: 'desktop', token: 'b'.repeat(40) } ]);
  try {
    const url = await relay.listen({ host: '127.0.0.1', port: 0 }); const worker = new RemoteClient(url, 'b'.repeat(40));
    await worker.presence('合成测试电脑 B', [{ id: FAKE_PROFILE.id, version: FAKE_PROFILE.version, fingerprint: FAKE_PROFILE.fingerprint, provider: 'fake' }], true);
    await nav(page, '设置');
    await page.getByLabel('Relay HTTPS 地址', { exact: true }).fill(` ${url} `); await page.getByLabel('设备 Token', { exact: true }).fill(` ${'a'.repeat(40)} `);
    await page.getByRole('button', { name: '保存连接', exact: true }).click();
    await expect(page.getByLabel('设备 Token', { exact: true })).toHaveValue('');
    await expect(page.getByLabel('Relay HTTPS 地址', { exact: true })).toHaveValue(url);
    const connectionButtons = page.getByRole('group', { name: '跨设备处理', exact: true }).locator('.button-row');
    expect(await connectionButtons.evaluate(row => {
      const style = window.getComputedStyle(row), boxes = [...row.children].map(b => b.getBoundingClientRect());
      return style.display === 'flex' && style.flexWrap === 'wrap' && parseFloat(style.gap) >= 8 &&
        boxes.every((box, i) => i === 0 || box.left - boxes[i - 1].right >= 7.5 || box.top - boxes[i - 1].bottom >= 7.5);
    })).toBe(true);
    await page.getByRole('button', { name: '测试连接 / 刷新电脑', exact: true }).click();
    await expect(page.getByText('Relay 已连接', { exact: false })).toBeVisible();
    await page.getByLabel('远程电脑及已批准 Agent', { exact: true }).selectOption(JSON.stringify(['b', FAKE_PROFILE.id, FAKE_PROFILE.version]));
    await page.getByLabel('新任务处理位置', { exact: true }).selectOption('remote');
    await expect.poll(() => desktop.settings.remote.mode).toBe('remote');
    expect(JSON.stringify(await desktop.dispatch({ v: 1, command: 'snapshot' }))).not.toContain('a'.repeat(40));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole('group', { name: '跨设备处理', exact: true }).screenshot({ path: `build/ui-evidence/m10-remote-${width}.png` });
    const paths = [];
    for (let i = 0; i < 2; i++) { const path = join(root, `remote-${i}.png`); writeFileSync(path, await sharp({ create: { width: 16, height: 16, channels: 3, background: i ? 'blue' : 'red' } }).png().toBuffer()); paths.push(path); }
    pickerSelection = paths; await nav(page, '首页');
    await expect(page.getByRole('heading', { name: 'b · fake-readonly', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '添加图片文件…', exact: true }).click(); await page.getByRole('button', { name: '提交 2 张为一个任务', exact: true }).click();
    await expect.poll(() => desktop.app.list().length).toBe(1); expect(desktop.app.core.store.tasks()).toHaveLength(0);
    await desktop.dispatch({ v: 1, command: 'remote-test' }); await runOnce(worker, new FakeAgent(), [FAKE_PROFILE]); await desktop.dispatch({ v: 1, command: 'remote-test' });
    await nav(page, '历史记录'); await expect(page.locator('.tasks li')).toHaveCount(1); await expect(page.locator('.tasks li')).toContainText('处理完成');
    await nav(page, '设置'); await page.getByLabel('新任务处理位置', { exact: true }).selectOption('local'); await page.getByRole('button', { name: '删除设备 Token', exact: true }).click();
    await expect(page.getByText('尚未配置 Relay', { exact: true })).toBeVisible(); expect(desktop.app.list()[0].status).toBe('succeeded');
  } finally { await relay.close(); core.close(); }
});

test('Remote save errors preserve masked input, explain the failing stage and allow correction', async ({ page }) => {
  await nav(page, '设置');
  await page.getByLabel('Relay HTTPS 地址', { exact: true }).fill('https://relay.example.com');
  const tokenInput = page.getByLabel('设备 Token', { exact: true });
  await tokenInput.fill('synthetic short');
  await page.getByRole('button', { name: '保存连接', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('设备 Token 格式无效');
  await expect(tokenInput).toHaveValue('synthetic short');
  await expect(tokenInput).toHaveAttribute('type', 'password');
  const store = desktop.credentials, save = store.save, read = store.read;
  await tokenInput.fill('s'.repeat(40));
  store.save = async () => { throw Error('synthetic-private-secret-must-not-show'); };
  await page.getByRole('button', { name: '保存连接', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Windows 凭据管理器未能保存设备 Token');
  await expect(page.getByRole('alert')).not.toContainText('synthetic-private-secret');
  await expect(tokenInput).toHaveValue('s'.repeat(40));
  store.save = save; store.read = async () => { throw Error('synthetic read failure'); };
  await page.getByRole('button', { name: '保存连接', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('无法从 Windows 凭据管理器正确读回');
  store.read = read;
  await page.getByRole('button', { name: '保存连接', exact: true }).click();
  await expect(tokenInput).toHaveValue('');
  await expect(page.getByRole('button', { name: '测试连接 / 刷新电脑', exact: true })).toBeEnabled();
  await tokenInput.fill('t'.repeat(40));
  await expect(page.getByRole('button', { name: '测试连接 / 刷新电脑', exact: true })).toBeDisabled();
  expect(testsSent).toBe(0);
});

test('Remote picker groups other computers, hides historical versions and identifies their default Agent', async ({ page }) => {
  await add(page, 'codex', 'this-pc-agent');
  const core = openCore(join(root, 'picker-relay'), 'remote');
  const relay = await createRelay(core, ['a', 'b', 'c'].map(id => ({ ownerId: 'picker', deviceId: id, role: 'desktop', token: id.repeat(40) })));
  try {
    const url = await relay.listen({ host: '127.0.0.1', port: 0 });
    const profile = { id: 'remote-codex', version: 'current', fingerprint: FAKE_PROFILE.fingerprint, provider: 'codex' };
    await new RemoteClient(url, 'b'.repeat(40)).presence('Shared name', [{ ...profile, version: 'historical', selectable: false }, { ...profile, selectable: true, isDefault: true }], true);
    await new RemoteClient(url, 'c'.repeat(40)).presence('Shared name', [{ ...profile, id: 'other-agent' }], false);
    await nav(page, '设置');
    await page.getByLabel('Relay HTTPS 地址', { exact: true }).fill(url);
    await page.getByLabel('这台电脑的名称', { exact: true }).fill('Shared name');
    await page.getByLabel('设备 Token', { exact: true }).fill('a'.repeat(40));
    await page.getByRole('button', { name: '保存连接', exact: true }).click();
    await page.getByRole('button', { name: '测试连接 / 刷新电脑', exact: true }).click();
    const picker = page.getByLabel('远程电脑及已批准 Agent', { exact: true });
    await expect(picker.locator('optgroup')).toHaveCount(2);
    await expect(picker.locator('optgroup').nth(0)).toHaveAttribute('label', 'Shared name · b · 在线');
    await expect(picker.locator('optgroup').nth(1)).toHaveAttribute('label', 'Shared name · c · 已暂停接收');
    await expect(picker.locator('option')).toHaveCount(3);
    await expect(picker).toContainText('Codex CLI · remote-codex · 对方默认');
    await expect(picker).not.toContainText('historical'); await expect(picker).not.toContainText('this-pc-agent');
    await expect(page.getByText(/本机作为 B 接收任务时，无需选择远程目标/)).toBeVisible();
    await expect(page.getByText(/本机可接收任务的当前助手/)).toContainText('this-pc-agent（本机默认）');
    await picker.selectOption(JSON.stringify(['b', 'remote-codex', 'current']));
    await expect(page.getByText('已选远程电脑：Shared name · b · 在线', { exact: true })).toBeVisible();
    await page.getByRole('group', { name: '跨设备处理', exact: true }).screenshot({ path: 'build/ui-evidence/m10-current-agents.png' });
    expect(desktop.settings.remote.target.version).toBe('current'); expect(testsSent).toBe(0);
    // With only this computer online, receiving remains available without a target selection.
    desktop.remote.workers = desktop.remote.workers.filter(w => w.deviceId === 'a');
    await page.reload(); await nav(page, '设置');
    await expect(picker.locator('optgroup')).toHaveCount(0);
    await expect(page.getByText(/尚未发现其他电脑的当前助手/)).toBeVisible();
  } finally { await relay.close(); core.close(); }
});

test('hotkeys save before Agent setup even when CLI discovery is invalid', async ({ page }) => {
  desktop.discovery = [{ provider: 'codex', path: '', status: 'invalid' }];
  await nav(page, '设置');
  const section = page.locator('.hotkeys');
  await section.locator('summary').click();
  await section.getByLabel('暂停 / 恢复捕获', { exact: true }).fill('Ctrl+Alt+P');
  await section.getByRole('button', { name: '保存快捷键', exact: true }).click();
  await expect(section.getByRole('status')).toHaveText('快捷键已保存。隐藏到托盘后仍有效。');
  const snapshot = await desktop.dispatch({ v: 1, command: 'snapshot' });
  expect(snapshot.setupRequired).toBe(true);
  expect(snapshot.hotkeys['toggle-pause']).toBe('Ctrl+Alt+P');
  expect(snapshot.total).toBe(0);
  await page.reload();
  await nav(page, '设置');
  await section.locator('summary').click();
  await expect(section.getByLabel('暂停 / 恢复捕获', { exact: true })).toHaveValue('Ctrl+Alt+P');
});

test('native hotkey failures stay beside Save with a specific explanation and safe error code', async ({ page }) => {
  await page.evaluate(() => {
    const original = window.__TAURI_INTERNALS__.invoke;
    window.__TAURI_INTERNALS__.invoke = (command, args) =>
      command === 'rpc' && args.request.command === 'configure-hotkeys'
        ? Promise.reject('HOTKEY_CONFLICT_OLD_BINDINGS_RETAINED')
        : original(command, args);
  });
  await nav(page, '设置');
  const section = page.locator('.hotkeys');
  await section.locator('summary').click();
  for (const [width, height] of [[1040, 760], [720, 560], [480, 640]]) {
    await page.setViewportSize({ width, height });
    await section.getByLabel('暂停 / 恢复捕获', { exact: true }).fill('Ctrl+Alt+P');
    await section.getByRole('button', { name: '保存快捷键', exact: true }).click();
    const feedback = section.getByRole('alert');
    await expect(feedback).toContainText('Windows 未能注册这组快捷键');
    await expect(feedback).toContainText('错误代码：HOTKEY_CONFLICT_OLD_BINDINGS_RETAINED');
    await expect(feedback).not.toContainText('网络');
    await feedback.scrollIntoViewIfNeeded();
    await expect(feedback).toBeInViewport();
    await expect(section.getByText('快捷键已保存。隐藏到托盘后仍有效。')).toHaveCount(0);
    expect((await desktop.dispatch({ v: 1, command: 'snapshot' })).hotkeys).toEqual({});
    await page.screenshot({ path: `build/ui-evidence/hotkey-error-${width}.png`, fullPage: true });
  }
});
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
    await desktop.dispatch({v:1,command:'configure',capture:{enabled:false},delivery:{clipboard:'manual'}});
    await expect(status).toContainText('捕获已关闭');
    await expect(status).toContainText('正在处理 1 项');
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
      await expect(actions.getByRole("button")).toHaveCount(8);
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
  await expect(page.getByRole("heading", { name: `Shot2Agent ${APP_VERSION}` })).toBeVisible();
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

test("v1.0.1 isolated Fake controls expose recoverable capture and persistent Worker faults", async ({ page }) => {
  const cb = desktop.app.clipboard;
  await desktop.close();
  desktop = new DesktopController(root,cb,{adapter:new FakeAgent(),profile:FAKE_PROFILE},'staging',async()=>[]);
  await desktop.start(); await page.reload(); await nav(page,'设置');
  await expect(page.getByRole('group',{name:'隔离故障测试'})).toBeVisible();
  await page.getByRole('button',{name:'模拟捕获故障',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('剪贴板连接已断开');
  await page.getByRole('button',{name:'重新连接剪贴板',exact:true}).click();
  await expect(page.locator('.status-pill')).not.toContainText('需要处理');
  await page.getByRole('button',{name:'模拟处理服务故障',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('隔离测试的处理服务故障');
  await expect(page.locator('.status-pill')).toContainText('需要处理');
  await page.screenshot({path:'build/ui-evidence/v101-fake-fault-tools.png',fullPage:true});
  expect(desktop.app.list()).toHaveLength(0); expect(testsSent).toBe(0);
});

for (const width of [1040, 720, 480]) test(`M11 native configuration and responsive controls ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 850 });
  await page.getByRole('button', { name: '设置', exact: true }).click();
  const settings = page.getByRole('group', { name: '原生截图与直接输入设置' });
  await expect(settings.getByLabel('保存截图 PNG 文件')).toBeChecked();
  await expect(settings.getByLabel('同时交给所选 Agent', { exact: false })).not.toBeChecked();
  await settings.getByRole('button', { name: '刷新显示器' }).click();
  await settings.getByLabel('截图显示器').selectOption('synthetic-display');
  pickerSelection = join(root, 'capture-output');
  await settings.getByRole('button', { name: '选择截图保存目录…' }).click();
  await settings.getByLabel('输入准备时间（毫秒）').fill('1500');
  await settings.getByLabel('输入速度（字符/秒）').fill('30');
  await settings.getByRole('button', { name: '保存截图与输入设置' }).click();
  await expect(page.getByText('截图与输入设置已保存。', { exact: true })).toBeVisible();
  assertNativeSettings();
  await expect(settings).toBeVisible();
  expect(await page.evaluate(() => window.document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: `build/ui-evidence/m11-native-settings-${width}.png`, fullPage: true });
  await page.getByRole('button', { name: '首页', exact: true }).click();
  await expect(page.getByRole('button', { name: '截取所选显示器', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: '输入最新结果', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '截取所选显示器', exact: true }).click();
  await expect(page.getByText('正在截取显示器…', { exact: true })).toBeVisible();
  await expect(page.getByText('截图完成；请查看文件、确认预览及各去向状态。', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '输入剪贴板文本', exact: true }).click();
  await expect(page.getByLabel('直接输入进度')).toContainText('准备输入');
  await page.getByRole('button', { name: '停止输入', exact: true }).click();
  await expect(page.getByLabel('直接输入进度')).toContainText('输入已停止');
  expect(nativeRequests.map(r => r.command)).toEqual(['native-monitors', 'capture-monitor', 'type-clipboard', 'stop-typing']);
  expect(testsSent).toBe(0);
});
function assertNativeSettings() {
  expect(desktop.settings.native).toEqual({ monitor: 'synthetic-display', save: true, directory: join(root, 'capture-output'), submit: false, clipboard: false, delayMs: 1500, charsPerSecond: 30 });
}
