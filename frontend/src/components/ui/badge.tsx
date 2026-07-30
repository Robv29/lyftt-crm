import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex min-w-0 max-w-full items-center justify-center gap-1.5 whitespace-nowrap rounded-xl border px-2.5 py-1 text-[10px] font-semibold leading-tight tracking-[0.01em] shadow-[0_1px_2px_rgba(15,23,42,.04)] transition-[color,background-color,border-color,box-shadow,transform] duration-200 focus:outline-none focus:ring-4 focus:ring-[#6AABB4]/20 sm:px-3 sm:py-1.5 sm:text-xs [&>svg]:h-3.5 [&>svg]:w-3.5 [&>svg]:shrink-0',
  {
    variants: {
      variant: {
        default:
          'border-transparent bg-primary text-primary-foreground hover:-translate-y-px hover:bg-primary/90 hover:shadow-sm',
        secondary:
          'border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/85',
        destructive:
          'border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/90',
        outline: 'border-slate-200 bg-white/85 text-slate-700 hover:border-[#6AABB4]/45 hover:bg-[#6AABB4]/5',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
