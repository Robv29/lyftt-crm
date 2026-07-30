import * as React from 'react';

import { cn } from '@/lib/utils';

const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => {
  return (
    <textarea
      className={cn(
        'flex min-h-[80px] w-full rounded-lg border border-[#d6e2e4] bg-white px-3 py-2 text-sm shadow-[inset_0_1px_1px_rgba(15,40,48,.025)] placeholder:text-slate-400 focus-visible:border-[#82b2b8] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#6AABB4]/15 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:opacity-60',
        className
      )}
      ref={ref}
      {...props}
    />
  );
});
Textarea.displayName = 'Textarea';

export { Textarea };
