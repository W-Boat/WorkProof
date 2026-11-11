// App chrome behaves like desktop UI. Editing and explicitly copyable evidence
// retain selection and keyboard shortcuts.
const editable='input,textarea,[contenteditable="true"],.cm-content,.tiptap,[data-selectable],.nv-certificate,#certificate-fingerprint,#history-preview';
document.addEventListener('contextmenu',event=>event.preventDefault());
document.addEventListener('selectstart',event=>{
  if(!event.composedPath().some(node=>node instanceof Element&&node.matches(editable)))event.preventDefault();
});
document.addEventListener('keydown',event=>{
  if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='a'&&!event.composedPath().some(node=>node instanceof Element&&node.matches(editable)))event.preventDefault();
});
