<script setup lang="ts">
import { computed } from 'vue'
import BarChart from '@/components/charts/BarChart.vue'
const props=defineProps<{counts?:Record<string,number>}>()
const definitions:{title:string;labels:Record<string,string>}[]=[
  {title:'捕获到的键盘指令',labels:{backspace:'退格',delete_forward:'向前删除',space:'空格',enter:'回车',copy:'复制',paste:'粘贴',cut:'剪切',undo_commands:'撤销',redo_commands:'重做',format_commands:'格式快捷键',cursor_moves:'移动光标'}},
  {title:'观察到的文档变化',labels:{format_changes:'格式变化',layout_changes:'版式变化',undo_events:'撤销修改',redo_events:'重做修改',spaces_inserted:'新增空格',line_breaks_inserted:'新增换行'}},
]
const groups=computed(()=>definitions.map(group=>{
  const entries=Object.entries(group.labels).flatMap(([key,label])=>{
    const count=props.counts?.[key]
    return typeof count==='number'&&Number.isSafeInteger(count)&&count>0?[[label,count] as const]:[]
  })
  return {title:group.title,entries,labels:entries.map(([label])=>label),values:entries.map(([,count])=>count)}
}).filter(group=>group.entries.length))
</script>
<template>
  <section class="stack" aria-label="已披露记录的动作统计">
    <h3>具体操作</h3>
    <p v-if="!groups.length" class="field-hint">这份证书未提供细分动作，或检查工具暂不支持。不把未采集的动作显示为零。</p>
    <section v-for="group in groups" :key="group.title" class="stack">
      <h4>{{ group.title }}</h4>
      <BarChart :values="group.values" :labels="group.labels" :height="144" unit="次"/>
      <dl class="action-counts"><div v-for="[label,count] in group.entries" :key="label"><dt>{{ label }}</dt><dd>{{ count.toLocaleString() }} 次</dd></div></dl>
    </section>
    <p class="field-hint">仅统计本次已披露且通过内容核验的记录。键盘指令不代表执行成功；鼠标菜单、输入法与触屏操作可能未采集。格式与版式按采样比较，短时间的多次修改可能合并。</p>
  </section>
</template>
<style scoped>
h3,h4{font-weight:600;font-size:var(--text-sm,14px);margin:0}.action-counts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px 24px;margin:0;font-size:12px}.action-counts>div{display:flex;justify-content:space-between;gap:8px}.action-counts dd{margin:0;font-variant-numeric:tabular-nums}@media(max-width:480px){.action-counts{grid-template-columns:1fr}}
</style>
