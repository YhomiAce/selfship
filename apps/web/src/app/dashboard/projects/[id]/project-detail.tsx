'use client';

import { ArrowLeft, ExternalLink, GitBranch, Globe, Loader2, Rocket, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  ACTIVE_DEPLOYMENT_STATUSES,
  ADAPTER_LABELS,
  type DeploymentDto,
  type ProjectDto,
} from '@selfship/shared';
import { FormAlert } from '@/components/auth/form-alert';
import { DeployTargetCard } from '@/components/deployments/deploy-target-card';
import { DeploymentStatusBadge } from '@/components/deployments/deployment-status-badge';
import { DeploymentsList } from '@/components/deployments/deployments-list';
import { DomainsCard } from '@/components/domains/domains-card';
import { EnvVarsCard } from '@/components/env-vars/env-vars-card';
import { GithubStateBadge } from '@/components/projects/github-state-badge';
import { ProjectForm } from '@/components/projects/project-form';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiRequestError } from '@/lib/api-client';
import { deploymentsApi } from '@/lib/deployments-api';
import { githubApi } from '@/lib/github-api';
import { projectsApi } from '@/lib/projects-api';

/**
 * Project overview: live URL, deploy button, where it deploys, deployments,
 * environment variables, build settings and deletion.
 */
export function ProjectDetail(): React.ReactNode {
  const params = useParams<{ id: string }>();
  const projectId = typeof params.id === 'string' ? params.id : '';
  const router = useRouter();
  const [project, setProject] = useState<ProjectDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deployments, setDeployments] = useState<DeploymentDto[]>([]);
  const [isDeploying, setIsDeploying] = useState(false);

  /** Loads the project and its deployments. */
  const load = useCallback(
    (): Promise<void> =>
      Promise.all([projectsApi.get(projectId), deploymentsApi.list(projectId)]).then(
        ([loaded, list]) => {
          setProject(loaded);
          setDeployments(list);
        },
        (caught: unknown) => {
          setError(
            caught instanceof ApiRequestError && caught.status === 404
              ? "This project doesn't exist or you don't have access to it."
              : 'Could not load the project.',
          );
        },
      ),
    [projectId],
  );

  useEffect(() => {
    if (projectId) void load();
  }, [projectId, load]);

  // While a deployment runs, refresh every few seconds so status stays current.
  const active = project?.latestDeployment
    ? ACTIVE_DEPLOYMENT_STATUSES.includes(project.latestDeployment.status)
    : false;
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => void load(), 4000);
    return () => {
      clearInterval(timer);
    };
  }, [active, load]);

  const deploy = async (): Promise<void> => {
    if (!project) return;
    setIsDeploying(true);
    try {
      const deployment = await deploymentsApi.create(project.id);
      router.push(`/dashboard/projects/${project.id}/deployments/${deployment.id}`);
    } catch (caught) {
      toast.error(
        caught instanceof ApiRequestError ? caught.message : 'Could not start the deployment.',
      );
      setIsDeploying(false);
    }
  };

  const remove = async (): Promise<void> => {
    if (!project) return;
    setIsDeleting(true);
    try {
      await projectsApi.remove(project.id);
      toast.success('Project deleted');
      router.replace('/dashboard');
    } catch (caught) {
      toast.error(
        caught instanceof ApiRequestError ? caught.message : 'Could not delete the project.',
      );
      setIsDeleting(false);
    }
  };

  if (error) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <FormAlert message={error} />
        <Link href="/dashboard" className="text-sm font-medium hover:underline">
          Back to projects
        </Link>
      </div>
    );
  }
  if (!project) return <Skeleton className="mx-auto h-96 w-full max-w-3xl" />;

  const githubAvailable = project.github.state === 'connected';
  const latest = project.latestDeployment;
  const live = project.liveDeployment;
  const deployBlocked = !githubAvailable
    ? 'Reconnect GitHub first'
    : !project.server
      ? 'Choose a server below first'
      : project.server.status !== 'ready'
        ? `${project.server.name} isn't ready yet`
        : active
          ? 'A deployment is in progress'
          : null;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div>
        <Link
          href="/dashboard"
          className="text-muted-foreground mb-2 inline-flex items-center gap-1 text-sm hover:underline"
        >
          <ArrowLeft className="size-3.5" />
          Projects
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
              <span className="truncate">{project.name}</span>
              <GithubStateBadge state={project.github.state} />
            </h1>
            <p className="text-muted-foreground flex flex-wrap items-center gap-x-3 text-sm">
              <a
                href={`https://github.com/${project.repoFullName}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 hover:underline"
              >
                {project.repoFullName}
                <ExternalLink className="size-3" />
              </a>
              <span className="inline-flex items-center gap-1">
                <GitBranch className="size-3.5" />
                {project.branch}
              </span>
              <span>{ADAPTER_LABELS[project.settings.adapter].split(' (')[0]}</span>
            </p>
          </div>
          <Button
            disabled={deployBlocked !== null || isDeploying}
            title={deployBlocked ?? undefined}
            onClick={() => void deploy()}
          >
            {isDeploying ? <Loader2 className="animate-spin" /> : <Rocket />}
            Deploy
          </Button>
        </div>
      </div>

      {live && project.url ? (
        <a
          href={project.url}
          target="_blank"
          rel="noreferrer"
          className="hover:bg-muted/40 flex items-center gap-3 rounded-xl border p-4"
        >
          <Globe className="size-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium">
              {project.url.replace(/^https:\/\//, '')}
            </span>
            <span className="text-muted-foreground block truncate text-sm">
              {live.commit.sha.slice(0, 7)} · {live.commit.message} · on{' '}
              {live.server?.name ?? 'a removed server'}
            </span>
          </span>
          <ExternalLink className="text-muted-foreground size-4" />
        </a>
      ) : null}

      {latest && latest.id !== live?.id ? (
        <Link
          href={`/dashboard/projects/${project.id}/deployments/${latest.id}`}
          className="hover:bg-muted/40 flex items-center gap-3 rounded-xl border p-4 text-sm"
        >
          <DeploymentStatusBadge status={latest.status} />
          <span className="min-w-0 flex-1 truncate">
            {active ? 'Deploying' : 'Last deployment'} {latest.commit.sha.slice(0, 7)}:{' '}
            {latest.commit.message}
          </span>
          <span className="font-medium">View log</span>
        </Link>
      ) : null}

      {!githubAvailable ? (
        <div className="flex flex-col gap-3">
          <FormAlert
            message={
              project.github.state === 'removed'
                ? `The Selfship app was uninstalled from ${project.github.accountLogin}. Reconnect it to deploy this project again.`
                : `The Selfship app is suspended on ${project.github.accountLogin}. Unsuspend it on GitHub to continue.`
            }
          />
          {project.github.state === 'removed' ? (
            <a
              href={githubApi.connectUrl}
              className={buttonVariants({ variant: 'outline', className: 'self-start' })}
            >
              Reconnect GitHub
            </a>
          ) : null}
        </div>
      ) : null}

      <DeployTargetCard
        project={project}
        onSaved={(updated) => {
          setProject(updated);
        }}
      />

      <DomainsCard projectId={project.id} hasServer={project.server !== null} />

      <Card>
        <CardHeader>
          <CardTitle>Deployments</CardTitle>
        </CardHeader>
        <CardContent>
          <DeploymentsList projectId={project.id} deployments={deployments} canDeploy={!active} />
        </CardContent>
      </Card>

      <EnvVarsCard projectId={project.id} />

      <Card>
        <CardHeader>
          <CardTitle>Build settings</CardTitle>
          <CardDescription>How Selfship builds and runs this project.</CardDescription>
        </CardHeader>
        <CardContent>
          <ProjectForm
            key={project.updatedAt}
            mode="edit"
            githubAvailable={githubAvailable}
            installationId={project.github.installationId}
            repoFullName={project.repoFullName}
            initial={{
              name: project.name,
              branch: project.branch,
              rootDirectory: project.rootDirectory,
              settings: project.settings,
            }}
            submitLabel="Save changes"
            onSubmit={async (values) => {
              const updated = await projectsApi.update(project.id, {
                name: values.name,
                ...(githubAvailable
                  ? { branch: values.branch, rootDirectory: values.rootDirectory }
                  : {}),
                settings: values.settings,
              });
              setProject(updated);
              toast.success('Settings saved');
            }}
          />
        </CardContent>
      </Card>

      <Card className="ring-destructive/30">
        <CardHeader>
          <CardTitle>Delete project</CardTitle>
          <CardDescription>
            Removes the project from Selfship and stops its app on the server. Your repository on
            GitHub is not touched.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AlertDialog>
            <AlertDialogTrigger render={<Button variant="destructive" />}>
              <Trash2 />
              Delete project
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete {project.name}?</AlertDialogTitle>
                <AlertDialogDescription>
                  This can&apos;t be undone. The app is stopped and removed from its server (with
                  its images and files); your GitHub repository stays as it is.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  disabled={isDeleting}
                  onClick={() => void remove()}
                >
                  {isDeleting ? 'Deleting…' : 'Delete'}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardContent>
      </Card>
    </div>
  );
}
