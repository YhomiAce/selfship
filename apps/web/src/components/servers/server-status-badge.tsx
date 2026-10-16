import { Loader2 } from 'lucide-react';
import { SERVER_STATUS_LABELS, type ServerStatus } from '@selfship/shared';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

/** Badge colour per status (busy states spin). */
const STYLES: Record<ServerStatus, string> = {
  awaiting_key: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-100',
  checking: 'bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-100',
  checked: 'bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-100',
  needs_attention: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-100',
  setting_up: 'bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-100',
  setup_failed: 'bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-100',
  ready: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100',
  unreachable: 'bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-100',
};

/**
 * Status badge for a server.
 *
 * @param props.status - Server status
 */
export function ServerStatusBadge({ status }: { status: ServerStatus }): React.ReactNode {
  const busy = status === 'checking' || status === 'setting_up';
  return (
    <Badge className={cn('border-transparent', STYLES[status])}>
      {busy ? <Loader2 className="animate-spin" /> : null}
      {SERVER_STATUS_LABELS[status]}
    </Badge>
  );
}
