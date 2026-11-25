// Document formats advertised by the offline components packaged with WorkProof.
export const editors = {
  docs: {
    label: '文档', open: '.mrdoc,.mrdoc.json,.html,.htm,.md,.markdown,.txt', save: '.mrdoc',
    load: () => import('mroffice-docs'),
  },
  sheets: {
    label: '表格', open: '.mrsheet,.mrsheet.json,.csv,.tsv', save: '.mrsheet、.csv、.tsv（后两种只保存首个工作表的值）',
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

// MR Office's official format list distinguishes round-trip editing from viewing.
export const fullEngineFormats = [
  ['文档', '.docx .doc .dot .dotx .rtf .odt .txt .md .html .htm', '.docm .dotm .ott .fodt .sxw .stw .wps .wpt .mht .mhtml .epub .fb2 .pages .hwp .hwpx'],
  ['表格', '.xlsx .xls .xltx .ods .fods .csv .tsv', '.xlsm .xltm .xlsb .xlt .ots .sxc .et .ett .numbers'],
  ['演示', '.pptx .ppt .potx .ppsx .odp .odg', '.pptm .potm .ppsm .pps .pot .otp .fodp .sxi .dps .dpt .key'],
  ['PDF', '.pdf', '.xps .oxps .djvu .vsdx .vsd .vssx .vstx .vsdm .vssm .vstm .png .jpg .gif .bmp .tiff .webp'],
];
