'use client';

import { MailWarning } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ApiRequestError } from '@/lib/api-client';
import { authApi } from '@/lib/auth/auth-api';
import { useAuth } from '@/lib/auth/auth-context';

/** Reminds unverified users to confirm their email, with a resend button. */
export function VerifyEmailBanner(): React.ReactNode {
  const { user } = useAuth();
  const [isSending, setIsSending] = useState(false);

  if (!user || user.emailVerified) return null;

  const resend = async (): Promise<void> => {
    setIsSending(true);
    try {
      await authApi.resendVerification();
      toast.success('Confirmation email sent', { description: `Check ${user.email}.` });
    } catch (error) {
      toast.error(error instanceof ApiRequestError ? error.message : 'Could not send the email.');
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-amber-200 bg-amber-50 px-6 py-2.5 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
      <MailWarning className="size-4 shrink-0" />
      <span className="flex-1">
        Confirm your email address. We sent a link to <strong>{user.email}</strong>.
      </span>
      <Button size="sm" variant="outline" onClick={() => void resend()} disabled={isSending}>
        {isSending ? 'Sending…' : 'Resend link'}
      </Button>
    </div>
  );
}
