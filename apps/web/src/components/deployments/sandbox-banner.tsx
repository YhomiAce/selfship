'use client';

import { Clock, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { type ProjectSandbox, SANDBOX_DAYS } from '@selfship/shared';
import { Button } from '@/components/ui/button';
import { ApiRequestError } from '@/lib/api-client';
import { sandboxApi } from '@/lib/sandbox-api';

/**
 * Tells users their free sandbox app is temporary: when it's removed, an
 * "Extend" button (once), and the way to their own server.
 *
 * @param props.projectId - Project ID
 * @param props.sandbox - Sandbox facts
 * @param props.onChanged - Reload after extending
 */
export function SandboxBanner({
  projectId,
  sandbox,
  onChanged,
}: {
  projectId: string;
  sandbox: ProjectSandbox;
  onChanged: () => void;
}): React.ReactNode {
  const [extending, setExtending] = useState(false);
  // Read the clock once (render must stay pure); a day-level countdown doesn't need ticking.
  const [now] = useState(() => Date.now());
  const expires = new Date(sandbox.expiresAt);
  const daysLeft = Math.max(0, Math.ceil((expires.getTime() - now) / 86_400_000));

  const extend = async (): Promise<void> => {
    setExtending(true);
    try {
      await sandboxApi.extend(projectId);
      toast.success(`Extended by ${SANDBOX_DAYS} days`);
      onChanged();
    } catch (error) {
      toast.error(error instanceof ApiRequestError ? error.message : 'Could not extend.');
    } finally {
      setExtending(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-500/40 bg-amber-50 p-4 text-sm text-amber-950 dark:bg-amber-950/30 dark:text-amber-100">
      <Clock className="size-5 shrink-0" />
      <p className="min-w-0 flex-1">
        {sandbox.expired ? (
          <>
            This project&apos;s free sandbox time is over and its app was removed. Choose your own
            server below and deploy to bring it back.
          </>
        ) : (
          <>
            Running on the free sandbox: it will be removed on{' '}
            <strong>{expires.toLocaleDateString()}</strong> ({daysLeft} day
            {daysLeft === 1 ? '' : 's'} left). Move it to your own server to keep it.
          </>
        )}
      </p>
      {!sandbox.expired && !sandbox.extended ? (
        <Button size="sm" variant="outline" disabled={extending} onClick={() => void extend()}>
          {extending ? <Loader2 className="animate-spin" /> : null}
          Extend {SANDBOX_DAYS} days
        </Button>
      ) : null}
    </div>
  );
}
