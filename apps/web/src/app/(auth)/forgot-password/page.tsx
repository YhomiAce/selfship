import type { Metadata } from 'next';
import { ForgotPasswordForm } from './forgot-password-form';

export const metadata: Metadata = { title: 'Forgot password' };

/** Password-reset request page. */
export default function ForgotPasswordPage(): React.ReactNode {
  return <ForgotPasswordForm />;
}
