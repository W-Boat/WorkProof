<script setup lang="ts">
import {computed,onBeforeUnmount,ref,watch} from 'vue'
import FormDialog from './FormDialog.vue'
import Field from '@/components/ui/Field.vue'
import Checkbox from '@/components/ui/Checkbox.vue'
import Select from '@/components/ui/Select.vue'
import Tag from '@/components/ui/Tag.vue'
import FilePicker from '@/components/ui/FilePicker.vue'
import Button from '@/components/ui/Button.vue'
import {downloadBlob} from '@/utils/download'
import {analysisApi,ApiError} from '@/api'
import type {AnalysisCapabilities,AnalysisTask} from '@/api/analysis'
const props=defineProps<{open:boolean}>(),emit=defineEmits<{(event:'close'):void}>()
const capability=ref<AnalysisCapabilities|null>(null),file=ref<File|null>(null),engine=ref('mpu-zh-v3'),consent=ref(false),busy=ref(false),cancelling=ref(false),error=ref(''),task=ref<AnalysisTask|null>(null)
let generation=0,request:AbortController|null=null
const options=computed(()=>capability.value?.engines.map(e=>({value:e.id,label:e.label+(e.configured?'':'（尚未准备）'),disabled:!e.configured}))??[])
const ready=computed(()=>!busy.value&&!!file.value&&consent.value&&capability.value?.engines.some(e=>e.id===engine.value&&e.configured))
watch(()=>props.open,async open=>{
  const current=++generation;file.value=null;consent.value=false;task.value=null;error.value='';capability.value=null;busy.value=false;cancelling.value=false
  if(open)try{const value=await analysisApi.capabilities();if(current===generation)capability.value=value}catch(failure){if(current===generation)error.value=failure instanceof ApiError?failure.message:'暂时无法读取准备状态，请稍后重试。'}
})
onBeforeUnmount(()=>{generation++;request?.abort();if(busy.value&&task.value)void analysisApi.cancel(task.value.id).catch(()=>{})})
function resetResult(){task.value=null;error.value='';consent.value=false}
function select(value:File|null){if(busy.value)return;resetResult();
  if(value&&(!/\.(docx|txt|md)$/i.test(value.name)||value.size>(capability.value?.maxBytes??8*1024*1024))){file.value=null;error.value='请选择不超过 8 MB 的 DOCX、TXT 或 Markdown 文件。';return}file.value=value}
async function close(){if(!busy.value){emit('close');return}if(cancelling.value)return;cancelling.value=true
  if(task.value)try{task.value=await analysisApi.cancel(task.value.id)}catch{error.value='暂时无法确认是否停止，服务器可能继续分析至超时；请稍后查询。'}
}
async function submit(){
  if(!ready.value||!file.value)return
  const current=generation;busy.value=true;error.value='';task.value=null;cancelling.value=false;request=new AbortController()
  const deadline=setTimeout(()=>request?.abort(),180000)
  try{
    const value=await analysisApi.submit(file.value,engine.value,file.value.name.split('.').pop()!.toLowerCase(),request.signal)
    if(current!==generation){void analysisApi.cancel(value.id).catch(()=>{});return}
      task.value=value;if(cancelling.value)task.value=await analysisApi.cancel(value.id)
    while(current===generation&&['queued','running','cancelling','finalizing'].includes(task.value.state)){
      await new Promise(resolve=>setTimeout(resolve,1000));if(current!==generation)return;task.value=await analysisApi.status(value.id)
    }
    if(current===generation&&!['done','cancelled'].includes(task.value.state))error.value=task.value.state==='timeout'?'分析用时过长，已停止。':task.value.state==='cleanup_failed'?'临时文档未能清理，请联系管理员处理。':'分析未能完成，请核对文档格式、长度，或联系管理员检查模型。'
  }catch(failure){if(current===generation)error.value=failure instanceof ApiError?failure.message:'连接中断，无法确认是否停止；服务器可能继续分析至超时。'}
  finally{clearTimeout(deadline);if(current===generation){busy.value=false;request=null}}
}
const label=(key:string)=>key==='AI'?'更接近生成样本的模型得分':'更接近人类样本的模型得分'
function downloadReport(){const report=task.value?.report;if(!report)return;downloadBlob(new Blob([JSON.stringify({...report,notice:'辅助分析记录，可被修改；不是签名证书，也不是作者身份或 AI 使用比例证明。'},null,2)],{type:'application/json;charset=utf-8'}),`workproof-analysis-${report.artifact_hash.slice(0,12)}.json`)}
</script>
<template>
  <FormDialog :open="open" title="AI 辅助分析" sub="选择文档、确认发送范围，再查看参考结果。" :saving="busy" :submit-disabled="!ready" submit-text="发送并分析" @submit="submit" @close="close">
    <Field label="待分析文档" group span :error="error||undefined"><FilePicker label="选择文档" :file="file" accept=".docx,.txt,.md" :disabled="busy" @select="select"/><span class="field-hint">最多 8 MB。只分析主文档源文字，不含页眉、脚注或图片；隐藏或修订文字可能包含在内。</span></Field>
    <Field label="选择参考模型" span><Select :model-value="engine" :options="options" :disabled="busy" @update:model-value="value=>{engine=String(value);resetResult()}"/><p class="field-hint">按文档语言选择中文或英文 MPU v3。模型尚未在本产品中评估误报率，结果仅供人工复核，不能单独用于认定作弊或原创性。</p></Field>
    <Field label="确认发送范围" group span><Checkbox v-model="consent" :disabled="busy||!file" label="我同意将所选文档发送给机构服务器进行辅助分析"/><p class="field-hint">分析后删除临时文档，不保存正文；参考结果最多保留十分钟，服务器重启后不保留。作品较长时会提示未分析，不会悄悄只分析开头。</p><p class="field-hint" role="status">{{ busy ? (cancelling?'正在请求停止，请等待服务器确认…':'正在分析；点击取消可请求停止实际分析进程。') : capability?.message||'正在读取模型准备状态…' }}</p></Field>
    <Field v-if="task?.state==='cancelled'" label="分析已取消" group span><p role="status">服务器已结束本次分析。</p></Field>
    <Field v-if="task?.report&&task.report.status!=='completed'" label="下一步" span><p>{{ task.report.message }}</p></Field>
    <Field v-if="task?.report" label="辅助结果" group span aria-live="polite"><Tag tone="info">{{ task.report.status==='completed'?'仅供人工参考':'本次未完成模型分析' }}</Tag><p>模型得分不是 AI 内容比例，也没有确认作者身份。</p><dl v-if="task.report.raw_scores"><template v-for="(value,key) in task.report.raw_scores" :key="key"><dt>{{ label(String(key)) }}</dt><dd>{{ value.toFixed(4) }}（未校准）</dd></template></dl><p class="field-hint">{{ task.report.scope }}</p><code style="overflow-wrap:anywhere">文档 SHA-256：{{ task.report.artifact_hash }}</code><details><summary>模型版本与报告</summary><p style="overflow-wrap:anywhere">{{ task.report.model }} · {{ task.report.model_revision }}</p><p>保存的记录包含文件指纹和模型版本，不含正文；记录可以被修改，不是签名证书。</p><Button @click="downloadReport">保存辅助报告</Button></details></Field>
  </FormDialog>
</template>
