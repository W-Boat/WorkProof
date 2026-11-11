import {icon} from './icons.js';
import './command-tooltip.js';
const commands={undo:'arrow_undo',redo:'arrow_redo',bold:'text_bold',italic:'text_italic',underline:'text_underline',strike:'text_strikethrough',subscript:'text_subscript',superscript:'text_superscript',clear:'text_clear_formatting',bulletList:'text_bullet_list_ltr',orderedList:'text_number_list_ltr',taskList:'task_list_ltr',blockquote:'text_quote',codeBlock:'code',table:'table_add',tableRow:'table_insert_row',tableColumn:'table_insert_column',deleteRow:'table_delete_row',deleteColumn:'table_delete_column',deleteTable:'table_dismiss',mergeCells:'table_cells_merge',splitCell:'table_cells_split',pageBreak:'document_page_break',pages:'document_page_number',image:'image_add',link:'link',find:'search',indent:'text_indent_increase_ltr',outdent:'text_indent_decrease_ltr',print:'print',outline:'text_bullet_list_ltr',focus:'full_screen_maximize',source:'code'};
const ids={'collapse-nav':'panel_left','save-document':'save','toggle-inspector':'panel_right','view-process':'text_bullet_list_ltr','back-write':'arrow_left','back-library':'arrow_left','reload-documents':'arrow_sync','import-word':'document_text','copy-fingerprint':'copy','refresh-connections':'arrow_sync','import-markdown':'code','toggle-ribbon':'ribbon','toggle-outline':'text_bullet_list_ltr','toggle-source':'code','focus-writing':'full_screen_maximize','find-close':'dismiss','find-next':'chevron_down','find-previous':'chevron_up','replace-one':'arrow_sync','replace-all':'text_clear_formatting','toolbar-home':'ribbon','toolbar-insert':'table_add','toolbar-layout':'document_page_number'};
function paint(button){
  // React owns these children. Replacing their labels breaks reconciliation and
  // turns every report action into the fallback ellipsis icon.
  if(button.closest('#desktop-verifier-root,fluent-dropdown,fluent-listbox'))return;
  if(button.querySelector(':scope > .wp-icon'))return;
  const content=button.cloneNode(true);
  content.querySelectorAll('.glyph,[aria-hidden="true"]').forEach(node=>node.remove());
  const label=button.getAttribute('aria-label')||content.textContent.trim();if(!label)return;
  const name=button.dataset.icon||commands[button.dataset.command]||ids[button.id]||(['new-document','first-document'].includes(button.id)?'document_text':null)||(button.dataset.view?{library:'document_text',verification:'checkmark',connections:'plug_connected',settings:'settings'}[button.dataset.view]:null)||(label.includes('断开')?'plug_connected':label.includes('导出')?'arrow_download':label.includes('继续编辑')?'document_text':label.includes('打开')?'document':label.includes('安装')?'plug_connected':null);
  if(!name)return;
  button.setAttribute('aria-label',label);if(!button.title)button.title=label;
  const keep=button.classList.contains('nav-item')||button.dataset.keepLabel==='true'||/新建|创建文档|导出作品与证书|打开 .*并开始记录|允许连接|^拒绝$|安装 \/ 修复/.test(label)||button.hasAttribute('data-mode');
  if(keep){button.querySelectorAll('.glyph').forEach(g=>g.remove());button.prepend(icon(name));}
  else{button.textContent='';button.append(icon(name));button.setAttribute('icon-only','');button.classList.add('icon-button');}
}
const selector='fluent-button,button[data-icon]';
document.querySelectorAll(selector).forEach(paint);
for(const glyph of document.querySelectorAll('.glyph[data-fluent-icon]')){
  const replacement=icon(glyph.dataset.fluentIcon);
  replacement.classList.add('glyph');
  if(glyph.slot)replacement.slot=glyph.slot;
  glyph.replaceWith(replacement);
}
for(const b of document.querySelectorAll('[data-window]')){b.textContent='';b.append(icon({minimize:'subtract',maximize:'square',close:'dismiss'}[b.dataset.window]));}
new MutationObserver(records=>{for(const r of records){if(r.target.nodeType===1){const b=r.target.closest(selector);if(b)paint(b);}for(const n of r.addedNodes)if(n.nodeType===1){if(n.matches(selector))paint(n);n.querySelectorAll(selector).forEach(paint);}}}).observe(document.body,{subtree:true,childList:true});
