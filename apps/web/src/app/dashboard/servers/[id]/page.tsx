import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ServerDetail } from './server-detail';

export const metadata: Metadata = { title: 'Server' };

/** Server page. */
export default function ServerPage(): React.ReactNode {
  return (
    <Suspense>
      <ServerDetail />
    </Suspense>
  );
}
