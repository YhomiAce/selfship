import type { Metadata } from 'next';
import { Suspense } from 'react';
import { TwoFactorForm } from './two-factor-form';

export const metadata: Metadata = { title: 'Two-factor code' };

/** Second sign-in step for accounts with two-factor authentication. */
export default function TwoFactorPage(): React.ReactNode {
  return (
    <Suspense>
      <TwoFactorForm />
    </Suspense>
  );
}
