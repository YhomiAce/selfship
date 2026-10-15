'use client';

import { ArrowLeft, ExternalLink, Plus } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  GithubSetupResult,
  type GithubInstallationDto,
  type GithubRepositoryDto,
} from '@selfship/shared';
import { FormAlert } from '@/components/auth/form-alert';
import { ProjectForm } from '@/components/projects/project-form';
import { RepoPicker } from '@/components/projects/repo-picker';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldLabel } from '@/components/ui/field';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiRequestError } from '@/lib/api-client';
import { githubApi } from '@/lib/github-api';
import { suggestProjectName } from '@/lib/projects/project-form';
import { projectsApi } from '@/lib/projects-api';

/** Messages for `?github=error&reason=…` after returning from GitHub. */
const SETUP_ERRORS: Record<string, string> = {
  not_yours: "GitHub didn't confirm you have access to that installation, so it wasn't connected.",
  missing_code:
    'The GitHub App must have "Request user authorization (OAuth) during installation" enabled. See docs/guides/github-app-setup.md.',
  state: 'The connection request expired or was tampered with. Please try again.',
  github: "We couldn't reach GitHub to finish connecting. Please try again.",
  not_configured: 'GitHub integration is not configured on this server.',
  missing_installation: 'GitHub did not send an installation. Please try again.',
  no_installations:
    "The Selfship app isn't installed on any GitHub account you can access yet. Click Connect GitHub to install it.",
};

type LoadState =
  | { status: 'loading' }
  | { status: 'not-configured' }
  | { status: 'error'; message: string }
  | { status: 'ready'; installations: GithubInstallationDto[] };

/**
 * New project flow: connect/pick a GitHub account → pick a repository →
 * review detected settings → create.
 */
export function NewProjectWizard(): React.ReactNode {
  const router = useRouter();
  const params = useSearchParams();
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [installationId, setInstallationId] = useState<string>('');
  const [repo, setRepo] = useState<GithubRepositoryDto | null>(null);

  // Show the outcome of the GitHub round trip once.
  const notified = useRef(false);
  useEffect(() => {
    if (notified.current) return;
    const result = params.get('github');
    if (!result) return;
    notified.current = true;
    if (result === GithubSetupResult.CONNECTED) toast.success('GitHub connected');
    else if (result === GithubSetupResult.PENDING) {
      toast.info('Installation requested', {
        description: 'An organization owner needs to approve it on GitHub. Then come back here.',
      });
    } else {
      const reason = params.get('reason') ?? '';
      toast.error('GitHub was not connected', {
        description: Object.hasOwn(SETUP_ERRORS, reason) ? SETUP_ERRORS[reason] : undefined,
      });
    }
    router.replace('/dashboard/projects/new');
  }, [params, router]);

  useEffect(() => {
    let cancelled = false;
    (async (): Promise<void> => {
      const status = await githubApi.status();
      if (!status.configured) {
        if (!cancelled) setState({ status: 'not-configured' });
        return;
      }
      const { items } = await githubApi.installations();
      if (cancelled) return;
      setState({ status: 'ready', installations: items });
      setInstallationId((current) => current || (items[0]?.id ?? ''));
    })().catch((error: unknown) => {
      if (!cancelled) {
        setState({
          status: 'error',
          message:
            error instanceof ApiRequestError ? error.message : 'Could not load GitHub accounts.',
        });
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const installation =
    state.status === 'ready'
      ? state.installations.find((item) => item.id === installationId)
      : undefined;

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
        <h1 className="text-2xl font-semibold tracking-tight">New project</h1>
        <p className="text-muted-foreground text-sm">Import a repository from GitHub.</p>
      </div>

      {state.status === 'loading' ? <Skeleton className="h-64" /> : null}
      {state.status === 'error' ? <FormAlert message={state.message} /> : null}
      {state.status === 'not-configured' ? (
        <Card>
          <CardHeader>
            <CardTitle>GitHub isn&apos;t set up yet</CardTitle>
            <CardDescription>
              This Selfship server has no GitHub App configured, so repositories can&apos;t be
              imported. The administrator can follow <code>docs/guides/github-app-setup.md</code> to
              set it up.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      {state.status === 'ready' && state.installations.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Connect GitHub</CardTitle>
            <CardDescription>
              Install the Selfship GitHub App on your account or organization and choose which
              repositories it can see. You can change this any time on GitHub.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-4">
            <a href={githubApi.installUrl} className={buttonVariants({ size: 'lg' })}>
              Connect GitHub
            </a>
            <a href={githubApi.linkUrl} className="text-muted-foreground text-sm hover:underline">
              Already installed the app on GitHub? Link it
            </a>
          </CardContent>
        </Card>
      ) : null}

      {state.status === 'ready' && state.installations.length > 0 && !repo ? (
        <Card>
          <CardHeader>
            <CardTitle>Import a repository</CardTitle>
            <CardDescription>Pick the repository you want to deploy.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-wrap items-end gap-3">
              <Field className="min-w-48 flex-1">
                <FieldLabel htmlFor="account">GitHub account</FieldLabel>
                <NativeSelect
                  id="account"
                  value={installationId}
                  onChange={(event) => setInstallationId(event.target.value)}
                >
                  {state.installations.map((item) => (
                    <NativeSelectOption key={item.id} value={item.id}>
                      {item.accountLogin}
                      {item.suspended ? ' (suspended)' : ''}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
              <a href={githubApi.installUrl} className={buttonVariants({ variant: 'outline' })}>
                <Plus />
                Add account
              </a>
            </div>
            {installation ? (
              <>
                {installation.manageUrl ? (
                  <p className="text-muted-foreground text-sm">
                    Missing a repository?{' '}
                    <a
                      href={installation.manageUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-foreground inline-flex items-center gap-1 font-medium hover:underline"
                    >
                      Change repository access on GitHub
                      <ExternalLink className="size-3" />
                    </a>
                  </p>
                ) : null}
                {installation.suspended ? (
                  <FormAlert
                    message={`The Selfship app is suspended on ${installation.accountLogin}. Unsuspend it on GitHub to continue.`}
                  />
                ) : (
                  <RepoPicker installationId={installation.id} onSelect={setRepo} />
                )}
              </>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {repo && installation ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center justify-between gap-2">
              <span className="truncate">{repo.fullName}</span>
              <Button variant="ghost" size="sm" onClick={() => setRepo(null)}>
                Choose another
              </Button>
            </CardTitle>
            <CardDescription>
              Review the settings. We filled them in from your repository.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ProjectForm
              key={repo.id}
              mode="create"
              installationId={installation.id}
              repoFullName={repo.fullName}
              initial={{
                name: suggestProjectName(repo.name),
                branch: repo.defaultBranch,
                rootDirectory: '',
                settings: null,
              }}
              submitLabel="Create project"
              onSubmit={async (values) => {
                const project = await projectsApi.create({
                  name: values.name,
                  source: {
                    installationId: installation.id,
                    repoFullName: repo.fullName,
                    branch: values.branch,
                    rootDirectory: values.rootDirectory,
                  },
                  settings: values.settings,
                });
                toast.success('Project created', { description: project.name });
                router.push(`/dashboard/projects/${project.id}`);
              }}
            />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
