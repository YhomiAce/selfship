'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { PasswordSchema } from '@platform/shared';
import { FormAlert } from '@/components/auth/form-alert';
import { FormField } from '@/components/form-field';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FieldGroup } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { authApi } from '@/lib/auth/auth-api';
import { applyApiErrors } from '@/lib/form-errors';

/** Client-side form: the API rules plus a confirmation field. */
const ResetFormSchema = z
  .object({ password: PasswordSchema, confirmPassword: z.string() })
  .refine((values) => values.password === values.confirmPassword, {
    message: "Passwords don't match.",
    path: ['confirmPassword'],
  });

/** Sets a new password using the token from the reset email. */
export function ResetPasswordForm(): React.ReactNode {
  const router = useRouter();
  const token = useSearchParams().get('token');
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(ResetFormSchema),
    defaultValues: { password: '', confirmPassword: '' },
  });

  const onSubmit = handleSubmit(async ({ password }) => {
    if (!token) return;
    setFormError(null);
    try {
      await authApi.resetPassword({ token, password });
      router.replace('/login?reset=success');
    } catch (error) {
      setFormError(applyApiErrors(error, setError, ['password']));
    }
  });

  if (!token) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">Link is incomplete</CardTitle>
          <CardDescription>
            Open the link from your email again, or request a new one.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link href="/forgot-password" className="text-sm font-medium hover:underline">
            Request a new reset link
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Choose a new password</CardTitle>
        <CardDescription>You&apos;ll be signed out of all devices.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} noValidate>
          <FieldGroup>
            <FormAlert message={formError} />
            {formError ? (
              <Link href="/forgot-password" className="text-sm font-medium hover:underline">
                Request a new reset link
              </Link>
            ) : null}
            <FormField
              id="password"
              label="New password"
              description="At least 10 characters."
              error={errors.password}
            >
              <Input
                id="password"
                type="password"
                autoComplete="new-password"
                aria-invalid={Boolean(errors.password)}
                {...register('password')}
              />
            </FormField>
            <FormField id="confirmPassword" label="Confirm password" error={errors.confirmPassword}>
              <Input
                id="confirmPassword"
                type="password"
                autoComplete="new-password"
                aria-invalid={Boolean(errors.confirmPassword)}
                {...register('confirmPassword')}
              />
            </FormField>
            <Button type="submit" size="lg" disabled={isSubmitting}>
              {isSubmitting ? 'Saving…' : 'Update password'}
            </Button>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  );
}
