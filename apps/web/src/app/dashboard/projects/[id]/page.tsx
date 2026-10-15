import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ProjectDetail } from './project-detail';

export const metadata: Metadata = { title: 'Project' };

/** Project page. */
export default function ProjectPage(): React.ReactNode {
  return (
    <Suspense>
      <ProjectDetail />
    </Suspense>
  );
}
