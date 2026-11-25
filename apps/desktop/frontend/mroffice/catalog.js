import {formats} from './formats.js';

export const editors = {
  docs: {...formats.docs, load: () => import('mroffice-docs')},
  sheets: {...formats.sheets, load: () => import('mroffice-sheets')},
  slides: {...formats.slides, load: () => import('mroffice-slides')},
  pdf: {...formats.pdf, load: () => import('mroffice-pdf')},
  ink: {...formats.ink, load: () => import('mroffice-ink'), loadHost: () => import('workproof-mroffice-ink-core')},
  code: {...formats.code, load: () => import('mroffice-code')},
};

// MR Office's official format list distinguishes round-trip editing from viewing.
export const fullEngineFormats = [
  ['文档', '.docx .doc .dot .dotx .rtf .odt .txt .md .html .htm', '.docm .dotm .ott .fodt .sxw .stw .wps .wpt .mht .mhtml .epub .fb2 .pages .hwp .hwpx'],
  ['表格', '.xlsx .xls .xltx .ods .fods .csv .tsv', '.xlsm .xltm .xlsb .xlt .ots .sxc .et .ett .numbers'],
  ['演示', '.pptx .ppt .potx .ppsx .odp .odg', '.pptm .potm .ppsm .pps .pot .otp .fodp .sxi .dps .dpt .key'],
  ['PDF', '.pdf', '.xps .oxps .djvu .vsdx .vsd .vssx .vstx .vsdm .vssm .vstm .png .jpg .gif .bmp .tiff .webp'],
];
