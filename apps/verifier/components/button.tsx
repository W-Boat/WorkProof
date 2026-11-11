import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { ButtonHTMLAttributes } from 'react';
import {FluentElement,useEmbeddedFluent} from './fluent-embedded';
// React adapter for the institution Button.vue contract. CSS is imported from its source.
const variants=cva('btn',{variants:{variant:{primary:'btn-primary',secondary:'btn-secondary m-pill',ghost:'btn-ghost'}},defaultVariants:{variant:'secondary'}});
export function Button({className,variant,asChild=false,...props}:ButtonHTMLAttributes<HTMLButtonElement>&VariantProps<typeof variants>&{asChild?:boolean}){
  const embedded=useEmbeddedFluent();
  if(embedded&&!asChild)return <FluentElement tag="fluent-button" role="button" type="button" aria-disabled={props.disabled} appearance={variant==='primary'?'primary':variant==='ghost'?'subtle':'secondary'} className={className} {...props} onClick={props.disabled?undefined:props.onClick}/>;
  const Comp=asChild?Slot:'button';return <Comp className={twMerge(clsx(variants({variant}),className))} {...props}/>;
}
