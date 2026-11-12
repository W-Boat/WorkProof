import {icon} from './icons.js';
const sources=new Set(['word','powerpoint','wps','vscode','photoshop','blender']);
export function adapterIcon(source){
  if(!sources.has(source))return icon('document_text');
  const image=document.createElement('img');image.className='adapter-icon';image.alt='';image.width=32;image.height=32;
  image.src='adapter-icons/'+source+'.webp';image.draggable=false;image.decoding='async';return image;
}
for(const button of document.querySelectorAll('.host-toolbar [data-tool]'))button.querySelector('.tool-glyph')?.replaceWith(adapterIcon(button.dataset.tool));
