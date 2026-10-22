<script setup lang="ts">
import { House, Bot, History, Settings, Sun, Moon, PanelLeftClose, Power, Camera,
  ClipboardPaste, ClipboardCopy, Copy, FileDown, FolderOpen, ImagePlus, Images,
  Send, Pause, Play, Trash2, ArrowUp, ArrowDown, ArrowRight, Plus, Pencil,
  RotateCcw, Save, Check, CircleAlert, HardDrive, Archive, Keyboard, X, Search } from '@lucide/vue';
const icons = { home: House, agent: Bot, history: History, settings: Settings,
  sun: Sun, moon: Moon, hide: PanelLeftClose, power: Power, camera: Camera,
  clipboard: ClipboardPaste, 'copy-file': ClipboardCopy, copy: Copy, file: FileDown,
  folder: FolderOpen, image: ImagePlus, images: Images, send: Send, pause: Pause,
  play: Play, trash: Trash2, up: ArrowUp, down: ArrowDown, next: ArrowRight,
  plus: Plus, edit: Pencil, retry: RotateCcw, save: Save, check: Check,
  alert: CircleAlert, drive: HardDrive, archive: Archive, keyboard: Keyboard, close: X, search: Search };
defineProps<{ name: keyof typeof icons; size?: number }>();
</script>
<template>
  <component :is="icons[name]" class="app-icon" :size="size ?? 16" :stroke-width="1.8" aria-hidden="true" focusable="false" />
</template>
