import { CircleAlert, CircleCheck } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';

/**
 * Form-level message (errors not tied to a single field, or success notes).
 *
 * @param props.message - Text to show; renders nothing when null
 * @param props.tone - `error` (default) or `success`
 */
export function FormAlert({
  message,
  tone = 'error',
}: {
  message: string | null;
  tone?: 'error' | 'success';
}): React.ReactNode {
  if (!message) return null;
  return (
    <Alert variant={tone === 'error' ? 'destructive' : 'default'}>
      {tone === 'error' ? <CircleAlert /> : <CircleCheck />}
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}
