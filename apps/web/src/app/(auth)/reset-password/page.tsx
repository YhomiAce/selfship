import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ResetPasswordForm } from './reset-password-form';

export const metadata: Metadata = { title: 'Reset password' };

/** Page opened from the password-reset email. */
export default function ResetPasswordPage(): React.ReactNode {
  return (
    <Suspense>
      <ResetPasswordForm />
    </Suspense>
  );
}
