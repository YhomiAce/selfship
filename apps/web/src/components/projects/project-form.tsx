'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2, RefreshCw, Sparkles } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import {
  ADAPTER_LABELS,
  ADAPTER_NAMES,
  type DetectProjectResponse,
  type ProjectSettings,
  SUPPORTED_NODE_VERSIONS,
} from '@selfship/shared';
import { FormAlert } from '@/components/auth/form-alert';
import { FormField } from '@/components/form-field';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { FieldGroup } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { ApiRequestError } from '@/lib/api-client';
import { applyApiErrors } from '@/lib/form-errors';
import { githubApi } from '@/lib/github-api';
import {
  ADAPTER_FIELDS,
  API_FIELD_ALIASES,
  cleanSettings,
  type ProjectFormInput,
  ProjectFormSchema,
  type ProjectFormValues,
} from '@/lib/projects/project-form';
import { projectsApi } from '@/lib/projects-api';
import { useDebouncedValue } from '@/lib/use-debounced-value';

/** Every field the form can show errors on (for mapping API errors). */
const FORM_FIELDS = [
  'name',
  'branch',
  'rootDirectory',
  'settings.adapter',
  'settings.installCommand',
  'settings.buildCommand',
  'settings.startCommand',
  'settings.outputDirectory',
  'settings.port',
  'settings.nodeVersion',
] as const;

/** Props for {@link ProjectForm}. */
export interface ProjectFormProps {
  /** Our GitHub installation ID. */
  installationId: string;
  repoFullName: string;
  /** Initial values (from the repository, or the saved project when editing). */
  initial: {
    name: string;
    branch: string;
    rootDirectory: string;
    settings: ProjectSettings | null;
  };
  /** `create`: detect immediately. `edit`: keep saved settings until asked. */
  mode: 'create' | 'edit';
  /** Disables source fields when GitHub access is gone (edit mode). */
  githubAvailable?: boolean;
  submitLabel: string;
  /**
   * Saves the form. Throw an `ApiRequestError` to show field errors.
   *
   * @param values - Validated values with unused settings cleared
   */
  onSubmit: (values: ProjectFormValues) => Promise<void>;
}

/** Empty settings shown until detection fills them in. */
const PLACEHOLDER_SETTINGS: ProjectSettings = {
  adapter: 'node',
  installCommand: null,
  buildCommand: null,
  startCommand: null,
  outputDirectory: null,
  port: 3000,
  nodeVersion: 22,
};

/**
 * Build settings form shared by the new-project wizard and the settings page.
 *
 * In `create` mode, settings are detected from the repository whenever the
 * branch or root folder changes. The user can change anything afterwards.
 *
 * @param props - See {@link ProjectFormProps}
 */
