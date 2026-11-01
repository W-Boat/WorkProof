<script setup lang="ts">
import {computed,onBeforeUnmount,ref,watch} from 'vue'
import Modal from '@/components/ui/Modal.vue'
import Button from '@/components/ui/Button.vue'
import Field from '@/components/ui/Field.vue'
import Checkbox from '@/components/ui/Checkbox.vue'
import Tag from '@/components/ui/Tag.vue'
import FilePicker from '@/components/ui/FilePicker.vue'
import {ApiError} from '@/api'
import {certificateJobsApi as api,type CertificateJob,type JobCapabilities} from '@/api/certificate-jobs'
const props=defineProps<{open:boolean}>(),emit=defineEmits<{(event:'close'):void;(event:'saved'):void}>()
const capability=ref<JobCapabilities|null>(null),jobs=ref<CertificateJob[]>([]),selected=ref<CertificateJob|null>(null),files=ref<File[]>([]),consent=ref(false),busy=ref(false),loading=ref(false),error=ref(''),progress=ref(0)
let generation=0,request:AbortController|null=null,clientKey='',draftId=''
const cancelling=ref('')
const active=(job:CertificateJob)=>!['completed','partial','cancelled'].includes(job.state)
const canSend=computed(()=>capability.value?.ready&&files.value.length&&consent.value&&!busy.value&&!loading.value&&!cancelling.value)
const states:Record<string,string>={draft:'尚未提交',queued:'等待处理',running:'正在处理',cleanup_failed:'临时文件清理失败',completed:'已完成',partial:'部分未通过',cancelled:'已取消'}
const name=(state:string)=>states[state]??'状态待确认'
function failure(value:unknown){error.value=value instanceof ApiError?value.message:'连接中断，请刷新确认服务器状态；不要假定任务已取消。'}
async function refresh(){if(loading.value)return;loading.value=true;const current=generation;try{const ready=await api.capabilities();if(current!==generation)return;capability.value=ready;if(ready.ready){const rows=await api.list();if(current!==generation)return;jobs.value=rows;if(selected.value)selected.value=rows.find(job=>job.id===selected.value?.id)??null}}catch(value){if(current===generation)failure(value)}finally{if(current===generation)loading.value=false}}
watch(()=>props.open,open=>{generation++;request?.abort();request=null;busy.value=false;loading.value=false;error.value='';capability.value=null;jobs.value=[];selected.value=null;cancelling.value='';clientKey='';draftId='';files.value=[];consent.value=false;progress.value=0;if(open)void refresh()})
onBeforeUnmount(()=>{generation++;request?.abort()})
function choose(chosen:File[]){if(busy.value||cancelling.value)return;clientKey='';draftId='';consent.value=false;error.value='';files.value=[];const limits=capability.value;if(!limits)return;if(chosen.length>limits.maxFiles||chosen.some(file=>!file.name.toLowerCase().endsWith('.wproof')||file.size>limits.maxFileBytes)||chosen.reduce((sum,file)=>sum+file.size,0)>limits.maxTotalBytes){error.value='请选择最多 20 份 .wproof 证书，每份不超过 32 MB，合计不超过 64 MB。';return}files.value=chosen}
async function send(){
  if(!canSend.value)return;
  const current=generation,batch=[...files.value],controller=new AbortController();
  if(!clientKey)clientKey=crypto.randomUUID();
  busy.value=true;error.value='';progress.value=0;request=controller;
  try{
    // Reuse the same key even when create/submit succeeded but their response was lost.
    let job=draftId?await api.detail(draftId):await api.create(clientKey,batch.length);
    if(current!==generation)return;
    draftId=job.id;job=await api.detail(job.id);if(current!==generation)return;selected.value=job;
    if(job.state!=='draft'||job.cancelRequested){
      error.value='这批证书已提交或正在取消，没有重复上传。请查看任务状态。';
      await refresh();return;
    }
    for(let index=0;index<batch.length;index++){
      job=await api.upload(job.id,index,batch[index],controller.signal);
      if(current!==generation)return;selected.value=job;progress.value=index+1;
    }
    job=await api.submit(job.id);if(current!==generation)return;
    selected.value=job;files.value=[];consent.value=false;emit('saved');await refresh();
  }catch(value){if(current===generation)failure(value)}
  finally{if(current===generation){busy.value=false;request=null}}
}
async function cancel(job:CertificateJob){
  if(cancelling.value||busy.value)return;
  const current=generation;cancelling.value=job.id;error.value='';
  try{const result=await api.cancel(job.id);if(current!==generation)return;selected.value=result;await refresh()}
  catch(value){if(current===generation)failure(value)}
  finally{if(current===generation)cancelling.value=''}
}
</script>
<template>
  <Modal :open="open" title="后台批量任务" sub="上传全部证书并提交后，关闭页面也会继续处理。" :width="720" @close="emit('close')">
    <div class="stack">
      <p role="status">{{ capability?.message||'正在读取准备状态…' }}</p>
      <p v-if="error" role="alert">{{ error }}</p>
      <template v-if="capability?.ready">
        <Field label="待上传证书" group><FilePicker label="选择后台任务证书" :files="files" multiple accept=".wproof" :disabled="busy||loading||!!cancelling" @select-files="choose"/><p class="field-hint">最多 20 份，每份 32 MB，合计 64 MB。作品不会上传。</p></Field>
        <Checkbox v-model="consent" :disabled="busy||loading||!!cancelling||!files.length" label="我同意将这一批证书交给机构后台检查并保存摘要" />
        <p v-if="busy" role="status">已上传 {{ progress }} / {{ files.length }} 份。全部上传并提交前，请保留本页。</p>
        <Button variant="primary" :disabled="!canSend" @click="send">上传并提交后台</Button>
        <p class="field-hint">上传未完成便关闭页面，只保留服务器已收到的草稿；草稿不会自动开始。同一批上传失败可直接重试；重新选文件会新建一批，请先取消不再使用的草稿。提交时断开连接，任务可能已开始，请先刷新确认。取消不能撤回已保存摘要。这里不确认作品、身份或创作时间。</p>
        <div v-for="job in jobs" :key="job.id" class="stack"><Button variant="text" @click="selected=job">{{ job.createdAt }} · {{ job.totalItems }} 份证书</Button><Tag>{{ name(job.state) }}</Tag><p>已处理 {{ job.completedItems }} / {{ job.expectedItems }} 份{{ job.cancelRequested?'；正在请求取消':'' }}</p><Button v-if="active(job)" variant="ghost" :disabled="busy||!!cancelling" @click="cancel(job)">请求取消这项任务</Button></div>
        <p v-if="!jobs.length">还没有后台任务。</p>
        <details v-if="selected" open><summary>所选任务的逐份结果</summary><p>任务编号：{{ selected.id }}</p><p v-for="item in selected.items" :key="item.index">第 {{ item.index+1 }} 份：{{ item.message }}{{ item.cleanupState==='error'?' 临时文件尚未清理，请联系管理员。':'' }}</p></details>
      </template>
    </div>
    <template #footer><Button variant="ghost" @click="emit('close')">关闭</Button><Button :loading="loading" :disabled="busy||!!cancelling" @click="refresh">刷新状态</Button></template>
  </Modal>
</template>
