import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'Log in' };

/** Sign-in page. The form reads query params, so it renders inside Suspense. */
export default function LoginPage(): React.ReactNode {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
