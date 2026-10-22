'use client';

import { Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { AUDIT_ACTION_LABELS, type AuditEventDto } from '@selfship/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { auditApi } from '@/lib/audit-api';

/** A short browser description from a user agent ("Chrome on Linux"). */
function browserOf(userAgent: string | null): string | null {
  if (!userAgent) return null;
  const browser = /Edg\//.test(userAgent)
    ? 'Edge'
    : /Chrome\//.test(userAgent)
      ? 'Chrome'
      : /Firefox\//.test(userAgent)
        ? 'Firefox'
        : /Safari\//.test(userAgent)
          ? 'Safari'
          : 'A browser';
  const os = /Windows/.test(userAgent)
    ? 'Windows'
    : /Mac OS X/.test(userAgent)
      ? 'macOS'
      : /Android/.test(userAgent)
        ? 'Android'
        : /iPhone|iPad/.test(userAgent)
          ? 'iOS'
          : /Linux/.test(userAgent)
            ? 'Linux'
            : null;
  return os ? `${browser} on ${os}` : browser;
}

/** Security-relevant activity on the account (audit log), newest first. */
export function ActivityCard(): React.ReactNode {
  const [events, setEvents] = useState<AuditEventDto[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    auditApi.list().then(
      (page) => {
        setEvents(page.items);
        setCursor(page.nextCursor);
      },
      () => {
        setEvents([]);
      },
    );
  }, []);

  const more = async (): Promise<void> => {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const page = await auditApi.list(cursor);
      setEvents((current) => [...(current ?? []), ...page.items]);
      setCursor(page.nextCursor);
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Activity</CardTitle>
        <CardDescription>
          Sign-ins and changes to your servers, secrets and deployments.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {events === null ? (
          <Skeleton className="h-32" />
        ) : events.length === 0 ? (
          <p className="text-muted-foreground text-sm">No activity yet.</p>
        ) : (
          <ul className="divide-y rounded-lg border text-sm">
            {events.map((event) => {
              const details = [
                event.targetName,
                ...Object.entries(event.metadata).map(([key, value]) => `${key}: ${value}`),
              ].filter(Boolean);
              const where = [browserOf(event.userAgent), event.ipAddress]
                .filter(Boolean)
                .join(' · ');
              return (
                <li key={event.id} className="flex flex-col gap-0.5 px-3 py-2">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span
                      className={
                        event.action.endsWith('_failed')
                          ? 'text-destructive font-medium'
                          : 'font-medium'
                      }
                    >
                      {AUDIT_ACTION_LABELS[event.action]}
                    </span>
                    <span className="text-muted-foreground text-xs">
                      {new Date(event.createdAt).toLocaleString()}
                    </span>
                  </div>
                  {details.length > 0 ? (
                    <span className="text-muted-foreground truncate text-xs">
                      {details.join(' · ')}
                    </span>
                  ) : null}
                  {where ? <span className="text-muted-foreground text-xs">{where}</span> : null}
                </li>
              );
            })}
          </ul>
        )}
        {cursor ? (
          <Button
            variant="outline"
            className="self-start"
            disabled={loadingMore}
            onClick={() => void more()}
          >
            {loadingMore ? <Loader2 className="animate-spin" /> : null}
            Load more
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}
