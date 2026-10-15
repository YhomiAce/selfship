import type { Metadata } from 'next';
import { Suspense } from 'react';
import { NewProjectWizard } from './new-project-wizard';

export const metadata: Metadata = { title: 'New project' };

/** New-project wizard. Reads `?github=` after the GitHub round trip, hence Suspense. */
export default function NewProjectPage(): React.ReactNode {
  return (
    <Suspense>
      <NewProjectWizard />
    </Suspense>
  );
}
