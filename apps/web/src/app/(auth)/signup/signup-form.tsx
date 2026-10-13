'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { RegisterSchema } from '@selfship/shared';
import { FormAlert } from '@/components/auth/form-alert';
import { GithubButton } from '@/components/auth/github-button';
import { FormField } from '@/components/form-field';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FieldGroup } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { authApi } from '@/lib/auth/auth-api';
import { applyApiErrors } from '@/lib/form-errors';

/** Account creation form. */
export function SignupForm(): React.ReactNode {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(RegisterSchema),
    defaultValues: { name: '', email: '', password: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      const user = await authApi.register(values);
      toast.success('Account created', {
        description: `We sent a confirmation link to ${user.email}.`,
      });
      router.replace('/dashboard');
    } catch (error) {
      setFormError(applyApiErrors(error, setError, ['name', 'email', 'password']));
    }
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Create your account</CardTitle>
        <CardDescription>Deploy your first app in a few minutes.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} noValidate>
          <FieldGroup>
            <FormAlert message={formError} />
            <GithubButton label="Sign up with GitHub" />
            <FormField id="name" label="Name" error={errors.name}>
              <Input
                id="name"
                autoComplete="name"
                aria-invalid={Boolean(errors.name)}
                {...register('name')}
              />
            </FormField>
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
              description="At least 10 characters. A short phrase works well."
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
            <Button type="submit" size="lg" disabled={isSubmitting}>
              {isSubmitting ? 'Creating account…' : 'Create account'}
            </Button>
            <p className="text-muted-foreground text-center text-sm">
              Already have an account?{' '}
              <Link href="/login" className="text-foreground font-medium hover:underline">
                Log in
              </Link>
            </p>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  );
}
