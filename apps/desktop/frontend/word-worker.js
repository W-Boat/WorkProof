// Existing offline DOCX converter. No network, credentials, or format codec here.
import {parseDOCX,generateDOCXSync} from '@docen/docx/converters/docx';
import {detectHeadingLevel} from '@docen/docx/extensions/paragraph';
import {mediaBytesOf} from '@docen/docx/extensions/media-registry';
import {buildListLevels} from '@docen/docx/extensions/list-numbering';

function checkZip(bytes){
  if(bytes.byteLength>8*1024*1024)throw new Error('Word 文件超过 8 MB，请先缩小文件。');
  const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let end=-1;
  for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(v.getUint32(i,true)===0x06054b50){end=i;break;}
  if(end<0)throw new Error('请选择完整的 .docx 文件。');
  const entries=v.getUint16(end+10,true),offset=v.getUint32(end+16,true);if(entries>2048||offset>=bytes.length)throw new Error('Word 文件结构过于复杂。');
  let p=offset,total=0;
  for(let i=0;i<entries;i++){if(p+46>bytes.length||v.getUint32(p,true)!==0x02014b50)throw new Error('Word 文件结构不完整。');const size=v.getUint32(p+24,true);total+=size;if(size>8*1024*1024||total>32*1024*1024)throw new Error('Word 文件解压后过大，请拆分文件。');p+=46+v.getUint16(p+28,true)+v.getUint16(p+30,true)+v.getUint16(p+32,true);}
}
// Schema adaptation only. The upstream plugin owns all DOCX parsing/writing.
// Docen uses flat paragraphs with heading/list attrs, unlike StarterKit nodes.
const highlightColors={yellow:'#ffff00',green:'#00ff00',cyan:'#00ffff',magenta:'#ff00ff',blue:'#0000ff',red:'#ff0000',darkBlue:'#000080',darkCyan:'#008080',darkGreen:'#008000',darkMagenta:'#800080',darkRed:'#800000',darkYellow:'#808000',darkGray:'#808080',lightGray:'#c0c0c0',black:'#000000',white:'#ffffff'};
const simpleMarks=new Set(['bold','italic','underline','strike','code','subscript','superscript']);
const safeLink=href=>typeof href==='string'&&/^(https?:\/\/|mailto:)/i.test(href);
const color=value=>typeof value==='string'&&/^#?[\da-f]{6}$/i.test(value)?'#'+value.replace(/^#/,'').toLowerCase():null;
function points(value){const m=String(value||'').match(/^([\d.]+)(pt|px)?$/);return m?Number(m[1])*(m[2]==='px'?.75:1):null;}
function exportMarks(marks=[]){return marks.flatMap(mark=>{
  if(simpleMarks.has(mark.type)||mark.type==='highlight'||mark.type==='link')return [mark];
  if(mark.type!=='textStyle')return [];
  const a=mark.attrs||{},attrs={};if(a.color)attrs.color=a.color;if(a.fontFamily)attrs.font=a.fontFamily;const size=points(a.fontSize);if(size)attrs.size=size;
  return Object.keys(attrs).length?[{type:'textStyle',attrs}]:[];
});}
function importMarks(marks=[]){const result=[];for(const mark of marks){
  const a=mark.attrs||{};
  if(simpleMarks.has(mark.type)){result.push({type:mark.type});continue;}
  if(mark.type==='link'&&safeLink(a.href)){result.push({type:'link',attrs:{href:a.href,target:'_blank',rel:'noopener noreferrer nofollow'}});continue;}
  if(mark.type==='highlight'){const value=color(a.color)||highlightColors[a.color];if(value)result.push({type:'highlight',attrs:{color:value}});continue;}
  if(mark.type!=='textStyle')continue;
  const attrs={};if(color(a.color))attrs.color=color(a.color);
  const font=typeof a.font==='string'?a.font:a.font?.eastAsia||a.font?.ascii;
  if(typeof font==='string'&&font.length<=120)attrs.fontFamily=font;
  if(typeof a.size==='number'&&a.size>=6&&a.size<=96)attrs.fontSize=`${a.size}pt`;
  if(Object.keys(attrs).length)result.push({type:'textStyle',attrs});
  if(a.shading?.fill&&color(a.shading.fill)&&!marks.some(m=>m.type==='highlight'))result.push({type:'highlight',attrs:{color:color(a.shading.fill)}});
}return result;}
function exportParagraph(node,context={}){
  const a=node.attrs||{},attrs={};if(a.textAlign)attrs.alignment=a.textAlign==='justify'?'both':a.textAlign;
  if(a.indent)attrs.indent={left:a.indent*480};if(a.spaceAfter)attrs.spacing={after:a.spaceAfter*20};
  const height=node.content?.flatMap(n=>n.marks||[]).find(m=>m.type==='textStyle'&&m.attrs?.lineHeight)?.attrs.lineHeight;
  if(height)attrs.spacing={...attrs.spacing,line:Math.round(Number(height)*240),lineRule:'auto'};
  if(node.type==='heading')attrs.heading=`Heading${a.level||1}`;
  if(context.quote)attrs.style='IntenseQuote';if(node.type==='codeBlock')attrs.style='Code';
  if(context.list){if(context.list==='orderedList')attrs.numbering={reference:context.reference,level:context.level};else attrs.bullet={level:context.level};}
  return {type:'paragraph',attrs,content:(node.content||[]).map(n=>n.type==='text'?{...n,marks:exportMarks(n.marks)}:n)};
}
function toDocen(doc){let nextList=0;const numbering=[];
  function blocks(nodes,context={},depth=0){
    if(depth>48)throw new Error('文档嵌套过深。');
    return nodes.flatMap(node=>{
      if(['paragraph','heading','codeBlock'].includes(node.type))return [exportParagraph(node,context)];
      if(['bulletList','orderedList','taskList'].includes(node.type)){
        const reference=`docen-ordered-${++nextList}`,level=context.list?context.level+1:0;
        if(node.type==='orderedList'&&Number(node.attrs?.start)>1){const levels=buildListLevels(reference);if(levels){levels[level].start=Number(node.attrs.start);numbering.push({reference,levels});}}
        return (node.content||[]).flatMap(item=>{
          const itemContext={...context,list:node.type,level,reference};let firstParagraph=true;
          const content=(item.content||[]).flatMap(child=>{
            const paragraph=['paragraph','heading','codeBlock'].includes(child.type),continued=paragraph&&!firstParagraph;
            if(paragraph)firstParagraph=false;
            return blocks([child],continued?{...context,list:null}:itemContext,depth+1);
          });
          if(node.type==='taskList'&&content[0]?.type==='paragraph')content[0].content.unshift({type:'text',text:item.attrs?.checked?'☑ ':'☐ '});
          return content;
        });
      }
      if(node.type==='blockquote')return blocks(node.content||[],{...context,quote:true},depth+1);
      if(node.type==='horizontalRule')return [{type:'paragraph',attrs:{thematicBreak:true}}];
      if(node.type==='pageBreak')return [{type:'paragraph',content:[{type:'pageBreak'}]}];
      if(node.type==='image')return [node];
      if(node.type==='table')return [{type:'table',content:(node.content||[]).map(row=>({type:'tableRow',content:(row.content||[]).map(cell=>{
        if((cell.attrs?.rowspan||1)>1)throw new Error('当前 Word 导出支持横向合并表格。含纵向合并的文档请先导出网页作品，或拆分单元格后导出 Word。');
        return {type:'tableCell',attrs:{columnSpan:cell.attrs?.colspan||1},content:blocks(cell.content||[],{},depth+1)};
      })}))}];
      if(node.content)return blocks(node.content,context,depth+1);
      return [];
    });
  }
  const result={type:'doc',content:blocks(doc.content||[])};
  if(numbering.length)result.attrs={numbering:{abstractNumberings:numbering}};
  const layout=doc.attrs?.pageLayout;if(layout){const size=layout.size==='LETTER'?[12240,15840]:[11906,16838],landscape=layout.orientation==='landscape',margin={narrow:320,normal:640,wide:1120}[layout.margin]||640;
    result.attrs={...result.attrs,sectionProperties:{pageSize:{width:size[landscape?1:0],height:size[landscape?0:1],orientation:landscape?'landscape':'portrait'},pageMargin:{top:margin,bottom:margin,left:margin,right:margin}}};}
  return result;
}
function imageNode(node){
  const a=node.attrs||{};let src=a.src;
  if(typeof src==='string'&&src.startsWith('blob:')){const media=mediaBytesOf(src);if(media){let binary='';for(const byte of media.bytes)binary+=String.fromCharCode(byte);src=`data:image/${media.type};base64,${btoa(binary)}`;}}
  if(typeof src!=='string'||!/^data:image\/(png|jpe?g|gif|webp);base64,/i.test(src)||src.length>1024*1024)throw new Error('Word 中包含当前无法导入的图片，请改用不超过 750 KB 的 PNG、JPEG、GIF 或 WebP 图片。');
  src=src.replace(/^data:image\/jpg;/i,'data:image/jpeg;');return {type:'image',attrs:{src,alt:String(a.alt||'').slice(0,200),title:String(a.title||'').slice(0,200)}};
}
function fromDocen(doc){
  function blocks(nodes,depth=0){
    if(depth>48)throw new Error('Word 文件嵌套过深。');
    const result=[],stack=[];
    for(const node of nodes){
      if(node.type==='paragraph'){
        const a=node.attrs||{},level=detectHeadingLevel(a,doc.attrs?.styles),attrs={};
        if(a.alignment)attrs.textAlign=a.alignment==='both'?'justify':a.alignment;
        if(a.indent?.left)attrs.indent=Math.max(0,Math.min(8,Math.round(Number(a.indent.left)/480)));
        if(a.spacing?.after)attrs.spaceAfter=Math.max(0,Math.min(36,Number(a.spacing.after)/20));
        const content=[];let extra=[];
        for(const child of node.content||[]){
          if(child.type==='text'&&child.text)content.push({type:'text',text:child.text,marks:importMarks(child.marks)});
          else if(child.type==='hardBreak')content.push({type:'hardBreak'});
          else if(child.type==='image')extra.push(imageNode(child));
          else if(child.type==='pageBreak')extra.push({type:'pageBreak'});
          else if(child.type==='tab')content.push({type:'text',text:'\t'});
          else throw new Error('Word 正文包含暂不支持的对象，请在 Word 中另存一份简化副本后导入。');
        }
        let paragraph={type:level?'heading':'paragraph',attrs:{...attrs,...level?{level:Math.min(3,level)}:{}},content};
        if(a.style==='Code')paragraph={type:'codeBlock',content:content.filter(n=>n.type==='text').map(n=>({type:'text',text:n.text}))};
        if(a.thematicBreak)paragraph={type:'horizontalRule'};
        if(a.style==='IntenseQuote')paragraph={type:'blockquote',content:[paragraph]};
        const listing=a.bullet||a.numbering;
        if(listing){
          const kind=a.bullet?'bulletList':'orderedList',reference=a.numbering?.reference||'bullet',indent=Math.max(0,Math.min(8,listing.level||0));
          while(stack.length>indent+1)stack.pop();
          if(stack[indent]?.kind!==kind||stack[indent]?.reference!==reference)stack.length=Math.min(stack.length,indent);
          while(stack.length<=indent){
            const start=doc.attrs?.numbering?.abstractNumberings?.find(definition=>definition.reference===reference)?.levels?.[indent]?.start||1;
            const list={type:kind,...kind==='orderedList'?{attrs:{start}}:{},content:[]};
            if(stack.length){const parent=stack.at(-1).node;if(!parent.content.length)parent.content.push({type:'listItem',content:[{type:'paragraph'}]});parent.content.at(-1).content.push(list);}else result.push(list);
            stack.push({node:list,kind,reference});
          }
          stack[indent].node.content.push({type:'listItem',content:[paragraph,...extra]});
        }else{stack.length=0;result.push(paragraph,...extra);}
      }else if(node.type==='table'){
        stack.length=0;
        result.push({type:'table',content:(node.content||[]).map(row=>({type:'tableRow',content:(row.content||[]).map(cell=>{
          if(cell.attrs?.verticalMerge)throw new Error('该 Word 表格含有纵向合并单元格，请先在 Word 中拆分这些单元格后再导入。');
          return {type:'tableCell',attrs:{colspan:Math.max(1,Math.min(30,cell.attrs?.columnSpan||1)),rowspan:1},content:blocks(cell.content||[],depth+1)};
        })}))});
      }else if(node.type==='image'){stack.length=0;result.push(imageNode(node));}
      else throw new Error('Word 中包含暂不支持的图形、目录或嵌入对象，请在 Word 中另存一份简化副本后导入。');
    }
    return result.length?result:[{type:'paragraph'}];
  }
  return {type:'doc',content:blocks(doc.content||[])};
}
self.onmessage=async({data})=>{
  try{
    if(data.action==='import'){
      const bytes=new Uint8Array(data.bytes);checkZip(bytes);const parsed=await parseDOCX(bytes);const result=fromDocen(parsed);if(result?.type!=='doc')throw new Error('Word 插件未返回有效文档。');
      if(JSON.stringify(result).length>2*1024*1024)throw new Error('Word 正文过大，请拆分文件。');self.postMessage({result});
    }else if(data.action==='export'){
      const output=await generateDOCXSync(toDocen(data.content),{packer:{type:'uint8array'}});const result=Uint8Array.from(output);if(result.length>8*1024*1024)throw new Error('导出的 Word 文件超过 8 MB。');self.postMessage({result},[result.buffer]);
    }else throw new Error('不支持的 Word 操作。');
  }catch(error){self.postMessage({error:error instanceof Error?error.message:'Word 插件未能完成转换。'});}
};
self.postMessage({ready:true});
