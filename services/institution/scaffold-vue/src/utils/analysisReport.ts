import type {AnalysisTask} from '@/api/analysis'

export function readableAnalysisReport(report:NonNullable<AnalysisTask['report']>):string{
  const lines=[
    'WorkProof 辅助分析说明',
    '',
    '这份说明可以被修改，不是签名创作证书。',
    '它不确认作者身份，不表示 AI 内容比例，也不能单独用于认定作弊。',
    '',
    `本次状态：${report.status==='completed'?'分析已完成，仅供人工参考':'未完成模型分析'}`,
    '分析方法：比较文字与模型训练样本的写法。不同分类模型的分数不合并。',
  ]
  if(report.status==='completed'&&report.raw_scores){
    lines.push('','模型参考得分（未校准）：')
    const keys=report.score_kind==='uncalibrated_binary_sigmoid'?['AI']:['AI','Human']
    for(const key of keys){
      const value=report.raw_scores[key]
      if(typeof value==='number'&&Number.isFinite(value))lines.push(`${key==='AI'?'更接近生成样本':'更接近人类样本'}：${value.toFixed(4)}`)
    }
    if(report.score_kind==='uncalibrated_binary_sigmoid')lines.push('该模型只有一个参考分数；人类补值不作为第二项独立判断列出。')
  }
  if(report.message)lines.push('',`结果说明：${report.message}`)
  lines.push('','建议下一步：核对创作过程、作品来源及作者对思路的说明。模型也会误判人写的文字。',
    '',`分析范围：${report.scope}`,`文档指纹（SHA-256）：${report.artifact_hash}`,
    `模型：${report.model}`,`模型版本：${report.model_revision}`,`引擎标识：${report.engine_id}`,
    '', '这份说明不含文档正文。文档指纹用于与原文件核对，不证明说明由可信签发者出具。')
  return lines.join('\r\n')+'\r\n'
}
