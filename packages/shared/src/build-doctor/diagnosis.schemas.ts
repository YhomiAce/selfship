import { z } from 'zod';
import { type ProjectSettings, ProjectSettingsSchema } from '../projects/project.schemas';

/** What kind of problem caused a failed deployment. */
export const DIAGNOSIS_CATEGORIES = [
  'user_code',
  'dependency',
  'configuration',
  'server_resources',
  'platform',
  'network',
  'unknown',
] as const;

/** Labels for the UI. */
export const DIAGNOSIS_CATEGORY_LABELS: Record<(typeof DIAGNOSIS_CATEGORIES)[number], string> = {
  user_code: 'Code',
  dependency: 'Dependencies',
  configuration: 'Settings',
  server_resources: 'Server resources',
  platform: 'Platform',
  network: 'Network',
  unknown: 'Unclear',
};

/**
 * Fixes Build Doctor may propose. The model can only pick from this list;
 * Selfship validates the value and runs its own tested implementation.
 * - `add_swap`, `prune_docker`, `retry`: server-side, may run automatically (once)
 * - `set_*`: project settings, applied only when the user clicks "Apply fix"
 */
export const REMEDIATION_ACTIONS = [
  'add_swap',
  'prune_docker',
  'retry',
  'set_port',
  'set_node_version',
  'set_install_command',
  'set_build_command',
  'set_start_command',
  'set_output_directory',
] as const;
export type RemediationAction = (typeof REMEDIATION_ACTIONS)[number];

/** Actions Selfship may run without asking (server/platform problems only). */
export const AUTO_REMEDIATION_ACTIONS: readonly RemediationAction[] = [
  'add_swap',
  'prune_docker',
  'retry',
];

/**
 * Build Doctor's answer. Used as Claude's structured-output format and as
 * the API response, so both always agree.
 */
export const DiagnosisSchema = z.object({
  category: z.enum(DIAGNOSIS_CATEGORIES),
  /** One plain-language sentence. */
  summary: z.string(),
  /** What went wrong and why, in a short paragraph. */
  rootCause: z.string(),
  /** Log lines (verbatim) that show it. */
  evidence: z.array(z.string()),
  /** Ordered steps the user can follow. */
  fixSteps: z.array(z.string()),
  /** A change to a file in the repository, as a unified diff. */
  suggestedPatch: z.object({ filePath: z.string(), diff: z.string() }).nullable(),
  /** One fix Selfship can apply itself. `value` is the new setting for `set_*` actions. */
  remediation: z
    .object({ action: z.enum(REMEDIATION_ACTIONS), value: z.string().nullable() })
    .nullable(),
  confidence: z.enum(['low', 'medium', 'high']),
});
export type Diagnosis = z.infer<typeof DiagnosisSchema>;

/** Where a diagnosis is. */
export type DiagnosisStatus = 'pending' | 'ready' | 'failed' | 'skipped';

/** Public representation of a Build Doctor diagnosis. */
export interface DiagnosisDto {
  id: string;
  deploymentId: string;
  status: DiagnosisStatus;
  /** The diagnosis, when ready. */
  result: Diagnosis | null;
  /** Why there is no diagnosis (failed/skipped). */
  error: string | null;
  /** Reused from an earlier identical failure. */
  cached: boolean;
  /** What Selfship already did about it (automatic fixes), if anything. */
  autoRemediation: string | null;
  /** Whether the remediation is a setting the user can apply now. */
  canApply: boolean;
  feedback: 'up' | 'down' | null;
  createdAt: string;
}

/** Response of `GET /projects/:id/deployments/:deploymentId/diagnosis` (null: never requested). */
export interface DiagnosisResponse {
  /** False when Build Doctor isn't set up on this Selfship (no API key) or is off for the project. */
  available: boolean;
  diagnosis: DiagnosisDto | null;
}

/** Body of `POST …/diagnosis/feedback`. */
export const DiagnosisFeedbackSchema = z.object({
  helpful: z.boolean(),
  comment: z.string().trim().max(1000).optional(),
});
export type DiagnosisFeedbackInput = z.infer<typeof DiagnosisFeedbackSchema>;

/** Error codes specific to Build Doctor. */
export const BuildDoctorErrorCode = {
  BUILD_DOCTOR_UNAVAILABLE: 'BUILD_DOCTOR_UNAVAILABLE',
  NOT_DIAGNOSABLE: 'NOT_DIAGNOSABLE',
  NOTHING_TO_APPLY: 'NOTHING_TO_APPLY',
} as const;

/** A Build Doctor remediation that changes a project setting. */
type SettingsRemediation = NonNullable<Diagnosis['remediation']>;

/**
 * Applies a `set_*` remediation to project settings, validated exactly like
 * the settings form. Server actions (`add_swap`…) and invalid values return
 * null, so a model can never smuggle in a setting the form would refuse.
 *
 * @param settings - Current settings
 * @param remediation - Proposed fix
 * @returns New settings and a description, or null when it can't be applied
 */
export function settingsAfterRemediation(
  settings: ProjectSettings,
  remediation: SettingsRemediation | null,
): { settings: ProjectSettings; description: string } | null {
  if (!remediation?.value) return null;
  const value = remediation.value.trim();
  const changes: Record<string, { patch: Partial<ProjectSettings>; description: string }> = {
    set_port: { patch: { port: Number(value) }, description: `Port set to ${value}` },
    set_node_version: {
      patch: { nodeVersion: Number(value) },
      description: `Node.js version set to ${value}`,
    },
    set_install_command: {
      patch: { installCommand: value },
      description: `Install command set to "${value}"`,
    },
    set_build_command: {
      patch: { buildCommand: value },
      description: `Build command set to "${value}"`,
    },
    set_start_command: {
      patch: { startCommand: value },
      description: `Start command set to "${value}"`,
    },
    set_output_directory: {
      patch: { outputDirectory: value },
      description: `Output directory set to "${value}"`,
    },
  };
  const change = changes[remediation.action];
  if (!change) return null;
  const parsed = ProjectSettingsSchema.safeParse({ ...settings, ...change.patch });
  return parsed.success ? { settings: parsed.data, description: change.description } : null;
}
