'use client';

import { ClipboardPaste, Eye, EyeOff, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  ENV_SCOPE_LABELS,
  ENV_SCOPES,
  EnvKeySchema,
  type EnvScope,
  type EnvVarDto,
  EnvValueSchema,
  isBuildTimeKey,
  parseDotenv,
} from '@selfship/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { ApiRequestError } from '@/lib/api-client';
import { envApi } from '@/lib/env-api';

/** Shows an API error as a toast. */
function toastError(error: unknown, fallback: string): void {
  toast.error(error instanceof ApiRequestError ? error.message : fallback);
}

/** Scope picker. */
function ScopeSelect({
  id,
  value,
  onChange,
  disabled,
}: {
  id?: string;
  value: EnvScope;
  onChange: (scope: EnvScope) => void;
  disabled?: boolean;
}): React.ReactNode {
  return (
    <NativeSelect
      id={id}
      size="sm"
      value={value}
      disabled={disabled}
      aria-label="When it's available"
      onChange={(event) => {
        onChange(event.target.value as EnvScope);
      }}
    >
      {ENV_SCOPES.map((scope) => (
        <NativeSelectOption key={scope} value={scope}>
          {ENV_SCOPE_LABELS[scope]}
        </NativeSelectOption>
      ))}
    </NativeSelect>
  );
}

/**
 * Environment variables of a project: add one, paste a whole `.env`, reveal,
 * edit, change scope, delete. Values are only fetched when revealed.
 *
 * @param props.projectId - Project ID
 */
