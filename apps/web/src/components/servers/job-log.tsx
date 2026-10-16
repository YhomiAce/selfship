'use client';

import { CircleCheck, CircleX, Loader2 } from 'lucide-react';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import type { JobStatus, ServerJobEvent } from '@selfship/shared';
import { serversApi } from '@/lib/servers-api';
import { cn } from '@/lib/utils';

/** Props for {@link JobLog}. */
export interface JobLogProps {
  serverId: string;
  jobId: string;
  /** Called once when the job finishes (e.g. to refresh the server). */
  onEnd?: (status: JobStatus) => void;
}

/** Colour a log line by its leading symbol. */
function lineClass(line: string): string {
  if (line.startsWith('✓')) return 'text-emerald-400';
  if (line.startsWith('✗') || line.includes('  ✗')) return 'text-red-400';
  if (line.includes('⚠')) return 'text-amber-300';
  if (line.startsWith('→')) return 'text-sky-300 font-medium';
  return 'text-zinc-300';
}

/**
 * Live log of a server job over Server-Sent Events.
 *
 * Mount with `key={jobId}` so each job starts with an empty log. The browser
 * reconnects automatically if the connection drops, resuming after the last
 * line it received.
 *
 * @param props - See {@link JobLogProps}
 */
export function JobLog({ serverId, jobId, onEnd }: JobLogProps): React.ReactNode {
  const [lines, setLines] = useState<string[]>([]);
  const [end, setEnd] = useState<{ status: JobStatus; error: string | null } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const notifyEnd = useEffectEvent((status: JobStatus) => {
    onEnd?.(status);
  });

  useEffect(() => {
    const source = new EventSource(serversApi.streamUrl(serverId, jobId));
    source.onmessage = (message: MessageEvent<string>) => {
      let event: ServerJobEvent;
      try {
        event = JSON.parse(message.data) as ServerJobEvent;
      } catch {
        return;
      }
      if (event.type === 'line') {
        setLines((previous) => [...previous, event.line]);
      } else {
        setEnd({ status: event.status, error: event.error });
        source.close();
        notifyEnd(event.status);
      }
    };
    return () => {
      source.close();
    };
  }, [serverId, jobId]);

  // Keep the newest line in view while the job runs.
  useEffect(() => {
    if (box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [lines.length]);

  return (
    <div className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950">
      <div
        ref={box}
        className="max-h-96 min-h-32 overflow-y-auto p-4 font-mono text-xs leading-relaxed"
        role="log"
        aria-live="polite"
      >
        {lines.length === 0 && !end ? (
          <p className="text-zinc-500">Waiting for the worker…</p>
        ) : null}
        {lines.map((line, index) => (
          <div key={index} className={cn('break-all whitespace-pre-wrap', lineClass(line))}>
            {line}
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2 border-t border-zinc-800 px-4 py-2 text-xs text-zinc-400">
        {end === null ? (
          <>
            <Loader2 className="size-3.5 animate-spin" /> Running…
          </>
        ) : end.status === 'succeeded' ? (
          <>
            <CircleCheck className="size-3.5 text-emerald-400" /> Finished
          </>
        ) : (
          <>
            <CircleX className="size-3.5 text-red-400" /> Failed{end.error ? `: ${end.error}` : ''}
          </>
        )}
      </div>
    </div>
  );
}
