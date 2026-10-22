'use client';

import { Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { RecoveryCodeSchema, TotpCodeSchema } from '@selfship/shared';
import { FormAlert } from '@/components/auth/form-alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FieldGroup } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiRequestError } from '@/lib/api-client';
import { authApi } from '@/lib/auth/auth-api';
import { safeRedirect } from '@/lib/auth/safe-redirect';

/**
 * Asks for the 6-digit code from the authenticator app (or a recovery code)
 * after a correct password. The pending sign-in lives in an httpOnly cookie.
 */
export function TwoFactorForm(): React.ReactNode {
  const router = useRouter();
  const params = useSearchParams();
  const [useRecovery, setUseRecovery] = useState(false);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    const parsed = (useRecovery ? RecoveryCodeSchema : TotpCodeSchema).safeParse(value);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check the code.');
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await authApi.verifyTwoFactor(
        useRecovery ? { recoveryCode: parsed.data } : { code: parsed.data },
      );
      router.replace(safeRedirect(params.get('next')));
    } catch (caught) {
      setError(caught instanceof ApiRequestError ? caught.message : 'Could not sign in.');
      setSubmitting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Two-factor authentication</CardTitle>
        <CardDescription>
          {useRecovery
            ? 'Enter one of the recovery codes you saved when you set up two-factor.'
            : 'Enter the 6-digit code from your authenticator app.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={(event) => void submit(event)} noValidate>
          <FieldGroup>
            <FormAlert message={error} />
            <div className="flex flex-col gap-2">
              <Label htmlFor="code">{useRecovery ? 'Recovery code' : 'Code'}</Label>
              <Input
                id="code"
                autoFocus
                autoComplete="one-time-code"
                inputMode={useRecovery ? 'text' : 'numeric'}
                placeholder={useRecovery ? 'abcde-12345' : '123456'}
                className="font-mono tracking-widest"
                value={value}
                onChange={(event) => {
                  setValue(event.target.value);
                }}
              />
            </div>
            <Button type="submit" disabled={submitting}>
              {submitting ? <Loader2 className="animate-spin" /> : null}
              Verify
            </Button>
            <div className="flex justify-between text-sm">
              <button
                type="button"
                className="text-muted-foreground hover:underline"
                onClick={() => {
                  setUseRecovery(!useRecovery);
                  setValue('');
                  setError(null);
                }}
              >
                {useRecovery ? 'Use the authenticator app' : 'Use a recovery code'}
              </button>
              <Link href="/login" className="text-muted-foreground hover:underline">
                Start over
              </Link>
            </div>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  );
}
