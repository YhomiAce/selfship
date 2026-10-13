import type { FieldError as RhfFieldError } from 'react-hook-form';
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field';

/** Props for {@link FormField}. */
export interface FormFieldProps {
  /** ID of the input inside, used to link the label. */
  id: string;
  label: string;
  /** Helper text shown under the input. */
  description?: string;
  /** react-hook-form error for this field. */
  error?: RhfFieldError | undefined;
  /** Extra content on the label row (e.g. a "Forgot password?" link). */
  labelAction?: React.ReactNode;
  /** The input element. */
  children: React.ReactNode;
}

/**
 * Label + input + description + error, laid out consistently.
 *
 * @param props - See {@link FormFieldProps}
 */
export function FormField({
  id,
  label,
  description,
  error,
  labelAction,
  children,
}: FormFieldProps): React.ReactNode {
  return (
    <Field data-invalid={error ? true : undefined}>
      <div className="flex items-center justify-between">
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        {labelAction}
      </div>
      {children}
      {description && !error ? <FieldDescription>{description}</FieldDescription> : null}
      <FieldError errors={[error]} />
    </Field>
  );
}
