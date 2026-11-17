import { AlertTriangle, Info, Lightbulb } from 'lucide-react';
import { cn } from '@/lib/utils';

const KINDS = {
  note: { icon: Info, className: 'border-sky-200 bg-sky-50 text-sky-950', label: 'Note' },
  tip: {
    icon: Lightbulb,
    className: 'border-emerald-200 bg-emerald-50 text-emerald-950',
    label: 'Tip',
  },
  warning: {
    icon: AlertTriangle,
    className: 'border-amber-200 bg-amber-50 text-amber-950',
    label: 'Warning',
  },
} as const;

/**
 * Highlighted box in the docs: `<Callout kind="warning">…</Callout>`.
 *
 * @param kind - note (default), tip or warning
 */
export function Callout({
  kind = 'note',
  children,
}: {
  kind?: keyof typeof KINDS;
  children: React.ReactNode;
}): React.ReactNode {
  const { icon: Icon, className, label } = KINDS[kind];
  return (
    <div
      role="note"
      aria-label={label}
      className={cn('not-prose my-6 flex gap-3 rounded-lg border px-4 py-3 text-sm', className)}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="space-y-2 [&_a]:underline [&_code]:rounded [&_code]:bg-black/5 [&_code]:px-1">
        {children}
      </div>
    </div>
  );
}
