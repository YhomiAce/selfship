'use client';

import { Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { FormAlert } from '@/components/auth/form-alert';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FieldGroup } from '@/components/ui/field';
import { ApiRequestError } from '@/lib/api-client';
import { authApi } from '@/lib/auth/auth-api';

type Status = { state: 'verifying' } | { state: 'verified' } | { state: 'failed'; message: string };

/** Confirms the email as soon as the page opens, then shows the outcome. */
export function VerifyEmailStatus(): React.ReactNode {
  const token = useSearchParams().get('token');
  const [status, setStatus] = useState<Status>(
    token ? { state: 'verifying' } : { state: 'failed', message: 'This link is incomplete.' },
  );
  // Tokens are single-use; make sure the request is only sent once even if
  // React runs the effect twice (Strict Mode) or the route is re-shown.
  const sent = useRef(false);

  useEffect(() => {
    if (!token || sent.current) return;
    sent.current = true;
    authApi
      .verifyEmail(token)
      .then(() => setStatus({ state: 'verified' }))
      .catch((error: unknown) =>
        setStatus({
          state: 'failed',
          message:
            error instanceof ApiRequestError
              ? error.message
              : 'Something went wrong. Please try again.',
        }),
      );
  }, [token]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">
          {status.state === 'verified' ? 'Email confirmed' : 'Confirm your email'}
        </CardTitle>
        <CardDescription>
          {status.state === 'verifying' && 'Hang on while we confirm your address…'}
          {status.state === 'verified' && "You're all set."}
          {status.state === 'failed' && "We couldn't confirm your email."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          {status.state === 'verifying' ? (
            <Loader2 className="text-muted-foreground mx-auto size-6 animate-spin" />
          ) : null}
          {status.state === 'failed' ? <FormAlert message={status.message} /> : null}
          {status.state !== 'verifying' ? (
            <Link href="/dashboard" className={buttonVariants({ size: 'lg' })}>
              Go to dashboard
            </Link>
          ) : null}
          {status.state === 'failed' ? (
            <p className="text-muted-foreground text-center text-sm">
              You can request a new link from the banner in your dashboard.
            </p>
          ) : null}
        </FieldGroup>
      </CardContent>
    </Card>
  );
}
