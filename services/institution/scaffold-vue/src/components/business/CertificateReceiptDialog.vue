<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import FormDialog from './FormDialog.vue'
import Field from '@/components/ui/Field.vue'
import FilePicker from '@/components/ui/FilePicker.vue'
import Checkbox from '@/components/ui/Checkbox.vue'
import Button from '@/components/ui/Button.vue'
import Tag from '@/components/ui/Tag.vue'
import { ApiError, receiptApi, type ReceiptCapabilities, type ServerReceipt } from '@/api'
import { downloadBlob } from '@/utils/download'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ (event: 'close'): void }>()
const file = ref<File | null>(null), consent = ref(false), busy = ref(false), loading = ref(false)
const capability = ref<ReceiptCapabilities | null>(null), result = ref<ServerReceipt | null>(null), error = ref('')
let generation = 0, request: AbortController | null = null
const ready = computed(() => Boolean(file.value && consent.value && capability.value?.configured && !loading.value && !busy.value && !result.value))
watch(() => props.open, async open => {
  const current = ++generation; request?.abort(); request = null
  file.value = null; consent.value = false; result.value = null; error.value = ''; capability.value = null; busy.value = false; loading.value = open
  if (!open) return
  try { const value = await receiptApi.capabilities(); if (current === generation) capability.value = value }
  catch (failure) { if (current === generation) error.value = failure instanceof ApiError ? failure.message : '暂时无法连接机构服务，请稍后重试。' }
  finally { if (current === generation) loading.value = false }
}, { immediate: true })
onBeforeUnmount(() => { generation++; request?.abort() })
function select(selected: File | null) {
  if (busy.value) return
  result.value = null; consent.value = false; error.value = ''; file.value = null
  if (selected && !selected.name.toLowerCase().endsWith('.wproof')) { error.value = '请选择原始 .wproof 证书文件。'; return }
  if (selected && (selected.size === 0 || selected.size > (capability.value?.maxProofBytes ?? 32 * 1024 * 1024))) { error.value = '请选择非空且不超过服务大小限制的证书（最多 32 MB）。'; return }
  file.value = selected
}
async function issue() {
  if (!ready.value || !file.value) return
  const current = generation, controller = new AbortController(); request = controller; busy.value = true; error.value = ''
  try { const value = await receiptApi.issue(file.value, controller.signal); if (current === generation) result.value = value }
  catch (failure) { if (current === generation && !controller.signal.aborted) error.value = failure instanceof ApiError ? failure.message : '未收到回执。请检查连接；服务器可能已经完成签发。' }
  finally { if (current === generation) { busy.value = false; request = null } }
}
function download() {
  if (!result.value) return
  downloadBlob(new Blob([JSON.stringify(result.value)], { type: 'application/json' }), 'workproof-server-receipt.json')
}
function time(value: number) { return new Date(value).toLocaleString('zh-CN') }
</script>

<template>
  <FormDialog :open="open" title="签发机构接收回执" sub="选择证书、确认发送，再下载机构签名的接收凭证。" :saving="busy" :submit-disabled="!ready" submit-text="发送并签发回执" @close="emit('close')" @submit="issue">
    <Field label="原始证书文件" group span :error="error || undefined">
      <FilePicker label="选择 .wproof 证书" :file="file" accept=".wproof" :disabled="busy" @select="select" />
      <p class="field-hint">回执绑定这份证书的原始字节。分享时请保留原文件，重新保存或改动内容后将无法与此回执匹配。</p>
    </Field>
    <Field label="确认发送范围" group span>
      <p class="field-hint">证书可能含文件名、记录时间和操作数量。机构将检查证书并签发接收回执；此操作不发送作品文件，也不保存完整证书。</p>
      <Checkbox v-model="consent" :disabled="busy || !file || !!result" label="我同意将所选证书发送给机构服务器签发接收回执" />
      <p v-if="loading" role="status" class="field-hint">正在检查签发服务…</p>
      <p v-else-if="capability && !capability.configured" role="status" class="field-hint">{{ capability.message }}</p>
      <p v-if="busy" role="status" class="field-hint">正在签发。关闭窗口只会取消等待，不会撤销服务器已签发的回执。</p>
    </Field>
    <Field v-if="result" label="保存和分享" group span aria-live="polite">
      <Tag tone="ok">已收到接收回执</Tag>
      <p>签发机构：<strong style="overflow-wrap:anywhere">{{ result.payload.issuer_id }}</strong></p>
      <p>{{ result.payload.scope === 'selective' ? '本次分享的部分记录' : '全部记录' }} · {{ result.payload.received_events }} 条</p>
      <p class="field-hint">接收时间：{{ time(result.payload.received_at_ms) }}；有效至：{{ time(result.payload.expires_at_ms) }}。时间由签发服务器声明。</p>
      <Button @click="download">下载接收回执</Button>
      <p>请将原始证书与回执一起交给接收方。接收方还需通过机构可信渠道独立取得签发者编号和公钥，再在核验页面检查。</p>
      <p class="field-hint">回执仅证明持有该密钥的服务接收了这份证书，不证明官方客户端来源、作者身份或真人创作。浏览器核验通过后才能确认回执签名与文件匹配。</p>
    </Field>
  </FormDialog>
</template>
