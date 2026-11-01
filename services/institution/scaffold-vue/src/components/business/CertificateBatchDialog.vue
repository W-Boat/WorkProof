<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import Modal from '@/components/ui/Modal.vue'
import Button from '@/components/ui/Button.vue'
import Field from '@/components/ui/Field.vue'
import Checkbox from '@/components/ui/Checkbox.vue'
import Tag from '@/components/ui/Tag.vue'
import { ApiError, certificateApi } from '@/api'
import { downloadCsv } from '@/utils/csv'
const props = defineProps<{open: boolean}>()
const emit = defineEmits<{(event:'close'):void; (event:'saved'):void}>()
type Item = {file:File; status:'等待发送'|'正在检查'|'已保存'|'未完成'|'未发送'; message:string}
const rows=ref<Item[]>([]), consent=ref(false), busy=ref(false), error=ref('')
let generation=0, controller:AbortController|null=null, stopped=false
const finished=computed(()=>rows.value.filter(row=>!['等待发送','正在检查'].includes(row.status)).length)
function cancel() {stopped=true;controller?.abort()}
function reset() {generation++;cancel();rows.value=[];consent.value=false;busy.value=false;error.value=''}
watch(()=>props.open,reset)
onBeforeUnmount(reset)
function choose(event:Event) {
  if(busy.value)return
  const files=Array.from((event.target as HTMLInputElement).files??[])
  rows.value=[];consent.value=false;error.value=''
  if(files.length>20){error.value='一次最多选择 20 份证书，请分批处理。';return}
  if(files.some(file=>!file.name.toLowerCase().endsWith('.wproof')||file.size>32*1024*1024)) {error.value='请选择 .wproof 证书，每份不超过 32 MB。';return}
  if(files.reduce((sum,file)=>sum+file.size,0)>64*1024*1024){error.value='这一批超过 64 MB，请减少所选文件。';return}
  rows.value=files.map(file=>({file,status:'等待发送',message:''}))
}
async function start() {
  if(busy.value||!consent.value||!rows.value.length||rows.value.some(row=>row.status!=='等待发送'))return
  const current=generation;stopped=false;busy.value=true
  try {
    for(const row of rows.value) {
      if(stopped||current!==generation)break
      row.status='正在检查';controller=new AbortController()
      try {
        await certificateApi.save(row.file,controller.signal)
        if(current!==generation)return
        row.status='已保存';row.message='内容一致，摘要已保存；相同文件不会重复创建。';emit('saved')
      } catch(failure) {
        if(current!==generation)return
        row.status='未完成';row.message=stopped?'已停止等待结果；服务器可能已保存，可在列表查询。':failure instanceof ApiError?failure.message:'未能取得结果，请稍后在列表查询或重试。'
        if(failure instanceof ApiError && [401,403,429,503].includes(failure.status))stopped=true
      }
    }
  } finally {
    if(current===generation){rows.value.filter(row=>row.status==='等待发送').forEach(row=>row.status='未发送');busy.value=false;controller=null}
  }
}
function exportResults(){downloadCsv('批量证书处理结果.csv',[{title:'证书文件',value:(row:Item)=>row.file.name},{title:'处理结果',key:'status'},{title:'说明',key:'message'}],rows.value)}
</script>
<template>
  <Modal :open="open" title="批量检查并保存摘要" sub="选择证书、确认发送，再逐份查看结果。作品不会上传。" :width="720" @close="emit('close')">
    <div class="stack">
      <Field label="选择多份 .wproof 证书" :error="error || undefined"><input type="file" accept=".wproof" multiple :disabled="busy" @change="choose"><span class="field-hint">一次最多 20 份，每份最多 32 MB，合计最多 64 MB。</span></Field>
      <p>检查通过后保存文件名、证书指纹、操作数量和提交账号，供权限范围内的成员查询。不保存作品或完整过程记录。</p>
      <Checkbox v-model="consent" :disabled="busy || !rows.length" label="我同意发送这一批证书，并保存检查通过的摘要" />
      <p role="status">已处理 {{ finished }} / {{ rows.length }} 份。{{ busy ? '正在逐份发送，请保留本页。' : '一份失败不会影响其他证书；已保存的结果会保留。' }}</p>
      <div v-for="(row,index) in rows" :key="index" class="stack">
        <strong style="overflow-wrap:anywhere">{{ row.file.name }}</strong><Tag :tone="row.status==='已保存'?'ok':row.status==='未完成'?'danger':'neutral'">{{ row.status }}</Tag><p v-if="row.message">{{ row.message }}</p>
      </div>
      <p class="field-hint">这里只检查证书内容，不确认作品、作者身份或实际创作时间。关闭页面会停止后续发送，不能撤回已发出的请求；重新选择文件可再试，相同文件不会重复保存。</p>
    </div>
    <template #footer>
      <Button v-if="busy" variant="ghost" @click="cancel">停止后续处理</Button>
      <Button v-else variant="ghost" @click="emit('close')">关闭</Button>
      <Button v-if="finished && !busy" @click="exportResults">下载本批结果</Button>
      <Button variant="primary" :disabled="busy || !consent || !rows.length || finished>0" @click="start">开始批量检查</Button>
    </template>
  </Modal>
</template>
