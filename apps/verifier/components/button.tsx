import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { ButtonHTMLAttributes } from 'react';
// React adapter for the institution Button.vue contract. CSS is imported from its source.
const variants=cva('btn',{variants:{variant:{primary:'btn-primary',secondary:'btn-secondary m-pill',ghost:'btn-ghost'}},defaultVariants:{variant:'secondary'}});
export function Button({className,variant,asChild=false,...props}:ButtonHTMLAttributes<HTMLButtonElement>&VariantProps<typeof variants>&{asChild?:boolean}){const Comp=asChild?Slot:'button';return <Comp className={twMerge(clsx(variants({variant}),className))} {...props}/>;}
