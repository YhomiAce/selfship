import type { GithubConnectionState } from '@selfship/shared';
import { Badge } from '@/components/ui/badge';

/** Human-readable labels for the GitHub connection state. */
const LABELS: Record<GithubConnectionState, string> = {
  connected: 'Connected',
  suspended: 'GitHub app suspended',
  removed: 'GitHub access removed',
};

/**
 * Badge for a project's GitHub connection; hidden when everything is fine.
 *
 * @param props.state - Connection state
 */
export function GithubStateBadge({ state }: { state: GithubConnectionState }): React.ReactNode {
  if (state === 'connected') return null;
  return <Badge variant="destructive">{LABELS[state]}</Badge>;
}
