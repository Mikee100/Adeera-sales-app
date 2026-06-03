import React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-xl text-sm font-semibold transition disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-brand-indigo text-white hover:bg-indigo-700',
        secondary: 'bg-slate-100 text-slate-800 hover:bg-slate-200',
        ghost: 'bg-transparent text-slate-700 hover:bg-slate-100',
        success: 'bg-brand-success text-white hover:bg-emerald-600',
        warning: 'bg-brand-warning text-slate-900 hover:bg-amber-500',
        danger: 'bg-brand-danger text-white hover:bg-red-500',
      },
      size: {
        sm: 'h-9 px-3',
        md: 'h-11 px-4',
        lg: 'h-12 px-5',
        icon: 'h-10 w-10',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'md',
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  ),
);

Button.displayName = 'Button';
