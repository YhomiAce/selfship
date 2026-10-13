import type { Metadata } from 'next';
import { Suspense } from 'react';
import { VerifyEmailStatus } from './verify-email-status';

export const metadata: Metadata = { title: 'Confirm email' };

/** Page opened from the verification email. */
export default function VerifyEmailPage(): React.ReactNode {
  return (
    <Suspense>
      <VerifyEmailStatus />
    </Suspense>
  );
}
