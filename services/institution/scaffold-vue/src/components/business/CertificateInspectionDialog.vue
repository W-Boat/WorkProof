<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import FormDialog from './FormDialog.vue'
import Field from '@/components/ui/Field.vue'
import Checkbox from '@/components/ui/Checkbox.vue'
import Tag from '@/components/ui/Tag.vue'
import { ApiError, certificateApi, type CertificateCapabilities, type CertificateInspection } from '@/api'

const props = defineProps<{open: boolean}>()
const emit = defineEmits<{(event: 'close'): void}>()
const file = ref<File | null>(null), consent = ref(false), busy = ref(false), loading = ref(false)
const capability = ref<CertificateCapabilities | null>(null), result = ref<CertificateInspection | null>(null), error = ref('')
let generation = 0, request: AbortController | null = null
const ready = computed(() => Boolean(file.value && consent.value && capability.value?.configured && !loading.value && !busy.value))
watch(() => props.open, async open => {
  const current = ++generation; request?.abort(); request = null
  file.value = null; consent.value = false; result.value = null; error.value = ''; capability.value = null; busy.value = false; loading.value = open
  if (!open) return
  try { const value = await certificateApi.capabilities(); if (current === generation) capability.value = value }
  catch (failure) { if (current === generation) error.value = failure instanceof ApiError ? failure.message : '暂时无法连接机构服务，请稍后重试。' }
  finally { if (current === generation) loading.value = false }
}, {immediate: true})
onBeforeUnmount(() => { generation++; request?.abort() })
function select(event: Event) {
  if (busy.value) return
  result.value = null; consent.value = false; error.value = ''
  const selected = (event.target as HTMLInputElement).files?.[0] ?? null
  if (selected && !selected.name.toLowerCase().endsWith('.wproof')) { file.value = null; error.value = '请选择 .wproof 证书文件，其他文件不会发送。'; return }
  if (selected && selected.size > (capability.value?.maxProofBytes ?? 32 * 1024 * 1024)) { file.value = null; error.value = '证书超过 32 MB，请先在本机导出部分记录。'; return }
  file.value = selected
}
async function inspect() {
  if (!ready.value || !file.value) return
  const current = generation, proof = file.value; request = new AbortController(); busy.value = true; error.value = ''; result.value = null
  try { const value = await certificateApi.inspect(proof, request.signal); if (current === generation) result.value = value }
  catch (failure) { if (current === generation && !request?.signal.aborted) error.value = failure instanceof ApiError ? failure.message : '检查没有完成，请稍后重试。' }
  finally { if (current === generation) { busy.value = false; request = null } }
}
</script>

<template>
  <FormDialog :open="open" title="检查一份证书" sub="选择证书、确认发送，再查看结果。作品文件不会发送到机构服务器。" :saving="busy" :submit-disabled="!ready" submit-text="检查证书内容" @close="emit('close')" @submit="inspect">
    <Field label="选择 .wproof 证书" span :error="error || undefined">
      <input type="file" accept=".wproof" :disabled="busy" @change="select">
    </Field>
    <div class="span-2">
      <p class="field-hint">证书可能包含文件名、记录时间和操作数量。若只想分享部分过程，请先在本机检查页面导出部分记录。</p>
      <Checkbox v-model="consent" :disabled="busy || !file" label="我同意将所选证书发送给机构服务器检查" />
      <p v-if="loading" class="field-hint" role="status">正在检查服务是否就绪…</p>
      <p v-else-if="capability && !capability.configured" class="field-hint" role="status">{{ capability.message }}</p>
      <p v-if="busy" class="field-hint" role="status">正在检查证书内容，请稍等…</p>
    </div>
    <div v-if="result" class="span-2" aria-live="polite">
      <Tag :tone="result.certificate_valid ? 'ok' : 'danger'">{{ result.certificate_valid ? '证书内容一致' : '证书内容未能确认' }}</Tag>
      <Tag v-if="result.manifest?.demo" tone="neutral">演示证书</Tag>
      <p>{{ result.manifest?.file_name || '无法识别文件名' }}</p>
      <p v-if="result.certificate_valid">{{ result.scope === 'selective' ? '只检查本次分享的记录' : '已检查全部记录' }}；签名一致。</p>
      <p v-else>请向提供者索取原始 .wproof 文件，并确认它没有被修改。</p>
      <p v-if="result.scope === 'selective'" class="field-hint">未检查完整记录链，不能据此判断未分享的过程。</p>
      <p class="field-hint">作品仍需在本机单独检查。这里没有确认作者身份，也没有确认实际创作时间。</p>
      <Field v-if="result.certificateId" label="证书指纹" group>
        <code style="overflow-wrap:anywhere">{{ result.certificateId }}</code>
      </Field>
    </div>
  </FormDialog>
</template>
