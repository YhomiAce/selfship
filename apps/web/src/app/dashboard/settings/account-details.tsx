'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/lib/auth/auth-context';

/** Read-only account details (editing comes later). */
export function AccountDetails(): React.ReactNode {
  const { user } = useAuth();
  if (!user) return null;

  const rows: [string, string][] = [
    ['Name', user.name],
    ['Email', `${user.email} ${user.emailVerified ? '(verified)' : '(not verified)'}`],
    ['Sign-in methods', user.hasPassword ? 'Password' : 'GitHub only'],
    ['Member since', new Date(user.createdAt).toLocaleDateString()],
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Account</CardTitle>
        <CardDescription>Your profile information.</CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="grid gap-3 text-sm sm:grid-cols-[10rem_1fr]">
          {rows.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="font-medium">{value}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}
