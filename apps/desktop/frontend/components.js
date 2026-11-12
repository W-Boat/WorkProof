// Official Fluent 2 controls, bundled offline by Actions. No runtime CDN.
import '@fluentui/web-components/button.js';
import '@fluentui/web-components/divider.js';
import '@fluentui/web-components/switch.js';
import '@fluentui/web-components/radio.js';
import '@fluentui/web-components/radio-group.js';
import '@fluentui/web-components/field.js';
import '@fluentui/web-components/text-input.js';
import '@fluentui/web-components/progress-bar.js';
import {setTheme} from '@fluentui/web-components/theme/set-theme.js';
import {webLightTheme,webDarkTheme} from '@fluentui/tokens';
import './icon-controls.js';
import './native-interactions.js';
import './adapter-icons.js';

const applyTheme=()=>setTheme(document.documentElement.dataset.theme==='dark'?webDarkTheme:webLightTheme);
applyTheme();
new MutationObserver(applyTheme).observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
// Expose the same state to assistive technology that does not yet consume
// ElementInternals ARIA. This also applies to dynamically inserted grants.
function accessibleButton(button){
  button.setAttribute('role','button');
  button.setAttribute('aria-disabled',String(button.hasAttribute('disabled')));
}
for(const button of document.querySelectorAll('fluent-button'))accessibleButton(button);
new MutationObserver(records=>{
  for(const record of records){
    if(record.type==='attributes')accessibleButton(record.target);
    else for(const node of record.addedNodes)if(node.nodeType===1){
      if(node.matches('fluent-button'))accessibleButton(node);
      for(const button of node.querySelectorAll('fluent-button'))accessibleButton(button);
    }
  }
}).observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['disabled']});
// All commands use the existing restricted Tauri bridge, never HTTP or shell strings.
await import('../ui/status.js');
await import('./editor.js');
const {initializeSelectControls}=await import('./select-controls.js');
initializeSelectControls();
const {initializePaneLayout}=await import('./pane-layout.js');
initializePaneLayout();
// A restored tray window is ready only after event listeners, document saving
// and pane controls exist. Native pending navigation and quit requests follow.
await window.workproofTrayListeners;
await window.__TAURI__?.core.invoke('window_action',{action:'ready'});
