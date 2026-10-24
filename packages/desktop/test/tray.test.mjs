import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { trayView } from '../src/tray.ts';
import { DesktopController } from '../src/controller.ts';
const input = () => ({ status: 'monitoring', setupRequired: false, pending: null, activity: { running: 0, queued: 0 }, settings: { enabled: true, folderEnabled: false, paused: false }, actions: { copy: false, retry: false, cycle: false, current: true } });
const rows = [
  ['monitoring', {}, 'monitoring', /正在监听新图片（剪贴板）/],
  ['dual sources', { settings: { enabled: true, folderEnabled: true, paused: false } }, 'monitoring', /剪贴板 \+ 文件夹/],
  ['paused', { settings: { enabled: true, paused: true } }, 'paused', /捕获已暂停/],
  ['off', { settings: { enabled: false, paused: true } }, 'off', /捕获已关闭/],
  ['setup', { setupRequired: true }, 'off', /等待配置 AI 助手/],
  ['pending', { pending: 'synthetic' }, 'pending', /图片等待确认/],
  ['queue only', { pending: 'synthetic', activity: { running: 0, queued: 3 } }, 'queued', /等待处理 3 项/],
  ['paused + running', { settings: { enabled: true, paused: true }, activity: { running: 1, queued: 2 } }, 'running', /正在处理 1 项 · 排队 2 项 · 捕获已暂停/],
  ['off + running', { settings: { enabled: false, paused: false }, activity: { running: 1, queued: 0 } }, 'running', /正在处理 1 项 · 捕获已关闭/],
  ['worker loss beats running', { status: 'worker_error', activity: { running: 1, queued: 2 } }, 'error', /处理服务已停止/],
  ['capture error beats pending', { status: 'capture_error', pending: 'synthetic' }, 'error', /重新连接剪贴板/],
  ['folder error beats running', { folderError: 'CAPTURE_FOLDER_UNAVAILABLE', activity: { running: 1, queued: 0 } }, 'error', /检查目录后应用设置/],
];
for (const [name, changes, icon, tooltip] of rows) test(`tray matrix: ${name}`, () => {
  const s = { ...input(), ...changes }; const before = JSON.parse(JSON.stringify(s)); const v = trayView(s);
  assert.equal(v.icon, icon); assert.match(v.tooltip, tooltip); assert.deepEqual(s, before);
  assert.ok(v.tooltip.length < 128); assert.doesNotMatch(v.tooltip,/worker_error|succeeded|capture_error/);
  assert.equal(v.menu.toggle, !!s.settings.enabled && !s.setupRequired && !['worker_error','capture_error'].includes(s.status));
  assert.equal(v.menu.toggleLabel, s.settings.paused ? '恢复截图监听' : '暂停截图监听');
});
test('coordinator loss, recovery, rapid transitions and polling are deterministic', () => {
  const s = input(); const a = trayView(s); assert.deepEqual(trayView(s), a);
  const offline = trayView(); assert.equal(offline.icon,'error'); assert.match(offline.tooltip,/失联/);
  for (const k of ['toggle','copy','retry','cycle','current']) assert.equal(offline.menu[k],false);
  s.pending = 'new'; assert.equal(trayView(s).icon,'pending');
  s.pending = null; assert.deepEqual(trayView(s),a);
  s.activity.running = 1; assert.equal(trayView(s).icon,'running');
  s.settings.paused = true; assert.equal(trayView(s).icon,'running');
  s.activity.running = 0; assert.equal(trayView(s).icon,'paused');
  s.settings.paused = false; assert.deepEqual(trayView(s),a);
});
test('action feedback is Chinese, bounded and never displays internal codes', () => {
  const s = input(); s.lastAction = { action: 'current', status: 'NO_CURRENT_IMAGE' };
  assert.match(trayView(s).feedback,/请先截图/);
  s.lastAction.status = 'PRIVATE_UNTRUSTED_TEXT'; assert.doesNotMatch(trayView(s).tooltip,/PRIVATE/);
  s.lastAction.status = 'succeeded'; assert.match(trayView(s).feedback,/操作完成/);
});
test('snapshot eligibility is global; only safe failed delivery is retried without Agent execution', async t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(),'shot-v101-')));
  const cb = { session:'synthetic', async sequence() { return '1'; }, async readImage() {}, async writeText() { return true; }, async notify() { throw Error('NATIVE_NOTIFICATION_UNAVAILABLE'); }, close() {} };
  const d = new DesktopController(root,cb); t.after(async () => { await d.close(); rmSync(root,{recursive:true,force:true}); });
  const rpc = (command, args={}) => d.dispatch({v:1,command,...args}); await d.start();
  await rpc('configure',{ delivery:{ clipboard:'off',notification:true } });
  const bytes = await sharp({create:{width:16,height:16,channels:3,background:'blue'}}).png().toBuffer();
  const id = await d.app.submit(bytes); await d.app.work();
  let s = await rpc('snapshot'); assert.deepEqual(s.tasks[0].retryableChannels,['notification']); assert.equal(s.tray.menu.retry,true); assert.equal(s.tray.menu.copy,true);
  assert.equal((await rpc('snapshot',{query:'no-match'})).tray.menu.retry,true);
  await assert.rejects(rpc('retry-delivery',{id}),/DELIVERY_STILL_FAILED/); assert.equal(d.app.get(id).attempts.length,1);
  cb.notify = async () => {}; await rpc('retry-delivery',{id});
  s = await rpc('snapshot'); assert.deepEqual(s.tasks[0].retryableChannels,[]); assert.equal(s.tray.menu.retry,false);
  await assert.rejects(rpc('retry-delivery',{id}),/NO_ELIGIBLE_FAILED_DELIVERY/);
  await assert.rejects(rpc('action',{action:'retry-latest-delivery'}),/NO_ELIGIBLE_FAILED_DELIVERY/);
  s = await rpc('snapshot'); assert.match(s.tray.feedback,/没有可重试/); assert.equal(d.app.get(id).attempts.length,1);
  // Disabled channels and ambiguous/conflicting failed receipts must stay ineligible.
  for (const classification of ['ambiguous','conflict']) {
    d.app.state.put(id,'notification',{status:'failed',attempts:1,classification});
    s = await rpc('snapshot'); assert.deepEqual(s.tasks[0].retryableChannels,[]);
    await assert.rejects(rpc('retry-delivery',{id}),/NO_ELIGIBLE_FAILED_DELIVERY/);
  }
  d.app.state.put(id,'notification',{status:'failed',attempts:1,classification:'transient'});
  await rpc('configure',{delivery:{clipboard:'off',notification:false}});
  assert.deepEqual((await rpc('snapshot')).tasks[0].retryableChannels,[]);
});

test('fault controls are staging-only; capture can recover, Worker error cannot claim health', async t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(),'shot-v101-fault-')));
  const cb = { session:'synthetic', async sequence() { return '1'; }, async readImage() {}, async writeText() { return true; }, close() {} };
  const d = new DesktopController(root,cb,undefined,'staging');
  t.after(async () => { await d.close(); rmSync(root,{recursive:true,force:true}); });
  const rpc = (command,args={}) => d.dispatch({v:1,command,...args}); await d.start();
  await assert.rejects(rpc('staging-fault',{kind:'invalid'}),/INVALID_STAGING_FAULT/);
  await rpc('staging-fault',{kind:'capture'}); assert.equal((await rpc('snapshot')).tray.icon,'error');
  await rpc('recover'); assert.notEqual((await rpc('snapshot')).tray.icon,'error');
  await rpc('staging-fault',{kind:'worker'}); const s = await rpc('snapshot');
  assert.equal(s.tray.icon,'error'); assert.equal(s.tray.menu.current,false); assert.equal(s.tray.menu.toggle,false);
  await assert.rejects(rpc('recover'),/RESTART_APP_AFTER_CHECKING_AGENT/);
});
