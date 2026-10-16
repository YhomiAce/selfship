import type { Metadata } from 'next';
import { AddServerForm } from './add-server-form';

export const metadata: Metadata = { title: 'Add server' };

/** Add-server page. */
export default function NewServerPage(): React.ReactNode {
  return <AddServerForm />;
}
