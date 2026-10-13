'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { ForgotPasswordSchema } from '@selfship/shared';
import { FormAlert } from '@/components/auth/form-alert';
import { FormField } from '@/components/form-field';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FieldGroup } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { authApi } from '@/lib/auth/auth-api';
import { applyApiErrors } from '@/lib/form-errors';

/** Requests a password-reset email. */
export function ForgotPasswordForm(): React.ReactNode {
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(ForgotPasswordSchema), defaultValues: { email: '' } });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await authApi.forgotPassword(values);
      setSentTo(values.email);
    } catch (error) {
      setFormError(applyApiErrors(error, setError, ['email']));
    }
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Reset your password</CardTitle>
        <CardDescription>
          {sentTo
            ? 'Check your inbox.'
            : "Enter your account's email and we'll send you a reset link."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {sentTo ? (
          <FieldGroup>
            <FormAlert
              tone="success"
              message={`If an account exists for ${sentTo}, a reset link is on its way. It expires in 1 hour.`}
            />
            <Link href="/login" className="text-center text-sm font-medium hover:underline">
              Back to log in
            </Link>
          </FieldGroup>
        ) : (
          <form onSubmit={onSubmit} noValidate>
            <FieldGroup>
              <FormAlert message={formError} />
              <FormField id="email" label="Email" error={errors.email}>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  aria-invalid={Boolean(errors.email)}
                  {...register('email')}
                />
              </FormField>
              <Button type="submit" size="lg" disabled={isSubmitting}>
                {isSubmitting ? 'Sending…' : 'Send reset link'}
              </Button>
              <Link
                href="/login"
                className="text-muted-foreground text-center text-sm hover:underline"
              >
                Back to log in
              </Link>
            </FieldGroup>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
