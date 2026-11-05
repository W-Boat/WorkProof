<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import FormDialog from './FormDialog.vue'
import Field from '@/components/ui/Field.vue'
import Checkbox from '@/components/ui/Checkbox.vue'
import Tag from '@/components/ui/Tag.vue'
import FilePicker from '@/components/ui/FilePicker.vue'
import CertificateActions from './CertificateActions.vue'
import { ApiError, certificateApi, type CertificateCapabilities, type CertificateInspection } from '@/api'

const props = defineProps<{open: boolean; saveToCatalog?: boolean}>()
const emit = defineEmits<{(event: 'close'): void; (event: 'saved'): void}>()
const file = ref<File | null>(null), consent = ref(false), busy = ref(false), loading = ref(false)
const capability = ref<CertificateCapabilities | null>(null), result = ref<CertificateInspection | null>(null), error = ref('')
let generation = 0, request: AbortController | null = null
const ready = computed(() => Boolean(file.value && consent.value && capability.value?.configured && !loading.value && !busy.value))
const actionText = computed(() => props.saveToCatalog ? '检查并保存摘要' : '检查证书内容')
watch(() => props.open, async open => {
  const current = ++generation; request?.abort(); request = null
  file.value = null; consent.value = false; result.value = null; error.value = ''; capability.value = null; busy.value = false; loading.value = open
  if (!open) return
  try { const value = await certificateApi.capabilities(); if (current === generation) capability.value = value }
  catch (failure) { if (current === generation) error.value = failure instanceof ApiError ? failure.message : '暂时无法连接机构服务，请稍后重试。' }
  finally { if (current === generation) loading.value = false }
}, {immediate: true})
onBeforeUnmount(() => { generation++; request?.abort() })
function select(selected: File | null) {
  if (busy.value) return
  result.value = null; consent.value = false; error.value = ''
  if (selected && !selected.name.toLowerCase().endsWith('.wproof')) { file.value = null; error.value = '请选择 .wproof 证书文件，其他文件不会发送。'; return }
  if (selected && selected.size > (capability.value?.maxProofBytes ?? 32 * 1024 * 1024)) { file.value = null; error.value = '证书超过 32 MB，请先在本机导出部分记录。'; return }
  file.value = selected
}
async function inspect() {
  if (!ready.value || !file.value) return
  const current = generation, proof = file.value; request = new AbortController(); busy.value = true; error.value = ''; result.value = null
  try {
    const value = props.saveToCatalog ? (await certificateApi.save(proof, request.signal)).inspection : await certificateApi.inspect(proof, request.signal)
    if (current === generation) { result.value = value; if (props.saveToCatalog) emit('saved') }
  }
  catch (failure) { if (current === generation && !request?.signal.aborted) error.value = failure instanceof ApiError ? failure.message : '检查没有完成，请稍后重试。' }
  finally { if (current === generation) { busy.value = false; request = null } }
}
</script>

<template>
  <FormDialog :open="open" :title="saveToCatalog ? '检查并保存证书摘要' : '检查一份证书'" sub="选择证书、确认发送，再查看结果。作品文件不会发送到机构服务器。" :saving="busy" :submit-disabled="!ready" :submit-text="saveToCatalog ? '检查并保存摘要' : '检查证书内容'" @close="emit('close')" @submit="inspect">
    <Field label="证书文件" group span :error="error || undefined">
      <FilePicker label="选择 .wproof 证书" :file="file" accept=".wproof" :disabled="busy" @select="select"/>
      <span class="field-hint">这是创作者导出的过程证书。请选择证书文件，不要选择作品或证书截图。</span>
    </Field>
    <Field label="确认发送范围" group span>
      <p v-if="saveToCatalog" class="field-hint">检查通过后保存文件名、证书指纹、操作数量和提交账号，供权限范围内的机构成员查询。不保存作品或完整过程记录。</p>
      <p class="field-hint">证书可能包含文件名、记录时间和操作数量。若只想分享部分过程，请先在本机检查页面导出部分记录。</p>
      <Checkbox v-model="consent" :disabled="busy || !file" label="我同意将所选证书发送给机构服务器检查" />
      <p v-if="loading" class="field-hint" role="status">正在检查服务是否就绪…</p>
      <p v-else-if="capability && !capability.configured" class="field-hint" role="status">{{ capability.message }}</p>
      <p v-if="busy" class="field-hint" role="status">正在检查证书内容，请稍等…</p>
      <p v-else-if="capability?.configured && !result" class="field-hint" role="status">{{ !file ? '下一步：选择一份证书。' : !consent ? `下一步：阅读上方说明，确认同意后勾选，再点击“${actionText}”。` : `准备好了，点击“${actionText}”查看结果。` }}</p>
    </Field>
    <Field v-if="result" label="查看检查结果" group span aria-live="polite">
      <Tag :tone="result.certificate_valid ? 'ok' : 'danger'">{{ result.certificate_valid ? '证书内容一致' : '证书内容未能确认' }}</Tag>
      <Tag v-if="result.manifest?.demo" tone="neutral">演示证书</Tag>
      <p><strong>{{ result.manifest?.file_name || '无法识别文件名' }}</strong></p>
      <p v-if="result.certificate_valid">{{ result.scope === 'selective' ? '只检查本次分享的记录' : '已检查全部记录' }}；签名一致。</p>
      <p v-if="saveToCatalog && result.certificate_valid" role="status">摘要已保存，可关闭窗口在列表查看。相同文件不会重复创建。</p>
      <p v-else-if="!result.certificate_valid">请向提供者索取原始 .wproof 文件，并确认它没有被修改。</p>
      <p v-if="result.scope === 'selective'" class="field-hint">未检查全部过程记录，不能据此判断未分享的过程。</p>
      <CertificateActions v-if="result.certificate_valid" :counts="result.actions"/>
      <p class="field-hint">作品仍需在本机单独检查。这里没有确认作者身份，也没有确认实际创作时间。</p>
      <Field v-if="result.certificateId" label="证书指纹" group>
        <code style="overflow-wrap:anywhere">{{ result.certificateId }}</code>
        <span class="field-hint">这是识别同一张证书的编号。请与提供者通过可信渠道发来的完整编号核对；一致也不代表作者身份已确认。</span>
      </Field>
    </Field>
  </FormDialog>
</template>
