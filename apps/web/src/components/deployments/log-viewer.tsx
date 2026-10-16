'use client';

import { ArrowDown, CircleCheck, CircleX, Loader2, Search } from 'lucide-react';
import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import type { DeploymentEvent, DeploymentStage, DeploymentStatus } from '@selfship/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { parseAnsi, stripAnsi } from '@/lib/ansi';
import { deploymentsApi } from '@/lib/deployments-api';
import { cn } from '@/lib/utils';

/** Lines kept in the browser; older ones are dropped (the full log stays on the server). */
const MAX_LINES = 20_000;

/** Props for {@link LogViewer}. */
export interface LogViewerProps {
  projectId: string;
  deploymentId: string;
  /** A new stage started (e.g. to refresh the timeline). */
  onStage?: (stage: DeploymentStage) => void;
  /** The deployment finished. */
  onEnd?: (status: DeploymentStatus) => void;
}

/** Extra colouring for our own status lines (✓ ✗ → ⚠). */
function prefixClass(line: string): string {
  if (line.startsWith('✓')) return 'text-emerald-400';
  if (line.startsWith('✗')) return 'text-red-400';
  if (line.startsWith('→')) return 'text-sky-300 font-medium';
  if (/(^|\s)(ERR!|error|Error:)/.test(line)) return 'text-red-300';
  return 'text-zinc-300';
}

/**
 * Live deployment log over Server-Sent Events: ANSI colours, follows the
 * newest line unless you scroll up, and a search filter. Mount with
 * `key={deploymentId}`. The browser reconnects by itself and resumes after
 * the last line it received.
 *
 * @param props - See {@link LogViewerProps}
 */
export function LogViewer({
  projectId,
  deploymentId,
  onStage,
  onEnd,
}: LogViewerProps): React.ReactNode {
  const [lines, setLines] = useState<string[]>([]);
  const [end, setEnd] = useState<{ status: DeploymentStatus; error: string | null } | null>(null);
  const [query, setQuery] = useState('');
  const [follow, setFollow] = useState(true);
  const box = useRef<HTMLDivElement>(null);
  const notifyStage = useEffectEvent((stage: DeploymentStage) => {
    onStage?.(stage);
  });
  const notifyEnd = useEffectEvent((status: DeploymentStatus) => {
    onEnd?.(status);
  });

  useEffect(() => {
    const source = new EventSource(deploymentsApi.streamUrl(projectId, deploymentId));
    source.onmessage = (message: MessageEvent<string>) => {
      let event: DeploymentEvent;
      try {
        event = JSON.parse(message.data) as DeploymentEvent;
      } catch {
        return;
      }
      if (event.type === 'line') {
        setLines((previous) =>
          previous.length >= MAX_LINES
            ? [...previous.slice(-MAX_LINES + 1), event.line]
            : [...previous, event.line],
        );
      } else if (event.type === 'stage') {
        notifyStage(event.stage);
      } else {
        setEnd({ status: event.status, error: event.error });
        source.close();
        notifyEnd(event.status);
      }
    };
    return () => {
      source.close();
    };
  }, [projectId, deploymentId]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const all = lines.map((line, index) => ({ line, index }));
    return needle ? all.filter(({ line }) => stripAnsi(line).toLowerCase().includes(needle)) : all;
  }, [lines, query]);

  // Keep the newest line in view, unless the user scrolled up to read.
  useEffect(() => {
    if (follow && box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [visible.length, follow]);

  const onScroll = (): void => {
    const el = box.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    if (atBottom !== follow) setFollow(atBottom);
  };

  return (
    <div className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950">
      <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2">
        <Search className="size-3.5 text-zinc-500" />
        <Input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
          }}
          placeholder="Search the log"
          aria-label="Search the log"
          className="h-7 border-zinc-800 bg-transparent text-xs text-zinc-200 placeholder:text-zinc-500"
        />
        {query ? (
          <span className="text-xs whitespace-nowrap text-zinc-400 tabular-nums">
            {visible.length} of {lines.length}
          </span>
        ) : null}
      </div>
      <div className="relative">
        <div
          ref={box}
          onScroll={onScroll}
          className="h-[28rem] overflow-y-auto py-2 font-mono text-xs leading-relaxed"
          role="log"
          aria-live="polite"
        >
          {lines.length === 0 && !end ? (
            <p className="px-4 text-zinc-500">Waiting for the worker…</p>
          ) : null}
          {visible.map(({ line, index }) => (
            <div key={index} className="flex gap-3 px-4 hover:bg-zinc-900">
              <span className="w-10 shrink-0 text-right text-zinc-600 select-none">
                {index + 1}
              </span>
              <span className={cn('break-all whitespace-pre-wrap', prefixClass(stripAnsi(line)))}>
                {parseAnsi(line).map((segment, i) => (
                  <span key={i} className={segment.className || undefined}>
                    {segment.text}
                  </span>
                ))}
              </span>
            </div>
          ))}
        </div>
        {!follow ? (
          <Button
            size="sm"
            variant="secondary"
            className="absolute right-4 bottom-3 shadow"
            onClick={() => {
              setFollow(true);
            }}
          >
            <ArrowDown />
            Latest
          </Button>
        ) : null}
      </div>
      <div className="flex items-start gap-2 border-t border-zinc-800 px-4 py-2 text-xs text-zinc-400">
        {end === null ? (
          <>
            <Loader2 className="mt-0.5 size-3.5 shrink-0 animate-spin" /> Running…
          </>
        ) : end.status === 'live' ? (
          <>
            <CircleCheck className="mt-0.5 size-3.5 shrink-0 text-emerald-400" /> Deployed
          </>
        ) : (
          <>
            <CircleX className="mt-0.5 size-3.5 shrink-0 text-red-400" />
            <span className="whitespace-pre-wrap">
              {end.status === 'cancelled'
                ? 'Cancelled'
                : `Failed${end.error ? `: ${end.error}` : ''}`}
            </span>
          </>
        )}
      </div>
    </div>
  );
}
