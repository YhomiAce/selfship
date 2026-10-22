import type { Metadata } from 'next';
import { AccountDetails } from './account-details';
import { ActivityCard } from './activity-card';
import { TwoFactorCard } from './two-factor-card';

export const metadata: Metadata = { title: 'Settings' };

/** Account settings. */
export default function SettingsPage(): React.ReactNode {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
      <AccountDetails />
      <TwoFactorCard />
      <ActivityCard />
    </div>
  );
}
