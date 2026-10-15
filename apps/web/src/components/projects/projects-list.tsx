'use client';

import { FolderGit2, GitBranch, Plus } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ADAPTER_LABELS, type ProjectDto } from '@selfship/shared';
import { FormAlert } from '@/components/auth/form-alert';
import { EmptyState } from '@/components/dashboard/empty-state';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiRequestError } from '@/lib/api-client';
import { projectsApi } from '@/lib/projects-api';
import { GithubStateBadge } from './github-state-badge';

/** Grid of the user's projects with a "New project" button. */
export function ProjectsList(): React.ReactNode {
  const [projects, setProjects] = useState<ProjectDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    projectsApi
      .list()
      .then(setProjects)
      .catch((caught: unknown) => {
        setError(caught instanceof ApiRequestError ? caught.message : 'Could not load projects.');
        setProjects([]);
      });
  }, []);

  const newProjectLink = (
    <Link href="/dashboard/projects/new" className={buttonVariants()}>
      <Plus />
      New project
    </Link>
  );

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
          <p className="text-muted-foreground text-sm">Apps you deploy from GitHub.</p>
        </div>
        {projects && projects.length > 0 ? newProjectLink : null}
      </div>

      <FormAlert message={error} />

      {projects === null ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
        </div>
      ) : projects.length === 0 ? (
        <EmptyState
          icon={FolderGit2}
          title="No projects yet"
          description="Import a repository from GitHub. We detect the framework and suggest build settings for you."
          action={newProjectLink}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {projects.map((project) => (
            <Link key={project.id} href={`/dashboard/projects/${project.id}`} className="group">
              <Card className="group-hover:ring-foreground/20 h-full transition-shadow">
                <CardHeader>
                  <CardTitle className="flex items-center justify-between gap-2">
                    <span className="truncate">{project.name}</span>
                    <GithubStateBadge state={project.github.state} />
                  </CardTitle>
                  <CardDescription className="truncate">{project.repoFullName}</CardDescription>
                </CardHeader>
                <CardContent className="text-muted-foreground flex items-center gap-4 text-sm">
                  <span className="flex items-center gap-1">
                    <GitBranch className="size-3.5" />
                    {project.branch}
                  </span>
                  <span className="truncate">
                    {ADAPTER_LABELS[project.settings.adapter].split(' (')[0]}
                  </span>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
