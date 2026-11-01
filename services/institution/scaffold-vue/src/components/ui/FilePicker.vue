<script setup lang="ts">
import {ref} from 'vue'
import Button from './Button.vue'
defineProps<{label:string;file?:File|null;files?:File[];multiple?:boolean;accept?:string;disabled?:boolean}>()
const emit=defineEmits<{(event:'select',file:File|null):void;(event:'selectFiles',files:File[]):void}>()
const input=ref<HTMLInputElement|null>(null)
function select(event:Event){const element=event.target as HTMLInputElement;emit('select',element.files?.[0]??null);emit('selectFiles',Array.from(element.files??[]));element.value=''}
</script>
<template>
  <div class="file-picker">
    <Button :disabled="disabled" @click="input?.click()">选择文件</Button>
    <span class="file-picker-name" aria-live="polite">{{ multiple?(files?.length?`已选择 ${files.length} 份文件`:'尚未选择文件'):file?.name||'尚未选择文件' }}</span>
    <input ref="input" type="file" :aria-label="label" :accept="accept" :multiple="multiple" :disabled="disabled" hidden @change="select">
  </div>
</template>
