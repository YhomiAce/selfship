'use client';

import {
  Loader2,
  RotateCw,
  Sparkles,
  Stethoscope,
  ThumbsDown,
  ThumbsUp,
  Wand2,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { DIAGNOSIS_CATEGORY_LABELS, type DiagnosisResponse } from '@selfship/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ApiRequestError } from '@/lib/api-client';
import { buildDoctorApi } from '@/lib/build-doctor-api';
import { cn } from '@/lib/utils';

/** How often a pending diagnosis is checked. */
const POLL_MS = 3_000;

/** Colours lines of a unified diff (rendered as text, never as HTML). */
function diffLineClass(line: string): string {
  if (line.startsWith('+') && !line.startsWith('+++')) return 'bg-emerald-950/60 text-emerald-300';
  if (line.startsWith('-') && !line.startsWith('---')) return 'bg-red-950/60 text-red-300';
  if (line.startsWith('@@')) return 'text-sky-300';
  return 'text-zinc-300';
}

/**
 * Build Doctor's diagnosis of a failed deployment: what broke, why, how to
 * fix it, a suggested patch, an "Apply fix" button for settings changes, and
 * 👍/👎 feedback.
 *
 * @param props.projectId - Project ID
 * @param props.deploymentId - Failed deployment
 * @param props.onRedeploy - Starts a new deployment (after applying a fix)
 */
export function BuildDoctorPanel({
  projectId,
  deploymentId,
  onRedeploy,
}: {
  projectId: string;
  deploymentId: string;
  onRedeploy: () => void;
}): React.ReactNode {
  const [state, setState] = useState<DiagnosisResponse | null>(null);
  const [busy, setBusy] = useState<'request' | 'apply' | 'feedback' | null>(null);
  const [applied, setApplied] = useState<string | null>(null);

  const load = useCallback(
    (): Promise<void> =>
      buildDoctorApi.get(projectId, deploymentId).then(setState, () => {
        setState({ available: false, diagnosis: null });
      }),
    [projectId, deploymentId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const pending = state?.diagnosis?.status === 'pending';
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => void load(), POLL_MS);
    return () => {
      clearInterval(timer);
    };
  }, [pending, load]);

  const run = async (kind: 'request' | 'apply' | 'up' | 'down'): Promise<void> => {
    setBusy(kind === 'up' || kind === 'down' ? 'feedback' : kind);
    try {
      if (kind === 'request') setState(await buildDoctorApi.request(projectId, deploymentId));
      else if (kind === 'apply') {
        const result = await buildDoctorApi.apply(projectId, deploymentId);
        setApplied(result.applied);
        toast.success(`${result.applied}. Deploy again to try it.`);
      } else {
        const diagnosis = await buildDoctorApi.feedback(projectId, deploymentId, {
          helpful: kind === 'up',
        });
        setState((current) => (current ? { ...current, diagnosis } : current));
        toast.success('Thanks for the feedback');
      }
    } catch (error) {
      toast.error(error instanceof ApiRequestError ? error.message : 'Something went wrong.');
    } finally {
      setBusy(null);
    }
  };

  if (!state?.available) return null;
  const diagnosis = state.diagnosis;
  const result = diagnosis?.result ?? null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <Stethoscope className="size-4" />
          Build Doctor
          {result ? (
            <span className="bg-muted text-muted-foreground rounded-md px-1.5 py-0.5 text-xs font-normal">
              {DIAGNOSIS_CATEGORY_LABELS[result.category]} · {result.confidence} confidence
              {diagnosis?.cached ? ' · seen before' : ''}
            </span>
          ) : null}
        </CardTitle>
        <CardDescription>
          AI explanation of this failure. Redacted logs and config files are sent to Anthropic for
          analysis; secret values never are.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {!diagnosis ? (
          <Button
            className="self-start"
            disabled={busy !== null}
            onClick={() => void run('request')}
          >
            {busy === 'request' ? <Loader2 className="animate-spin" /> : <Sparkles />}
            Ask Build Doctor
          </Button>
        ) : diagnosis.status === 'pending' ? (
          <p className="text-muted-foreground flex items-center gap-2 text-sm">
            <Loader2 className="size-4 animate-spin" /> Reading the log and your project…
          </p>
        ) : diagnosis.status !== 'ready' || !result ? (
          <div className="flex flex-col gap-2">
            <p className="text-muted-foreground text-sm">
              {diagnosis.error ?? 'No diagnosis available.'}
            </p>
            {diagnosis.status === 'failed' ? (
              <Button
                variant="outline"
                className="self-start"
                disabled={busy !== null}
                onClick={() => void run('request')}
              >
                <RotateCw />
                Try again
              </Button>
            ) : null}
          </div>
        ) : (
          <>
            <div>
              <p className="font-medium">{result.summary}</p>
              <p className="text-muted-foreground mt-1 text-sm">{result.rootCause}</p>
            </div>
            {diagnosis.autoRemediation ? (
              <p className="rounded-lg border border-emerald-500/40 bg-emerald-50 p-3 text-sm text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
                Selfship already fixed this on the server: {diagnosis.autoRemediation}
              </p>
            ) : null}
            {result.evidence.length > 0 ? (
              <div className="flex flex-col gap-1">
                <p className="text-sm font-medium">From the log</p>
                <pre className="overflow-x-auto rounded-lg bg-zinc-950 p-3 font-mono text-xs whitespace-pre-wrap text-zinc-300">
                  {result.evidence.join('\n')}
                </pre>
              </div>
            ) : null}
            {result.fixSteps.length > 0 ? (
              <div className="flex flex-col gap-1">
                <p className="text-sm font-medium">How to fix it</p>
                <ol className="list-decimal space-y-1 pl-5 text-sm">
                  {result.fixSteps.map((step, index) => (
                    <li key={index}>{step}</li>
                  ))}
                </ol>
              </div>
            ) : null}
            {result.suggestedPatch ? (
              <div className="flex flex-col gap-1">
                <p className="text-sm font-medium">
                  Suggested change to{' '}
                  <span className="font-mono">{result.suggestedPatch.filePath}</span>
                </p>
                <pre className="overflow-x-auto rounded-lg bg-zinc-950 py-2 font-mono text-xs">
                  {result.suggestedPatch.diff.split('\n').map((line, index) => (
                    <div key={index} className={cn('px-3', diffLineClass(line))}>
                      {line || ' '}
                    </div>
                  ))}
                </pre>
              </div>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              {diagnosis.canApply && !applied ? (
                <Button disabled={busy !== null} onClick={() => void run('apply')}>
                  {busy === 'apply' ? <Loader2 className="animate-spin" /> : <Wand2 />}
                  Apply fix
                </Button>
              ) : null}
              {applied ? (
                <Button onClick={onRedeploy}>
                  <RotateCw />
                  Deploy again
                </Button>
              ) : null}
              <span className="text-muted-foreground ml-auto text-xs">Was this helpful?</span>
              <Button
                size="icon-sm"
                variant={diagnosis.feedback === 'up' ? 'secondary' : 'ghost'}
                aria-label="Helpful"
                disabled={busy !== null}
                onClick={() => void run('up')}
              >
                <ThumbsUp />
              </Button>
              <Button
                size="icon-sm"
                variant={diagnosis.feedback === 'down' ? 'secondary' : 'ghost'}
                aria-label="Not helpful"
                disabled={busy !== null}
                onClick={() => void run('down')}
              >
                <ThumbsDown />
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
