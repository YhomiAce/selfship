import type { Metadata } from 'next';
import { Suspense } from 'react';
import { DeploymentDetail } from './deployment-detail';

export const metadata: Metadata = { title: 'Deployment' };

/** Deployment page. */
export default function DeploymentPage(): React.ReactNode {
  return (
    <Suspense>
      <DeploymentDetail />
    </Suspense>
  );
}
