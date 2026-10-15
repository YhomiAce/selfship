import type { Metadata } from 'next';
import { ProjectsList } from '@/components/projects/projects-list';

export const metadata: Metadata = { title: 'Projects' };

/** Projects overview. */
export default function ProjectsPage(): React.ReactNode {
  return <ProjectsList />;
}
