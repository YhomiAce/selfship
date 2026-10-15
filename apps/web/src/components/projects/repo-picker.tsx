'use client';

import { Lock, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { GithubRepositoryDto } from '@selfship/shared';
import { FormAlert } from '@/components/auth/form-alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiRequestError } from '@/lib/api-client';
import { githubApi } from '@/lib/github-api';
import { useDebouncedValue } from '@/lib/use-debounced-value';

const PAGE_SIZE = 10;

/**
 * Formats an ISO date as "3 days ago" style text.
 *
 * @param iso - ISO 8601 timestamp
 * @returns Relative time, or null for missing/invalid dates
 */
export function timeAgo(iso: string | null, now: number = Date.now()): string | null {
  if (!iso) return null;
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return null;
  const minutes = Math.max(0, Math.round((now - then) / 60_000));
  if (minutes < 60) return minutes <= 1 ? 'just now' : `${minutes} minutes ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return hours === 1 ? '1 hour ago' : `${hours} hours ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

/** Props for {@link RepoPicker}. */
export interface RepoPickerProps {
  installationId: string;
  onSelect: (repo: GithubRepositoryDto) => void;
}

/**
 * Searchable, paginated list of repositories for one GitHub account.
 *
 * @param props - See {@link RepoPickerProps}
 */
export function RepoPicker({ installationId, onSelect }: RepoPickerProps): React.ReactNode {
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search.trim(), 300);
  const [repos, setRepos] = useState<GithubRepositoryDto[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Reset to page 1 when the account or search changes.
  const [lastQuery, setLastQuery] = useState({ installationId, debouncedSearch });
  if (
    lastQuery.installationId !== installationId ||
    lastQuery.debouncedSearch !== debouncedSearch
  ) {
    setLastQuery({ installationId, debouncedSearch });
    setPage(1);
    setRepos([]);
    setIsLoading(true);
  }

  useEffect(() => {
    let cancelled = false;
    githubApi
      .repositories(installationId, { search: debouncedSearch, page, pageSize: PAGE_SIZE })
      .then((result) => {
        if (cancelled) return;
        setRepos((previous) => (page === 1 ? result.items : [...previous, ...result.items]));
        setTotal(result.total);
        setError(null);
      })
      .catch((caught: unknown) => {
        if (!cancelled)
          setError(
            caught instanceof ApiRequestError ? caught.message : 'Could not load repositories.',
          );
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [installationId, debouncedSearch, page]);

  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
        <Input
          aria-label="Search repositories"
          placeholder="Search repositories…"
          className="pl-8"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>

      <FormAlert message={error} />

      <ul className="divide-y rounded-lg border">
        {repos.map((repo) => (
          <li key={repo.id} className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 font-medium">
                <span className="truncate">{repo.fullName}</span>
                {repo.private ? (
                  <Lock className="text-muted-foreground size-3.5 shrink-0" aria-label="Private" />
                ) : null}
              </div>
              <div className="text-muted-foreground text-xs">
                {repo.defaultBranch}
                {timeAgo(repo.pushedAt) ? ` · pushed ${timeAgo(repo.pushedAt) ?? ''}` : ''}
              </div>
            </div>
            <Button size="sm" onClick={() => onSelect(repo)}>
              Import
            </Button>
          </li>
        ))}
        {isLoading
          ? Array.from({ length: 3 }, (_, index) => (
              <li key={`skeleton-${String(index)}`} className="px-4 py-3">
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="mt-2 h-3 w-1/4" />
              </li>
            ))
          : null}
        {!isLoading && repos.length === 0 && !error ? (
          <li className="text-muted-foreground px-4 py-8 text-center text-sm">
            {debouncedSearch
              ? `No repositories match "${debouncedSearch}".`
              : 'No repositories yet. Give the app access to a repository on GitHub.'}
          </li>
        ) : null}
      </ul>

      {!isLoading && repos.length < total ? (
        <Button
          variant="outline"
          onClick={() => {
            setIsLoading(true);
            setPage((current) => current + 1);
          }}
        >
          Load more ({total - repos.length} remaining)
        </Button>
      ) : null}
    </div>
  );
}
