import StarterKit from '@tiptap/starter-kit';
import TextAlign from '@tiptap/extension-text-align';
import {TableKit} from '@tiptap/extension-table';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import {common,createLowlight} from 'lowlight';
import {Markdown} from '@tiptap/markdown';
import {TextStyleKit} from '@tiptap/extension-text-style';
import Highlight from '@tiptap/extension-highlight';
import Image from '@tiptap/extension-image';
import {TaskList,TaskItem} from '@tiptap/extension-list';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import {FindAndReplace} from '@tiptap/extension-find-and-replace';
import {Extension} from '@tiptap/core';
import {PaginationPlus} from 'tiptap-pagination-plus';
import {PageBreak} from './vendor/PageBreak.ts';

const lowlight=createLowlight(common);
const MarkdownSource=Extension.create({name:'workproofMarkdownSource',addGlobalAttributes(){return [{types:['doc'],attributes:{markdownSource:{default:null,rendered:false},pageLayout:{default:null,rendered:false}}}];}});
const ParagraphLayout=Extension.create({name:'workproofParagraphLayout',addGlobalAttributes(){return [{types:['paragraph','heading'],attributes:{indent:{default:0,renderHTML:a=>a.indent?{style:`margin-left:${Math.max(0,Math.min(8,a.indent))*2}em`}:{}},spaceAfter:{default:0,renderHTML:a=>a.spaceAfter?{style:`margin-bottom:${Math.max(0,Math.min(36,a.spaceAfter))}pt`}:{}}}}];}});
export function editorExtensions(pages=false){
  return [StarterKit.configure({link:{openOnClick:false,autolink:false},codeBlock:false}),TextAlign.configure({types:['heading','paragraph']}),TextStyleKit,Highlight.configure({multicolor:true}),Image.configure({allowBase64:true}),TaskList,TaskItem.configure({nested:true}),Subscript,Superscript,FindAndReplace.configure({searchDebounceMs:0}),ParagraphLayout,MarkdownSource,TableKit.configure({table:{resizable:false}}),CodeBlockLowlight.configure({lowlight}),Markdown,PageBreak,
    ...(pages?[PaginationPlus.configure({pageWidth:680,pageHeight:960,pageGap:24,pageGapBorderSize:1,pageGapBorderColor:'#d1d1d1',pageBreakBackground:'var(--shell)',marginTop:32,marginBottom:32,marginLeft:24,marginRight:24,headerLeft:'',headerRight:'',footerLeft:'',footerRight:'{page}'})]:[])];
}