export function ProjectForm({
  installationId,
  repoFullName,
  initial,
  mode,
  githubAvailable = true,
  submitLabel,
  onSubmit,
}: ProjectFormProps): React.ReactNode {
  const [branches, setBranches] = useState<string[]>([initial.branch]);
  const [detection, setDetection] = useState<DetectProjectResponse | null>(null);
  const [isDetecting, setIsDetecting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm<ProjectFormInput, unknown, ProjectFormValues>({
    resolver: zodResolver(ProjectFormSchema),
    defaultValues: {
      name: initial.name,
      branch: initial.branch,
      rootDirectory: initial.rootDirectory,
      settings: initial.settings ?? PLACEHOLDER_SETTINGS,
    },
  });
  const {
    register,
    control,
    handleSubmit,
    setError,
    clearErrors,
    setValue,
    getValues,
    formState: { errors, isSubmitting },
  } = form;

  const adapter = useWatch({ control, name: 'settings.adapter' });
  const fields = ADAPTER_FIELDS[adapter];
  const branch = useWatch({ control, name: 'branch' });
  const rootDirectory = useDebouncedValue(useWatch({ control, name: 'rootDirectory' }), 600);

  // Load branches once per repository.
  useEffect(() => {
    if (!githubAvailable) return;
    let cancelled = false;
    githubApi
      .branches(installationId, repoFullName)
      .then((result) => {
        if (!cancelled) setBranches(result.items.length > 0 ? result.items : [initial.branch]);
      })
      .catch(() => {
        // Keep the current branch; the API reports access problems on save.
      });
    return () => {
      cancelled = true;
    };
  }, [installationId, repoFullName, initial.branch, githubAvailable]);

  /** Asks the API to detect settings and applies them to the form. */
  const detect = useCallback(
    async (target: { branch: string; rootDirectory: string }): Promise<void> => {
      setIsDetecting(true);
      clearErrors(['rootDirectory', 'branch']);
      try {
        const result = await projectsApi.detect({ installationId, repoFullName, ...target });
        setDetection(result);
        setValue('settings', result.settings, { shouldDirty: true });
      } catch (error) {
        setDetection(null);
        if (error instanceof ApiRequestError && error.body.code === 'ROOT_DIRECTORY_NOT_FOUND') {
          setError('rootDirectory', { type: 'server', message: error.message });
        } else {
          setFormError(
            error instanceof ApiRequestError ? error.message : 'Detection failed. Try again.',
          );
        }
      } finally {
        setIsDetecting(false);
      }
    },
    [installationId, repoFullName, setValue, setError, clearErrors],
  );

  // Create mode: re-detect whenever the branch or (debounced) folder changes.
  const lastDetected = useRef<string | null>(null);
  useEffect(() => {
    if (mode !== 'create' || !githubAvailable) return;
    const key = `${branch}::${rootDirectory}`;
    if (lastDetected.current === key) return;
    lastDetected.current = key;
    void detect({ branch, rootDirectory });
  }, [mode, githubAvailable, branch, rootDirectory, detect]);

  const submit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await onSubmit({ ...values, settings: cleanSettings(values.settings) });
    } catch (error) {
      setFormError(applyApiErrors(error, setError, FORM_FIELDS, API_FIELD_ALIASES));
    }
  });

  return (
    <form onSubmit={submit} noValidate>
      <FieldGroup>
        <FormAlert message={formError} />

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            id="name"
            label="Project name"
            description="Lowercase letters, numbers and dashes. Used in your app's URL."
            error={errors.name}
          >
            <Input id="name" aria-invalid={Boolean(errors.name)} {...register('name')} />
          </FormField>
          <FormField id="branch" label="Branch" error={errors.branch}>
            <NativeSelect
              id="branch"
              disabled={!githubAvailable}
              aria-invalid={Boolean(errors.branch)}
              {...register('branch')}
            >
              {branches.map((name) => (
                <NativeSelectOption key={name} value={name}>
                  {name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </FormField>
        </div>

        <FormField
          id="rootDirectory"
          label="Root directory"
          description="Leave empty unless your app lives in a subfolder (e.g. apps/web in a monorepo)."
          error={errors.rootDirectory}
        >
          <Input
            id="rootDirectory"
            placeholder="/"
            disabled={!githubAvailable}
            aria-invalid={Boolean(errors.rootDirectory)}
            {...register('rootDirectory')}
          />
        </FormField>

        <DetectionNotice
          detection={detection}
          isDetecting={isDetecting}
          canDetect={githubAvailable}
          onRedetect={() => void detect({ branch, rootDirectory: getValues('rootDirectory') })}
        />

        <FormField id="adapter" label="Project type" error={errors.settings?.adapter}>
          <NativeSelect id="adapter" {...register('settings.adapter')}>
            {ADAPTER_NAMES.map((name) => (
              <NativeSelectOption key={name} value={name}>
                {ADAPTER_LABELS[name]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </FormField>

        {fields.install ? (
          <FormField
            id="installCommand"
            label="Install command"
            error={errors.settings?.installCommand}
          >
            <Input
              id="installCommand"
              className="font-mono"
              placeholder="npm ci"
              {...register('settings.installCommand')}
            />
          </FormField>
        ) : null}
        {fields.build ? (
          <FormField
            id="buildCommand"
            label="Build command"
            description="Leave empty if the app has no build step."
            error={errors.settings?.buildCommand}
          >
            <Input
              id="buildCommand"
              className="font-mono"
              placeholder="npm run build"
              {...register('settings.buildCommand')}
            />
          </FormField>
        ) : null}
        {fields.start ? (
          <FormField id="startCommand" label="Start command" error={errors.settings?.startCommand}>
            <Input
              id="startCommand"
              className="font-mono"
              placeholder="npm start"
              {...register('settings.startCommand')}
            />
          </FormField>
        ) : null}
        {fields.output ? (
          <FormField
            id="outputDirectory"
            label={adapter === 'static' ? 'Site folder' : 'Output directory'}
            description={
              adapter === 'static'
                ? 'Folder containing index.html. Leave empty for the root.'
                : 'Folder the build writes to, e.g. dist or build.'
            }
            error={errors.settings?.outputDirectory}
          >
            <Input
              id="outputDirectory"
              className="font-mono"
              {...register('settings.outputDirectory')}
            />
          </FormField>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            id="port"
            label="Port"
            description={
              adapter === 'spa' || adapter === 'static'
                ? 'Served by nginx on port 80.'
                : 'The port your app listens on inside the container.'
            }
            error={errors.settings?.port}
          >
            <Input
              id="port"
              type="number"
              inputMode="numeric"
              readOnly={adapter === 'spa' || adapter === 'static'}
              {...register('settings.port', { valueAsNumber: true })}
            />
          </FormField>
          {fields.node ? (
            <FormField
              id="nodeVersion"
              label="Node.js version"
              error={errors.settings?.nodeVersion}
            >
              <Controller
                control={control}
                name="settings.nodeVersion"
                render={({ field }) => (
                  <NativeSelect
                    id="nodeVersion"
                    value={field.value === null ? '' : String(field.value)}
                    onChange={(event) =>
                      field.onChange(event.target.value ? Number(event.target.value) : null)
                    }
                    onBlur={field.onBlur}
                  >
                    {SUPPORTED_NODE_VERSIONS.map((version) => (
                      <NativeSelectOption key={version} value={String(version)}>
                        Node {version}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                )}
              />
            </FormField>
          ) : null}
        </div>

        <Button type="submit" size="lg" disabled={isSubmitting || isDetecting}>
          {isSubmitting ? <Loader2 className="animate-spin" /> : null}
          {submitLabel}
        </Button>
      </FieldGroup>
    </form>
  );
}

/**
 * Shows what detection found (or that it's running), with a re-detect button.
 *
 * @param props.detection - Last detection result
 * @param props.isDetecting - Whether a detection request is in flight
 * @param props.canDetect - False when GitHub access is unavailable
 * @param props.onRedetect - Runs detection again
 */
function DetectionNotice({
  detection,
  isDetecting,
  canDetect,
  onRedetect,
}: {
  detection: DetectProjectResponse | null;
  isDetecting: boolean;
  canDetect: boolean;
  onRedetect: () => void;
}): React.ReactNode {
  if (!canDetect) return null;
  return (
    <Alert>
      {isDetecting ? <Loader2 className="animate-spin" /> : <Sparkles />}
      <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
        <span>
          {isDetecting
            ? 'Looking at your repository…'
            : detection
              ? detection.adapter
                ? `Detected ${ADAPTER_LABELS[detection.adapter]}. ${detection.reason}.`
                : detection.reason
              : 'We can look at the repository and fill these settings in for you.'}
        </span>
        <Button type="button" variant="ghost" size="sm" onClick={onRedetect} disabled={isDetecting}>
          <RefreshCw />
          {detection ? 'Detect again' : 'Detect settings'}
        </Button>
      </AlertDescription>
    </Alert>
  );
}
