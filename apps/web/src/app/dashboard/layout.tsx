import { DashboardShell } from '@/components/dashboard/dashboard-shell';
import { AuthProvider } from '@/lib/auth/auth-context';

/** Layout for every signed-in page. */
export default function DashboardLayout({ children }: LayoutProps<'/dashboard'>): React.ReactNode {
  return (
    <AuthProvider>
      <DashboardShell>{children}</DashboardShell>
    </AuthProvider>
  );
}
