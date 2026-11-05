import StarterKit from '@tiptap/starter-kit';
import TextAlign from '@tiptap/extension-text-align';
import {TableKit} from '@tiptap/extension-table';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import {common,createLowlight} from 'lowlight';
import {Markdown} from '@tiptap/markdown';
import {PaginationPlus} from 'tiptap-pagination-plus';
import {PageBreak} from './vendor/PageBreak.ts';

const lowlight=createLowlight(common);
export function editorExtensions(pages=false){
  return [StarterKit.configure({link:false,codeBlock:false}),TextAlign.configure({types:['heading','paragraph']}),TableKit.configure({table:{resizable:false}}),CodeBlockLowlight.configure({lowlight}),Markdown,PageBreak,
    ...(pages?[PaginationPlus.configure({pageWidth:680,pageHeight:960,pageGap:24,pageGapBorderSize:1,pageGapBorderColor:'#d1d1d1',pageBreakBackground:'var(--shell)',marginTop:32,marginBottom:32,marginLeft:24,marginRight:24,headerLeft:'',headerRight:'',footerLeft:'',footerRight:'{page}'})]:[])];
}
