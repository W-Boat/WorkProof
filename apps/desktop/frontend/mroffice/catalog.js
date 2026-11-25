// Document formats advertised by the offline components packaged with WorkProof.
export const editors = {
  docs: {
    label: '文档', open: '.mrdoc,.mrdoc.json,.html,.htm,.md,.markdown,.txt', save: '.mrdoc',
    load: () => import('mroffice-docs'),
  },
  sheets: {
    label: '表格', open: '.mrsheet,.mrsheet.json,.csv,.tsv', save: '.mrsheet',
    load: () => import('mroffice-sheets'),
  },
  slides: {
    label: '演示', open: '.mrslides,.mrslides.json', save: '.mrslides',
    load: () => import('mroffice-slides'),
  },
  pdf: {
    label: 'PDF', open: '.pdf', save: '',
    load: () => import('mroffice-pdf'),
  },
  ink: {
    label: '手写', open: '.mrink,.mrink.json', save: '.mrink',
    load: () => import('mroffice-ink'),
  },
  code: {
    label: '代码', open: '.txt,.js,.jsx,.ts,.tsx,.py,.lua,.sql,.sh,.json,.yaml,.yml,.html,.css,.xml,.md,.rs,.c,.h,.cpp,.cs,.java,.go,.rb,.php',
    save: '原扩展名', load: () => import('mroffice-code'),
  },
};
