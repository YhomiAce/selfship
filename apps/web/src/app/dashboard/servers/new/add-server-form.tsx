'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft, KeyRound, Loader2, LockKeyhole, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import {
  CreateServerSchema,
  type ServerKeyMethod,
  ServerHostSchema,
  ServerNameSchema,
  SshPortSchema,
  SshUserSchema,
} from '@selfship/shared';
import { FormAlert } from '@/components/auth/form-alert';
import { FormField } from '@/components/form-field';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FieldGroup } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { applyApiErrors } from '@/lib/form-errors';
import { serversApi } from '@/lib/servers-api';
import { cn } from '@/lib/utils';

/**
 * Form shape: all fields present so inputs stay controlled; the real
 * discriminated-union schema validates on submit.
 */
const AddServerFormSchema = z
  .object({
    name: ServerNameSchema,
    host: ServerHostSchema,
    port: SshPortSchema,
    sshUser: SshUserSchema,
    method: z.enum(['generated', 'pasted', 'password']),
    privateKey: z.string(),
    password: z.string(),
  })
  .superRefine((values, ctx) => {
    const result = CreateServerSchema.safeParse(values);
    if (result.success) return;
    for (const issue of result.error.issues) {
      ctx.addIssue({ code: 'custom', path: issue.path, message: issue.message });
    }
  });
type AddServerFormValues = z.infer<typeof AddServerFormSchema>;

const FIELDS = ['name', 'host', 'port', 'sshUser', 'privateKey', 'password'] as const;

/** The three ways to give Selfship access, with the safest first. */
const METHODS: {
  value: ServerKeyMethod;
  title: string;
  description: string;
  icon: typeof KeyRound;
}[] = [
  {
    value: 'generated',
    title: 'Generate a key (recommended)',
    description:
      'We create a key just for this server. You add its public half with one command. Your own keys never leave your computer.',
    icon: Sparkles,
  },
  {
    value: 'pasted',
    title: 'Paste a private key',
    description: 'Use a key that already has access. It is encrypted before it is stored.',
    icon: KeyRound,
  },
  {
    value: 'password',
    title: 'Use a password once',
    description:
      'We log in once to install our own key, then forget the password. Needs password login enabled on the server.',
    icon: LockKeyhole,
  },
];

/** Add-server form: connection details plus how Selfship gets access. */
export function AddServerForm(): React.ReactNode {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    control,
    handleSubmit,
    setValue,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<AddServerFormValues>({
    resolver: zodResolver(AddServerFormSchema),
    defaultValues: {
      name: '',
      host: '',
      port: 22,
      sshUser: 'root',
      method: 'generated',
      privateKey: '',
      password: '',
    },
  });
  const method = useWatch({ control, name: 'method' });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    const input = CreateServerSchema.parse(values);
    try {
      const server = await serversApi.create(input);
      toast.success(
        values.method === 'generated'
          ? 'Server added. Now add our key to it.'
          : 'Server added. Setting it up…',
      );
      router.push(`/dashboard/servers/${server.id}`);
    } catch (error) {
      setFormError(applyApiErrors(error, setError, FIELDS));
    }
  });

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <Link
          href="/dashboard/servers"
          className="text-muted-foreground mb-2 inline-flex items-center gap-1 text-sm hover:underline"
        >
          <ArrowLeft className="size-3.5" />
          Servers
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Add a server</h1>
        <p className="text-muted-foreground text-sm">
          A VPS with Ubuntu 22.04/24.04 or Debian 12/13 and SSH access (root, or a user with
          passwordless sudo).
        </p>
      </div>

      <form onSubmit={onSubmit} noValidate>
        <FieldGroup>
          <FormAlert message={formError} />
          <Card>
            <CardHeader>
              <CardTitle>Connection</CardTitle>
              <CardDescription>Where Selfship connects to.</CardDescription>
            </CardHeader>
            <CardContent>
              <FieldGroup>
                <FormField
                  id="name"
                  label="Name"
                  description="Just for you, e.g. “Hostinger VPS”."
                  error={errors.name}
                >
                  <Input id="name" aria-invalid={Boolean(errors.name)} {...register('name')} />
                </FormField>
                <div className="grid gap-4 sm:grid-cols-[1fr_7rem]">
                  <FormField id="host" label="IP address or hostname" error={errors.host}>
                    <Input
                      id="host"
                      placeholder="203.0.113.10"
                      className="font-mono"
                      aria-invalid={Boolean(errors.host)}
                      {...register('host')}
                    />
                  </FormField>
                  <FormField id="port" label="SSH port" error={errors.port}>
                    <Input
                      id="port"
                      type="number"
                      inputMode="numeric"
                      aria-invalid={Boolean(errors.port)}
                      {...register('port', { valueAsNumber: true })}
                    />
                  </FormField>
                </div>
                <FormField
                  id="sshUser"
                  label="SSH user"
                  description="root, or a user with passwordless sudo (e.g. ubuntu on AWS)."
                  error={errors.sshUser}
                >
                  <Input
                    id="sshUser"
                    className="font-mono"
                    aria-invalid={Boolean(errors.sshUser)}
                    {...register('sshUser')}
                  />
                </FormField>
              </FieldGroup>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Access</CardTitle>
              <CardDescription>How Selfship logs in.</CardDescription>
            </CardHeader>
            <CardContent>
              <FieldGroup>
                <div role="radiogroup" aria-label="Access method" className="grid gap-3">
                  {METHODS.map(({ value, title, description, icon: Icon }) => (
                    <button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={method === value}
                      onClick={() => setValue('method', value, { shouldValidate: false })}
                      className={cn(
                        'flex items-start gap-3 rounded-lg border p-3 text-left transition-colors',
                        method === value ? 'border-foreground bg-muted/60' : 'hover:bg-muted/40',
                      )}
                    >
                      <Icon className="mt-0.5 size-4 shrink-0" />
                      <span>
                        <span className="block text-sm font-medium">{title}</span>
                        <span className="text-muted-foreground block text-sm">{description}</span>
                      </span>
                    </button>
                  ))}
                </div>

                {method === 'pasted' ? (
                  <FormField
                    id="privateKey"
                    label="Private key"
                    description="The whole file, including the BEGIN and END lines."
                    error={errors.privateKey}
                  >
                    <Textarea
                      id="privateKey"
                      rows={6}
                      spellCheck={false}
                      autoComplete="off"
                      className="font-mono text-xs"
                      placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                      aria-invalid={Boolean(errors.privateKey)}
                      {...register('privateKey')}
                    />
                  </FormField>
                ) : null}
                {method === 'password' ? (
                  <FormField
                    id="password"
                    label="Password"
                    description="Used once, then forgotten. Never stored."
                    error={errors.password}
                  >
                    <Input
                      id="password"
                      type="password"
                      autoComplete="off"
                      aria-invalid={Boolean(errors.password)}
                      {...register('password')}
                    />
                  </FormField>
                ) : null}
              </FieldGroup>
            </CardContent>
          </Card>

          <Button type="submit" size="lg" disabled={isSubmitting}>
            {isSubmitting ? <Loader2 className="animate-spin" /> : null}
            {isSubmitting && method === 'password'
              ? 'Logging in to install our key…'
              : 'Add server'}
          </Button>
        </FieldGroup>
      </form>
    </div>
  );
}