export function EnvVarsCard({ projectId }: { projectId: string }): React.ReactNode {
  const [vars, setVars] = useState<EnvVarDto[] | null>(null);
  const [mode, setMode] = useState<'idle' | 'add' | 'paste'>('idle');

  useEffect(() => {
    envApi
      .list(projectId)
      .then(setVars)
      .catch((error: unknown) => {
        toastError(error, 'Could not load environment variables.');
        setVars([]);
      });
  }, [projectId]);

  const save = async (
    input: { key: string; value: string; scope: EnvScope }[],
  ): Promise<boolean> => {
    try {
      setVars(await envApi.upsert(projectId, input));
      toast.success(
        input.length === 1 ? `Saved ${input[0]?.key ?? ''}` : `Saved ${input.length} variables`,
      );
      return true;
    } catch (error) {
      toastError(error, 'Could not save.');
      return false;
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Environment variables</CardTitle>
        <CardDescription>
          Encrypted at rest and hidden in logs. Changes apply to the next deployment.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {vars === null ? (
          <Skeleton className="h-24" />
        ) : vars.length === 0 && mode === 'idle' ? (
          <p className="text-muted-foreground text-sm">No variables yet.</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {vars.map((envVar) => (
              <EnvVarRow
                key={envVar.key}
                projectId={projectId}
                envVar={envVar}
                onSaveValue={(value) => save([{ key: envVar.key, value, scope: envVar.scope }])}
                onChanged={(updated) => {
                  setVars(
                    (list) => list?.map((v) => (v.key === updated.key ? updated : v)) ?? null,
                  );
                }}
                onDeleted={() => {
                  setVars((list) => list?.filter((v) => v.key !== envVar.key) ?? null);
                }}
              />
            ))}
          </ul>
        )}

        {mode === 'add' ? (
          <AddVarForm
            existing={vars ?? []}
            onCancel={() => {
              setMode('idle');
            }}
            onSave={async (input) => {
              if (await save([input])) setMode('idle');
            }}
          />
        ) : null}
        {mode === 'paste' ? (
          <PasteEnvForm
            existing={vars ?? []}
            onCancel={() => {
              setMode('idle');
            }}
            onSave={async (input) => {
              if (await save(input)) setMode('idle');
            }}
          />
        ) : null}
        {mode === 'idle' ? (
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setMode('add');
              }}
            >
              <Plus />
              Add variable
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setMode('paste');
              }}
            >
              <ClipboardPaste />
              Paste .env
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** One variable: name, scope, hidden/revealed value, edit and delete. */
function EnvVarRow({
  projectId,
  envVar,
  onSaveValue,
  onChanged,
  onDeleted,
}: {
  projectId: string;
  envVar: EnvVarDto;
  onSaveValue: (value: string) => Promise<boolean>;
  onChanged: (updated: EnvVarDto) => void;
  onDeleted: () => void;
}): React.ReactNode {
  const [value, setValue] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  const reveal = async (): Promise<string | null> => {
    try {
      const { value: revealed } = await envApi.reveal(projectId, envVar.key);
      setValue(revealed);
      return revealed;
    } catch (error) {
      toastError(error, 'Could not reveal the value.');
      return null;
    }
  };

  return (
    <li className="flex flex-col gap-2 px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-mono text-sm font-medium">{envVar.key}</span>
        <ScopeSelect
          value={envVar.scope}
          disabled={busy}
          onChange={(scope) => {
            setBusy(true);
            envApi
              .updateScope(projectId, envVar.key, scope)
              .then(onChanged)
              .catch((error: unknown) => {
                toastError(error, 'Could not change the scope.');
              })
              .finally(() => {
                setBusy(false);
              });
          }}
        />
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={value === null ? `Reveal ${envVar.key}` : `Hide ${envVar.key}`}
          onClick={() => {
            if (value === null) void reveal();
            else setValue(null);
          }}
        >
          {value === null ? <Eye /> : <EyeOff />}
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={`Edit ${envVar.key}`}
          onClick={() => {
            void (value === null ? reveal() : Promise.resolve(value)).then((current) => {
              if (current !== null) setEditing(current);
            });
          }}
        >
          <Pencil />
        </Button>
        {confirmDelete ? (
          <Button
            size="sm"
            variant="destructive"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              envApi
                .remove(projectId, envVar.key)
                .then(() => {
                  toast.success(`Deleted ${envVar.key}`);
                  onDeleted();
                })
                .catch((error: unknown) => {
                  toastError(error, 'Could not delete.');
                  setBusy(false);
                });
            }}
          >
            Delete?
          </Button>
        ) : (
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={`Delete ${envVar.key}`}
            onClick={() => {
              setConfirmDelete(true);
              setTimeout(() => {
                setConfirmDelete(false);
              }, 4000);
            }}
          >
            <Trash2 />
          </Button>
        )}
      </div>
      {editing !== null ? (
        <div className="flex flex-col gap-2">
          <Textarea
            value={editing}
            rows={Math.min(8, Math.max(2, editing.split('\n').length))}
            spellCheck={false}
            className="font-mono text-xs"
            aria-label={`New value of ${envVar.key}`}
            onChange={(event) => {
              setEditing(event.target.value);
            }}
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void onSaveValue(editing).then((ok) => {
                  setBusy(false);
                  if (ok) {
                    setEditing(null);
                    setValue(null);
                  }
                });
              }}
            >
              {busy ? <Loader2 className="animate-spin" /> : null}
              Save
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setEditing(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : value !== null ? (
        <pre className="bg-muted overflow-x-auto rounded-md px-2 py-1.5 font-mono text-xs break-all whitespace-pre-wrap">
          {value || <span className="text-muted-foreground">(empty)</span>}
        </pre>
      ) : null}
    </li>
  );
}

