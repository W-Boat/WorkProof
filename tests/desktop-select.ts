import {expect,type Page} from '@playwright/test';
export async function selectChoice(page:Page,selector:string,value:string){
  const source=page.locator(selector);
  const id=await source.getAttribute('id');
  const label=await source.locator('option').evaluateAll((options,value)=>options.find(option=>(option as HTMLOptionElement).value===value)?.textContent,value);
  if(label==null)throw new Error('Select option not available: '+value);
  const control=page.locator(`fluent-dropdown[data-native-select="${id}"]`);
  await control.click();
  await control.getByRole('option',{name:label,exact:true}).click();
  await expect(source).toHaveValue(value);
}
