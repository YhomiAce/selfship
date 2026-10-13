import type { LucideIcon } from 'lucide-react';

/** Props for {@link EmptyState}. */
export interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  /** Optional call to action (button or link). */
  action?: React.ReactNode;
}

/**
 * Friendly placeholder for lists with no items yet.
 *
 * @param props - See {@link EmptyStateProps}
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: EmptyStateProps): React.ReactNode {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed px-6 py-16 text-center">
      <div className="bg-muted rounded-full p-3">
        <Icon className="text-muted-foreground size-6" />
      </div>
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="text-muted-foreground max-w-md text-sm">{description}</p>
      {action}
    </div>
  );
}
