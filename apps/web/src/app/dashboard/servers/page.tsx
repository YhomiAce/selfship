import type { Metadata } from 'next';
import { ServersList } from '@/components/servers/servers-list';

export const metadata: Metadata = { title: 'Servers' };

/** Servers overview. */
export default function ServersPage(): React.ReactNode {
  return <ServersList />;
}
