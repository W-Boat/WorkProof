<script setup lang="ts">
import {ref} from 'vue'
import Button from './Button.vue'
defineProps<{label:string;file:File|null;accept?:string;disabled?:boolean}>()
const emit=defineEmits<{(event:'select',file:File|null):void}>()
const input=ref<HTMLInputElement|null>(null)
function select(event:Event){const element=event.target as HTMLInputElement;emit('select',element.files?.[0]??null);element.value=''}
</script>
<template>
  <div class="file-picker">
    <Button :disabled="disabled" @click="input?.click()">选择文件</Button>
    <span class="file-picker-name" aria-live="polite">{{ file?.name||'尚未选择文件' }}</span>
    <input ref="input" type="file" :aria-label="label" :accept="accept" :disabled="disabled" hidden @change="select">
  </div>
</template>
