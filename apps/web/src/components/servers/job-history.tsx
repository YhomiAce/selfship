'use client';

import { ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import type { JobStatus, ServerJobDto } from '@selfship/shared';
import { cn } from '@/lib/utils';
import { JobLog } from './job-log';

const STATUS_CLASS: Record<JobStatus, string> = {
  queued: 'text-muted-foreground',
  running: 'text-sky-600 dark:text-sky-400',
  succeeded: 'text-emerald-600 dark:text-emerald-400',
  failed: 'text-red-600 dark:text-red-400',
};

/**
 * Past checks and setups. Expanding one replays its log.
 *
 * @param props.serverId - Server ID
 * @param props.jobs - Jobs, newest first
 */
export function JobHistory({
  serverId,
  jobs,
}: {
  serverId: string;
  jobs: ServerJobDto[];
}): React.ReactNode {
  const [openId, setOpenId] = useState<string | null>(null);
  if (jobs.length === 0) return <p className="text-muted-foreground text-sm">No checks yet.</p>;
  return (
    <ul className="divide-y rounded-lg border">
      {jobs.map((job) => {
        const open = openId === job.id;
        return (
          <li key={job.id}>
            <button
              type="button"
              aria-expanded={open}
              onClick={() => setOpenId(open ? null : job.id)}
              className="hover:bg-muted/40 flex w-full items-center gap-3 px-3 py-2 text-left text-sm"
            >
              {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
              <span className="w-12 font-medium capitalize">{job.type}</span>
              <span className={cn('w-20 capitalize', STATUS_CLASS[job.status])}>{job.status}</span>
              <span className="text-muted-foreground ml-auto text-xs">
                {new Date(job.createdAt).toLocaleString()}
              </span>
            </button>
            {open ? (
              <div className="px-3 pb-3">
                <JobLog key={job.id} serverId={serverId} jobId={job.id} />
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
