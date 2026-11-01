<script setup lang="ts">
import { ref } from 'vue'
import { certificateApi, type CertificateEntry } from '@/api'
import { useListPage } from '@/composables/list'
import { hasPermission } from '@/directives/permission'
import { toastError } from '@/composables/toast'
import { ListPage, PermissionButton } from '@/components/business'
import { Field, TextInput, Tag, Select, type Column } from '@/components/ui'
import Modal from '@/components/ui/Modal.vue'
import CertificateInspectionDialog from '@/components/business/CertificateInspectionDialog.vue'
import CertificateBatchDialog from '@/components/business/CertificateBatchDialog.vue'
const batch = ref(false)
const upload = ref(false), detail = ref<CertificateEntry | null>(null)
const list = useListPage<CertificateEntry, {keyword: string; scope: string}>({
  query: {keyword:'',scope:''}, fetch: query => certificateApi.list(query),
  exporter: hasPermission('workproof:certificate:export') ? query => certificateApi.export(query) : undefined,
  exportName: '证书摘要列表.csv',
})
const columns: Column[] = [
  {key:'fileName',title:'作品文件名',minWidth:180}, {key:'scope',title:'检查范围',width:120},
  {key:'disclosedEvents',title:'已检查操作数',width:130}, {key:'createBy',title:'提交账号',width:130},
  {key:'checkedAt',title:'保存时间',width:180}, {key:'actions',title:'操作',width:100},
]
async function openDetail(row: CertificateEntry) {
  try { detail.value = await certificateApi.detail(row.id) } catch(error) { toastError(error, '详情加载失败') }
}
</script>
<template>
  <ListPage title="证书管理" desc="检查并保存证书摘要，随后按文件名或证书指纹查找。这里不检查作品，也不确认作者身份或实际创作时间。" table-title="已保存的证书摘要" :list="list" :columns="columns">
    <template #actions><PermissionButton perm="workproof:certificate:add" @click="batch = true">批量检查</PermissionButton><PermissionButton perm="workproof:certificate:add" variant="primary" @click="upload = true">检查并保存摘要</PermissionButton></template>
    <template #search>
      <Field label="文件名或证书指纹" wide><TextInput v-model="list.query.keyword" placeholder="文件名的一部分 / 完整证书指纹" @enter="list.search()" /></Field>
      <Field label="检查范围"><Select :model-value="list.query.scope" :options="[{label:'全部范围',value:''},{label:'全部记录',value:'full'},{label:'部分记录',value:'selective'}]" @update:model-value="list.query.scope = String($event ?? '')" /></Field>
    </template>
    <template #cell-fileName="{row}"><span class="cell-title">{{ row.fileName }}</span><Tag v-if="row.demo" tone="neutral">演示</Tag></template>
    <template #cell-scope="{row}"><Tag tone="info">{{ row.scope === 'full' ? '全部记录' : '部分记录' }}</Tag></template>
    <template #cell-actions="{row}"><PermissionButton perm="workproof:certificate:list" variant="text" @click="openDetail(row)">查看详情</PermissionButton></template>
    <CertificateInspectionDialog :open="upload" save-to-catalog @close="upload = false" @saved="list.search()" />
    <CertificateBatchDialog :open="batch" @close="batch = false" @saved="list.load()" />
    <Modal :open="!!detail" title="证书摘要详情" sub="保存的是一次内容检查的摘要，不是人类创作认定。" @close="detail = null">
      <div v-if="detail" class="stack">
        <p><strong>{{ detail.fileName }}</strong></p>
        <p>{{ detail.scope === 'full' ? '已检查全部记录' : '仅检查本次分享的部分记录' }} · {{ detail.disclosedEvents }} / {{ detail.totalEvents }} 条操作</p>
        <Field label="证书指纹" group><code style="overflow-wrap:anywhere">{{ detail.certificateId }}</code></Field>
        <Field label="这份证书文件的摘要" group><code style="overflow-wrap:anywhere">{{ detail.proofHash }}</code><span class="field-hint">完整与部分证书可有同一证书指纹，此摘要用于区分具体文件。</span></Field>
        <p>由 {{ detail.createBy }} 于 {{ detail.checkedAt }} 保存。这是服务器保存时间。</p>
        <p>未检查作品；未确认作者身份或实际创作时间。需要检查作品时，请在本机核验页同时选择作品和原始证书。</p>
      </div>
    </Modal>
  </ListPage>
</template>
