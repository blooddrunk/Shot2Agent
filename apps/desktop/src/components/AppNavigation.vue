<script setup lang="ts">
defineProps<{ page: string }>();
const emit = defineEmits<{ navigate: [page: string] }>();
const items = [{id:'home', label:'首页'}, {id:'agents', label:'AI 助手'}, {id:'history', label:'历史记录'}, {id:'settings', label:'设置'}];
</script>
<template>
  <nav aria-label="主要导航">
    <button v-for="item in items" :key="item.id" :aria-current="page === item.id ? 'page' : undefined" @click="emit('navigate', item.id)">{{ item.label }}</button>
  </nav>
</template>
