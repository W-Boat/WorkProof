import '@fluentui/web-components/dropdown.js';
import '@fluentui/web-components/listbox.js';
import '@fluentui/web-components/option.js';

// Keep the existing HTML select as the form/state contract; only the visible
// control changes. All editor and settings handlers keep their original events.
export function initializeSelectControls(){
  let sequence=0;
  const enhanced=new WeakSet();
  function enhance(source){
    if(enhanced.has(source)||source.multiple||source.closest('#desktop-verifier-root'))return;
    enhanced.add(source);
    if(!source.id)source.id='workproof-select-'+(++sequence);
    const dropdown=document.createElement('fluent-dropdown'),listbox=document.createElement('fluent-listbox');
    dropdown.className='wp-select';dropdown.dataset.nativeSelect=source.id;
    dropdown.id=source.id+'-fluent';listbox.setAttribute('role','listbox');dropdown.append(listbox);
    const label=source.getAttribute('aria-label')||[...source.labels].map(label=>label.textContent.trim()).join(' ')||source.id;
    dropdown.setAttribute('aria-label',label);
    if(source.hasAttribute('aria-labelledby'))dropdown.setAttribute('aria-labelledby',source.getAttribute('aria-labelledby'));
    let rendering=false,signature='';
    function synchronize(){
      if(rendering)return;rendering=true;
      try{
        dropdown.hidden=source.hidden;dropdown.disabled=source.disabled;
        dropdown.setAttribute('aria-disabled',String(source.disabled));
        const options=[...source.options],next=JSON.stringify(options.map(option=>[option.value,option.textContent,option.disabled]));
        if(next!==signature){
          signature=next;
          listbox.replaceChildren(...options.map(option=>{
            const item=document.createElement('fluent-option');item.value=option.value;item.textContent=option.textContent;
            item.disabled=option.disabled;item.setAttribute('role','option');
            item.defaultSelected=option.selected;return item;
          }));
        }
        for(const item of listbox.querySelectorAll('fluent-option')){
          item.selected=item.value===source.value;item.setAttribute('aria-selected',String(item.selected));
        }
      }finally{rendering=false;}
    }
    for(const property of ['value','selectedIndex']){
      const descriptor=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,property);
      Object.defineProperty(source,property,{configurable:true,get(){return descriptor.get.call(this);},set(value){descriptor.set.call(this,value);queueMicrotask(synchronize);}});
    }
    dropdown.addEventListener('change',()=>{
      if(rendering||source.disabled)return;
      const value=dropdown.value;
      if(value===source.value||typeof value!=='string'||![...source.options].some(option=>option.value===value&&!option.disabled))return;
      source.value=value;source.dispatchEvent(new Event('input',{bubbles:true}));source.dispatchEvent(new Event('change',{bubbles:true}));
    });
    source.addEventListener('change',synchronize);source.addEventListener('input',synchronize);
    function labelControl(){
      const control=dropdown.querySelector('[slot="control"]');if(!control)return;
      control.setAttribute('aria-label',label);
      if(source.hasAttribute('aria-labelledby'))control.setAttribute('aria-labelledby',source.getAttribute('aria-labelledby'));
    }
    new MutationObserver(labelControl).observe(dropdown,{subtree:true,childList:true});
    source.focus=options=>dropdown.querySelector('[slot="control"]')?.focus(options);
    new MutationObserver(synchronize).observe(source,{subtree:true,childList:true,characterData:true,attributes:true});
    source.after(dropdown);source.classList.add('wp-select-source');source.tabIndex=-1;source.setAttribute('aria-hidden','true');
    // Labels still refer to the original control for form compatibility.
    for(const labelNode of source.labels)labelNode.addEventListener('click',event=>{event.preventDefault();dropdown.querySelector('[slot="control"]')?.focus();});
    synchronize();
  }
  document.querySelectorAll('select').forEach(enhance);
  new MutationObserver(records=>{for(const record of records)for(const node of record.addedNodes)if(node.nodeType===1){if(node.matches('select'))enhance(node);node.querySelectorAll('select').forEach(enhance);}}).observe(document.body,{subtree:true,childList:true});
}