/** Form for one new variable. */
function AddVarForm({
  existing,
  onSave,
  onCancel,
}: {
  existing: EnvVarDto[];
  onSave: (input: { key: string; value: string; scope: EnvScope }) => Promise<void>;
  onCancel: () => void;
}): React.ReactNode {
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');
  const [scope, setScope] = useState<EnvScope | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const effectiveScope = scope ?? (isBuildTimeKey(key) ? 'build' : 'runtime');
  const replaces = existing.some((v) => v.key === key.trim());

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    const parsedKey = EnvKeySchema.safeParse(key);
    if (!parsedKey.success) {
      setError(parsedKey.error.issues[0]?.message ?? 'Invalid name.');
      return;
    }
    const parsedValue = EnvValueSchema.safeParse(value);
    if (!parsedValue.success) {
      setError(parsedValue.error.issues[0]?.message ?? 'Invalid value.');
      return;
    }
    setError(null);
    setSaving(true);
    await onSave({ key: parsedKey.data, value: parsedValue.data, scope: effectiveScope });
    setSaving(false);
  };

  return (
    <form
      onSubmit={(event) => void submit(event)}
      className="flex flex-col gap-2 rounded-lg border p-3"
    >
      <div className="flex flex-wrap gap-2">
        <Input
          value={key}
          autoFocus
          placeholder="NAME"
          aria-label="Name"
          aria-invalid={Boolean(error)}
          className="min-w-40 flex-1 font-mono"
          onChange={(event) => {
            setKey(event.target.value);
          }}
        />
        <ScopeSelect value={effectiveScope} onChange={setScope} />
      </div>
      <Textarea
        value={value}
        rows={2}
        spellCheck={false}
        placeholder="Value"
        aria-label="Value"
        className="font-mono text-xs"
        onChange={(event) => {
          setValue(event.target.value);
        }}
      />
      {error ? <p className="text-destructive text-sm">{error}</p> : null}
      {isBuildTimeKey(key) && scope === null ? (
        <p className="text-muted-foreground text-xs">
          Names like this are usually built into the browser bundle, so they&apos;re available while
          building. They end up in the page source: don&apos;t put secrets in them.
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={saving}>
          {saving ? <Loader2 className="animate-spin" /> : null}
          {replaces ? 'Replace' : 'Add'}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** Paste a whole `.env` file: preview what will be saved, then save all at once. */
function PasteEnvForm({
  existing,
  onSave,
  onCancel,
}: {
  existing: EnvVarDto[];
  onSave: (input: { key: string; value: string; scope: EnvScope }[]) => Promise<void>;
  onCancel: () => void;
}): React.ReactNode {
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const parsed = useMemo(() => parseDotenv(text), [text]);
  const valid = parsed.entries.filter((entry) => EnvKeySchema.safeParse(entry.key).success);
  const rejected = parsed.entries.filter((entry) => !EnvKeySchema.safeParse(entry.key).success);
  const existingKeys = new Set(existing.map((v) => v.key));

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-3">
      <Textarea
        value={text}
        autoFocus
        rows={8}
        spellCheck={false}
        aria-label=".env contents"
        placeholder={
          '# Paste your .env here\nDATABASE_URL=postgres://…\nNEXT_PUBLIC_API_URL=https://…'
        }
        className="font-mono text-xs"
        onChange={(event) => {
          setText(event.target.value);
        }}
      />
      {text.trim() ? (
        <div className="flex flex-col gap-1 text-sm">
          <p>
            {valid.length} variable{valid.length === 1 ? '' : 's'} found
            {valid.some((e) => existingKeys.has(e.key))
              ? ` (${valid.filter((e) => existingKeys.has(e.key)).length} will replace existing ones)`
              : ''}
            .
          </p>
          {valid.length > 0 ? (
            <p className="text-muted-foreground font-mono text-xs break-all">
              {valid.map((e) => `${e.key}${isBuildTimeKey(e.key) ? ' (build)' : ''}`).join(', ')}
            </p>
          ) : null}
          {parsed.errors.map((error) => (
            <p key={error.line} className="text-destructive text-xs">
              Line {error.line}: {error.message}
            </p>
          ))}
          {rejected.map((entry) => (
            <p key={entry.key} className="text-destructive text-xs">
              Line {entry.line}: {entry.key} is set by Selfship and will be skipped.
            </p>
          ))}
        </div>
      ) : null}
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={saving || valid.length === 0}
          onClick={() => {
            setSaving(true);
            void onSave(
              valid.map((entry) => ({
                key: entry.key,
                value: entry.value,
                scope: isBuildTimeKey(entry.key) ? 'build' : 'runtime',
              })),
            ).finally(() => {
              setSaving(false);
            });
          }}
        >
          {saving ? <Loader2 className="animate-spin" /> : null}
          Save {valid.length || ''} variable{valid.length === 1 ? '' : 's'}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
