'use client';

import { Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  HealthCheckPathSchema,
  type ProjectDto,
  SERVER_STATUS_LABELS,
  type ServerDto,
} from '@selfship/shared';
import { FormField } from '@/components/form-field';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FieldGroup } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Switch } from '@/components/ui/switch';
import { ApiRequestError } from '@/lib/api-client';
import { projectsApi } from '@/lib/projects-api';
import { serversApi } from '@/lib/servers-api';

/**
 * Where the project deploys to, and how a new version is checked before it
 * gets traffic.
 *
 * @param props.project - Project
 * @param props.onSaved - Called with the updated project
 */
export function DeployTargetCard({
  project,
  onSaved,
}: {
  project: ProjectDto;
  onSaved: (project: ProjectDto) => void;
}): React.ReactNode {
  const [servers, setServers] = useState<ServerDto[] | null>(null);
  const [serverId, setServerId] = useState(project.server?.id ?? '');
  const [path, setPath] = useState(project.healthCheckPath);
  const [pathError, setPathError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [autoDeploy, setAutoDeploy] = useState(project.autoDeploy);

  useEffect(() => {
    serversApi
      .list()
      .then(setServers)
      .catch(() => {
        setServers([]);
      });
  }, []);

  /** Saves the auto-deploy switch right away (no Save button needed). */
  const toggleAutoDeploy = async (enabled: boolean): Promise<void> => {
    setAutoDeploy(enabled);
    try {
      onSaved(await projectsApi.update(project.id, { autoDeploy: enabled }));
      toast.success(enabled ? 'Auto-deploy on' : 'Auto-deploy off');
    } catch (error) {
      setAutoDeploy(!enabled);
      toast.error(error instanceof ApiRequestError ? error.message : 'Could not save.');
    }
  };

  const dirty = serverId !== (project.server?.id ?? '') || path !== project.healthCheckPath;
  const save = async (): Promise<void> => {
    const parsed = HealthCheckPathSchema.safeParse(path);
    if (!parsed.success) {
      setPathError(parsed.error.issues[0]?.message ?? 'Invalid path.');
      return;
    }
    setPathError(null);
    setSaving(true);
    try {
      const updated = await projectsApi.update(project.id, {
        serverId: serverId || null,
        healthCheckPath: parsed.data,
      });
      onSaved(updated);
      toast.success('Saved');
    } catch (error) {
      toast.error(error instanceof ApiRequestError ? error.message : 'Could not save.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Deploy to</CardTitle>
        <CardDescription>
          The server this project runs on. Moving it keeps the old copy running until the first
          deployment on the new server succeeds.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {servers !== null && servers.length === 0 ? (
          <p className="text-sm">
            You haven&apos;t added a server yet.{' '}
            <Link href="/dashboard/servers/new" className="font-medium underline">
              Add a server
            </Link>
          </p>
        ) : (
          <FieldGroup>
            <FormField id="serverId" label="Server">
              <NativeSelect
                id="serverId"
                className="w-full"
                value={serverId}
                disabled={servers === null}
                onChange={(event) => {
                  setServerId(event.target.value);
                }}
              >
                <NativeSelectOption value="">Choose a server…</NativeSelectOption>
                {(servers ?? []).map((server) => (
                  <NativeSelectOption key={server.id} value={server.id}>
                    {server.name} ({server.host})
                    {server.status !== 'ready' ? ` · ${SERVER_STATUS_LABELS[server.status]}` : ''}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </FormField>
            <FormField
              id="healthCheckPath"
              label="Health check path"
              description="Requested before traffic moves to a new version. Any response below 500 counts as up."
              error={pathError ? { message: pathError, type: 'validate' } : undefined}
            >
              <Input
                id="healthCheckPath"
                className="font-mono"
                value={path}
                aria-invalid={Boolean(pathError)}
                onChange={(event) => {
                  setPath(event.target.value);
                }}
              />
            </FormField>
            <label className="flex items-start gap-3 rounded-lg border p-3">
              <Switch
                checked={autoDeploy}
                onCheckedChange={(checked) => void toggleAutoDeploy(checked)}
                aria-label="Deploy on every push"
                className="mt-0.5"
              />
              <span className="text-sm">
                <span className="block font-medium">Deploy on every push to {project.branch}</span>
                <span className="text-muted-foreground block">
                  Add [skip deploy] to a commit message to skip one push.
                </span>
              </span>
            </label>
            <Button className="self-start" disabled={!dirty || saving} onClick={() => void save()}>
              {saving ? <Loader2 className="animate-spin" /> : null}
              Save
            </Button>
          </FieldGroup>
        )}
      </CardContent>
    </Card>
  );
}
