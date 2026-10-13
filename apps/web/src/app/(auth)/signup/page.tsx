import type { Metadata } from 'next';
import { SignupForm } from './signup-form';

export const metadata: Metadata = { title: 'Sign up' };

/** Sign-up page. */
export default function SignupPage(): React.ReactNode {
  return <SignupForm />;
}
