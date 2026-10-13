'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { LoginSchema } from '@selfship/shared';
import { FormAlert } from '@/components/auth/form-alert';
import { GithubButton } from '@/components/auth/github-button';
import { FormField } from '@/components/form-field';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FieldGroup } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { authApi } from '@/lib/auth/auth-api';
import { safeRedirect } from '@/lib/auth/safe-redirect';
import { applyApiErrors } from '@/lib/form-errors';

/** Messages for `?error=` / `?reset=` query parameters set by redirects. */
const NOTICES: Record<string, { tone: 'error' | 'success'; message: string }> = {
  github: { tone: 'error', message: "GitHub sign-in didn't work. Please try again." },
  success: { tone: 'success', message: 'Password updated. Log in with your new password.' },
};

/** Email + password sign-in form. */
export function LoginForm(): React.ReactNode {
  const router = useRouter();
  const params = useSearchParams();
  const [formError, setFormError] = useState<string | null>(null);
  const notice = NOTICES[params.get('error') ?? params.get('reset') ?? ''];

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(LoginSchema), defaultValues: { email: '', password: '' } });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await authApi.login(values);
      router.replace(safeRedirect(params.get('next')));
    } catch (error) {
      setFormError(applyApiErrors(error, setError, ['email', 'password']));
    }
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Welcome back</CardTitle>
        <CardDescription>Log in to manage your deployments.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} noValidate>
          <FieldGroup>
            {notice ? <FormAlert tone={notice.tone} message={notice.message} /> : null}
            <FormAlert message={formError} />
            <GithubButton label="Continue with GitHub" />
            <FormField id="email" label="Email" error={errors.email}>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                aria-invalid={Boolean(errors.email)}
                {...register('email')}
              />
            </FormField>
            <FormField
              id="password"
              label="Password"
              error={errors.password}
              labelAction={
                <Link
                  href="/forgot-password"
                  className="text-muted-foreground text-sm hover:underline"
                >
                  Forgot password?
                </Link>
              }
            >
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                aria-invalid={Boolean(errors.password)}
                {...register('password')}
              />
            </FormField>
            <Button type="submit" size="lg" disabled={isSubmitting}>
              {isSubmitting ? 'Logging in…' : 'Log in'}
            </Button>
            <p className="text-muted-foreground text-center text-sm">
              New here?{' '}
              <Link href="/signup" className="text-foreground font-medium hover:underline">
                Create an account
              </Link>
            </p>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  );
}
