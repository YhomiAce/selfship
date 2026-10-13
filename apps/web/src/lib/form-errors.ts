import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import { ApiRequestError } from '@/lib/api-client';

/**
 * Shows API errors on a react-hook-form form.
 *
 * Per-field validation errors are attached to their inputs. Everything else
 * becomes a single message for a form-level alert.
 *
 * @param error - Whatever the submit handler caught
 * @param setError - The form's `setError`
 * @param fields - Field names that exist on this form
 * @returns A form-level message, or null if every error was attached to a field
 */
export function applyApiErrors<T extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<T>,
  fields: readonly Path<T>[],
): string | null {
  if (!(error instanceof ApiRequestError)) {
    return 'Something went wrong. Check your connection and try again.';
  }

  let unmatched = false;
  for (const [field, messages] of Object.entries(error.fieldErrors)) {
    const known = fields.find((name) => name === field);
    if (known) setError(known, { type: 'server', message: messages[0] ?? 'Invalid value.' });
    else unmatched = true;
  }

  const hasFieldErrors = Object.keys(error.fieldErrors).length > 0;
  return hasFieldErrors && !unmatched ? null : error.message;
}
