// Official Fluent 2 controls, bundled offline by Actions. No runtime CDN.
import '@fluentui/web-components/button.js';
import '@fluentui/web-components/divider.js';
import {setTheme} from '@fluentui/web-components/theme/set-theme.js';
import {webLightTheme,webDarkTheme} from '@fluentui/tokens';

const applyTheme=()=>setTheme(document.documentElement.dataset.theme==='dark'?webDarkTheme:webLightTheme);
applyTheme();
new MutationObserver(applyTheme).observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
// All commands use the existing restricted Tauri bridge, never HTTP or shell strings.
await import('../ui/status.js');
