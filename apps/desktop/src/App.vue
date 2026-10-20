<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { invoke } from '@tauri-apps/api/core';
type Receipt = { status: string; code?: string };
type Task = { id: string; status: string; summary?: string; error?: string; clipboard?: Receipt; save?: Receipt };
type Snapshot = { root: string; status: string; error?: string; total: number; pending: string | null; captureStatus: string;
  settings: { enabled: boolean; mode: string; paused: boolean; autoConsent: boolean; alwaysConsent: boolean };
  delivery: { clipboard: string; saveDirectory?: string };
  profile: { adapter: string; id: string; workspace?: string; version?: string; sandbox: string }; tasks: Task[] };
const data = ref<Snapshot>(); const error = ref(''); const message = ref(''); const busy = ref(false);
const enabled = ref(false); const mode = ref('confirm'); const clipboard = ref('manual'); const save = ref(false); const directory = ref('');
const autoConsent = ref(false); const alwaysConsent = ref(false); const dirty = ref(false);
const selected = ref(''); const detail = ref<{ status: string; result?: { contentMarkdown: string; errorCode?: string } }>();
let timer: ReturnType<typeof setInterval> | undefined; let polling = false;
const statusText: Record<string, string> = { monitoring: '正在监听新图片', paused: '捕获已暂停', capture_off: '剪贴板捕获已关闭', worker_error: 'Worker 已停止 · 请检查后重启', capture_error: '剪贴板读取暂停 · 可重新连接' };
function hydrate(s: Snapshot) {
  data.value = s;
  if (!dirty.value) { enabled.value = s.settings.enabled; mode.value = s.settings.mode; clipboard.value = s.delivery.clipboard;
    save.value = !!s.delivery.saveDirectory; directory.value = s.delivery.saveDirectory ?? ''; autoConsent.value = s.settings.autoConsent; alwaysConsent.value = s.settings.alwaysConsent; }
}
async function rpc(command: string, args: Record<string, unknown> = {}) {
  const response = await invoke<{ ok: boolean; value: unknown; error?: string }>('rpc', { request: { v: 1, command, ...args } });
  if (!response.ok) throw new Error(response.error ?? 'LOCAL_OPERATION_FAILED');
  return response.value;
}
async function refresh() {
  if (polling || busy.value) return; polling = true;
  try { hydrate(await rpc('snapshot') as Snapshot); } catch (e) { error.value = String(e); }
  finally { polling = false; }
}
async function action(command: string, args: Record<string, unknown> = {}) {
  if (busy.value) return; busy.value = true; error.value = ''; message.value = '';
  try {
    const result = await rpc(command, args);
    if (command === 'detail') detail.value = result as typeof detail.value;
    else if (command !== 'quit') hydrate(result as Snapshot);
    if (command === 'copy') message.value = '已复制结果，可以粘贴。';
    if (command === 'discard') message.value = '已丢弃预览，没有创建任务。';
    if (command === 'submit' || command === 'current') message.value = data.value?.captureStatus === 'duplicate' ? '5 秒内的相同图片已忽略。' : data.value?.captureStatus === 'no_image' ? '当前剪贴板没有图片。' : '图片已提交到本地队列。';
  } catch (e) { error.value = String(e); } finally { busy.value = false; }
}
async function apply() {
  if (save.value && !directory.value.trim()) { error.value = '请填写完整的本地保存目录。'; return; }
  await action('configure', { capture: { enabled: enabled.value, mode: mode.value }, autoConsent: autoConsent.value, alwaysConsent: alwaysConsent.value,
    delivery: { clipboard: clipboard.value, ...(save.value ? { saveDirectory: directory.value.trim() } : {}) } });
  if (!error.value) { dirty.value = false; message.value = '设置已保存。从下一次剪贴板变化开始监听。'; await refresh(); }
}
async function openTask(id: string) { selected.value = id; await action('detail', { id }); }
onMounted(() => { void refresh(); timer = setInterval(() => { void refresh(); }, 1000); });
onUnmounted(() => clearInterval(timer));
</script>
<template>
  <header><div class="identity"><svg width="30" height="30" viewBox="0 0 32 32" aria-hidden="true"><path d="M3 12V4h8M21 4h8v8M29 21v8h-8M11 29H3v-8" fill="none" stroke="currentColor" stroke-width="3"/><path d="m11 17 4 4 7-10" fill="none" stroke="currentColor" stroke-width="2"/></svg><div><h1>Shot2Agent</h1><p>Local · 此电脑处理，无需 Relay</p></div></div><div class="header-actions"><button @click="invoke('hide_window')">隐藏到托盘</button><button @click="action('quit')" :disabled="busy">退出</button></div></header>
  <main>
    <div class="statusbar" role="status"><span class="dot" :class="{ active: data?.status === 'monitoring' }"></span><strong>{{ data ? statusText[data.status] : '连接本地服务…' }}</strong><button v-if="data" @click="action('pause', { paused: !data.settings.paused })" :disabled="busy">{{ data.settings.paused ? '恢复捕获' : '暂停捕获' }}</button></div>
    <p v-if="error || data?.error" class="error" role="alert">{{ error || data?.error }}。设置失败时请检查选项。服务停止时请退出并重新打开应用；不会自动重跑已启动任务。<button v-if="data?.status === 'capture_error'" @click="action('recover')">重新连接剪贴板</button></p>
    <p v-if="message" class="notice" role="status">{{ message }}</p>
    <div class="columns"><section class="controls" aria-label="捕获及输出设置">
      <h2>捕获</h2>
      <form @submit.prevent="apply" @change="dirty = true" @input="dirty = true">
        <label class="check"><input type="checkbox" v-model="enabled">监听剪贴板中的新图片</label>
        <label>提交方式<select v-model="mode"><option value="confirm">确认后提交（默认）</option><option value="auto">自动提交</option></select></label>
        <label v-if="mode === 'auto'" class="consent"><input type="checkbox" v-model="autoConsent">我同意新截图自动发送给所配置的 Agent。Codex 云模型可能上传图片；请勿复制敏感内容。</label>
        <p class="hint">启动、恢复或应用设置时，已有图片不会被提交。确认预览仅保留在内存；退出或切换设置将丢弃。</p>
        <h2>结果去向</h2><p class="hint">历史始终保留。剪贴板与 Markdown 保存可同时启用。</p>
        <label>剪贴板返回<select v-model="clipboard"><option value="off">关闭</option><option value="manual">手动复制</option><option value="smart">Smart · 保护后来复制的内容</option><option value="always">Always · 总是覆盖</option></select></label>
        <label v-if="clipboard === 'always'" class="consent"><input type="checkbox" v-model="alwaysConsent">我同意结果自动覆盖剪贴板，包括后来复制的内容。</label>
        <label class="check"><input type="checkbox" v-model="save">自动保存 Markdown</label>
        <label v-if="save">本地目录（完整路径）<input type="text" v-model="directory" placeholder="D:\Shot2Agent Results" spellcheck="false"></label>
        <button class="primary" type="submit" :disabled="busy || !data">{{ busy ? '处理中…' : '应用设置' }}</button><span v-if="dirty" class="hint unsaved">尚未保存</span>
      </form>
      <div class="profile" v-if="data"><h2>执行配置</h2><p><strong>{{ data.profile.adapter === 'fake' ? 'Fake · 合成测试' : 'Codex · 云模型' }}</strong> / {{ data.profile.sandbox }}</p><p class="path">{{ data.profile.workspace || 'Fake 不访问工作区。验收模式下结果延迟 8 秒。' }}</p><p class="hint">{{ data.profile.version || data.profile.id }}。配置由本机 Worker 管理；更换配置须退出后重新启动，不会修改排队任务。</p><details><summary>本地数据位置</summary><p class="path">{{ data.root }}</p></details></div>
    </section><section class="workspace" aria-label="预览和历史">
      <div class="section-heading"><h2>当前图片</h2><button @click="action('current')" :disabled="busy || !data">提交当前剪贴板图片</button></div>
      <div class="preview" v-if="data?.pending"><img :src="data.pending" alt="待确认的截图预览"><div><strong>等待确认</strong><p>仅此预览会被提交；后来复制的文字不会替换它。</p><button class="primary" @click="action('submit')" :disabled="busy">提交图片</button><button @click="action('discard')" :disabled="busy">丢弃</button></div></div>
      <div v-else class="empty"><strong>等待下一张截图</strong><p>使用 Win + Shift + S 复制图片。自动模式会直接排队；确认模式会在此预览。</p></div>
      <div class="section-heading history-heading"><h2>本地历史 <span>{{ data?.total ?? 0 }}</span></h2><span class="hint">显示最近 50 项</span></div>
      <p class="hint" v-if="!data?.tasks.length">尚无任务。启用捕获并应用设置，然后复制一张合成截图。</p>
      <ul class="tasks"><li v-for="task in data?.tasks" :key="task.id"><button class="task-title" @click="openTask(task.id)"><strong>{{ task.summary || task.status }}</strong><span>{{ task.id.slice(0, 8) }} · {{ task.status }}</span></button><p class="hint">剪贴板：{{ task.clipboard?.status || '等待结果' }} · 保存：{{ task.save?.status || '等待结果' }}</p><p class="error" v-if="task.error">{{ task.error }} · 请检查 Agent 配置。此任务不会自动重跑。</p><p v-if="task.clipboard?.status === 'blocked_by_clipboard_change'" class="notice">Smart 已保护较新的剪贴板内容，可手动复制结果。</p><div class="task-actions" v-if="task.status === 'succeeded'"><button @click="action('copy', { id: task.id })" :disabled="busy">复制结果</button><button @click="action('retry-delivery', { id: task.id })" :disabled="busy">重试结果投递</button></div><p class="notice" v-if="task.status === 'execution_unknown'">执行结果不确定。请先检查 Agent；应用不会自动重新执行。</p></li></ul>
      <article v-if="detail" class="result"><div class="section-heading"><h2>结果详情</h2><button @click="detail = undefined; selected = ''">关闭详情</button></div><p class="hint">{{ selected }} · {{ detail.status }}</p><pre>{{ detail.result?.contentMarkdown || detail.result?.errorCode || '暂无结果；完成后重新打开详情。' }}</pre></article>
    </section></div>
  </main>
</template>
