'use client';

import { ArrowLeft, ExternalLink, GitBranch, Rocket, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ADAPTER_LABELS, type ProjectDto } from '@selfship/shared';
import { FormAlert } from '@/components/auth/form-alert';
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
import { githubApi } from '@/lib/github-api';
import { projectsApi } from '@/lib/projects-api';

/** Project overview: source, build settings (editable) and deletion. */
export function ProjectDetail(): React.ReactNode {
  const params = useParams<{ id: string }>();
  const projectId = typeof params.id === 'string' ? params.id : '';
  const router = useRouter();
  const [project, setProject] = useState<ProjectDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    if (!projectId) return;
    projectsApi
      .get(projectId)
      .then(setProject)
      .catch((caught: unknown) => {
        setError(
          caught instanceof ApiRequestError && caught.status === 404
            ? "This project doesn't exist or you don't have access to it."
            : 'Could not load the project.',
        );
      });
  }, [projectId]);

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
          <Button disabled title="Deployments arrive with server support">
            <Rocket />
            Deploy
          </Button>
        </div>
      </div>

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
              href={githubApi.installUrl}
              className={buttonVariants({ variant: 'outline', className: 'self-start' })}
            >
              Reconnect GitHub
            </a>
          ) : null}
        </div>
      ) : null}

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
            Removes the project from Selfship. Your repository on GitHub is not touched.
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
                  This can&apos;t be undone. Your GitHub repository stays as it is.
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
