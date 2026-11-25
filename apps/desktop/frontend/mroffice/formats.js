// Document formats advertised by the offline components packaged with WorkProof.
export const formats = {
  docs: {
    label: '文档', open: '.mrdoc,.mrdoc.json,.html,.htm,.md,.markdown,.txt', save: '.mrdoc',
  },
  sheets: {
    label: '表格', open: '.mrsheet,.mrsheet.json,.csv,.tsv', save: '.mrsheet、.csv、.tsv（后两种只保存首个工作表的值）',
  },
  slides: {
    label: '演示', open: '.mrslides,.mrslides.json', save: '.mrslides',
  },
  pdf: {
    label: 'PDF', open: '.pdf', save: '',
  },
  ink: {
    label: '手写', open: '.mrink,.mrink.json', save: '.mrink',
  },
  code: {
    label: '代码', open: '.txt,.js,.jsx,.ts,.tsx,.py,.lua,.sql,.sh,.json,.yaml,.yml,.html,.css,.xml,.md,.rs,.c,.h,.cpp,.cs,.java,.go,.rb,.php',
    save: '原扩展名',
  },
};

export function officeOpenType(name) {
  const lower = name.toLowerCase();
  return Object.keys(formats).find(type=>formats[type].open.split(',').some(ext=>lower.endsWith(ext)));
}
