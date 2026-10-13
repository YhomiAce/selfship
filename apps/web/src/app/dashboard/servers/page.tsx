import { Server } from 'lucide-react';
import type { Metadata } from 'next';
import { EmptyState } from '@/components/dashboard/empty-state';
import { Button } from '@/components/ui/button';

export const metadata: Metadata = { title: 'Servers' };

/** Servers list. Empty until server management lands (M3). */
export default function ServersPage(): React.ReactNode {
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Servers</h1>
        <p className="text-muted-foreground text-sm">VPSes your apps are deployed to.</p>
      </div>
      <EmptyState
        icon={Server}
        title="No servers yet"
        description="Add a VPS (Ubuntu or Debian with SSH access) and we'll set it up for deployments."
        action={
          <Button disabled title="Available in a later milestone">
            Add server
          </Button>
        }
      />
    </div>
  );
}
