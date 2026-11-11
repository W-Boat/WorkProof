'use client';
import {createContext,createElement,useContext} from 'react';

export const EmbeddedFluent = createContext(false);
export const useEmbeddedFluent = () => useContext(EmbeddedFluent);

let registration: Promise<unknown> | undefined;
export async function loadEmbeddedFluent(dark: boolean) {
  registration ??= Promise.all([
    import('@fluentui/web-components/button.js'),
    import('@fluentui/web-components/badge.js'),
    import('@fluentui/web-components/divider.js'),
    import('@fluentui/web-components/text-input.js'),
    import('@fluentui/web-components/checkbox.js'),
    import('@fluentui/web-components/progress-bar.js'),
    import('@fluentui/web-components/slider.js'),
    import('@fluentui/web-components/accordion.js'),
    import('@fluentui/web-components/accordion-item.js'),
    import('@fluentui/web-components/dropdown.js'),
    import('@fluentui/web-components/listbox.js'),
    import('@fluentui/web-components/option.js'),
    import('@fluentui/web-components/message-bar.js'),
    import('@fluentui/web-components/anchor-button.js'),
    import('@fluentui/web-components/field.js'),
  ]).catch(error => {registration=undefined;throw error;});
  await registration;
  const [{setTheme},{webDarkTheme,webLightTheme}] = await Promise.all([
    import('@fluentui/web-components/theme/set-theme.js'),import('@fluentui/tokens'),
  ]);
  setTheme(dark ? webDarkTheme : webLightTheme);
}

const nativeEvents:Record<string,string>={onClick:'onclick',onInput:'oninput',onChange:'onchange',onDragOver:'ondragover',onDragLeave:'ondragleave',onDrop:'ondrop'};
export function FluentElement({tag,...props}:{tag:string;[key:string]:unknown}){
  const attributes=Object.fromEntries(Object.entries(props).map(([name,value])=>[
    nativeEvents[name]??name,
    name.startsWith('aria-')&&typeof value==='boolean'?String(value):value,
  ]));
  return createElement(tag,attributes);
}
