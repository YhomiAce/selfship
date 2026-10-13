import { FolderGit2 } from 'lucide-react';
import type { Metadata } from 'next';
import { EmptyState } from '@/components/dashboard/empty-state';
import { Button } from '@/components/ui/button';

export const metadata: Metadata = { title: 'Projects' };

/** Projects list. Empty until GitHub integration lands (M2). */
export default function ProjectsPage(): React.ReactNode {
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
        <p className="text-muted-foreground text-sm">Apps you deploy from GitHub.</p>
      </div>
      <EmptyState
        icon={FolderGit2}
        title="No projects yet"
        description="Connect GitHub to pick a repository, then deploy it to your server. GitHub integration is coming next."
        action={
          <Button disabled title="Available in the next milestone">
            Connect GitHub
          </Button>
        }
      />
    </div>
  );
}
