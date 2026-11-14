import {icon} from './icons.js';
const sources=new Set(['word','powerpoint','wps','vscode','photoshop','blender','krita','sai2','illustrator','indesign','wps-presentation','excel','wps-spreadsheets']);
export function adapterIcon(source){
  const name=source==='sai2-file'?'sai2':source;
  if(!sources.has(name))return icon('document_text');
  const image=document.createElement('img');image.className='adapter-icon';image.alt='';image.width=32;image.height=32;
  image.src='adapter-icons/'+name+'.webp';image.draggable=false;image.decoding='async';return image;
}
for(const button of document.querySelectorAll('.host-toolbar [data-tool]'))button.querySelector('.tool-glyph')?.replaceWith(adapterIcon(button.dataset.tool));
