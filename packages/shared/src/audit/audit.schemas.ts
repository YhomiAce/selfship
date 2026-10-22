/** Security-relevant actions recorded in the audit log. */
export const AUDIT_ACTIONS = [
  'auth.login',
  'auth.login_failed',
  'auth.two_factor_failed',
  'auth.password_reset',
  'auth.two_factor_enabled',
  'auth.two_factor_disabled',
  'auth.recovery_codes_regenerated',
  'auth.recovery_code_used',
  'server.added',
  'server.removed',
  'env.changed',
  'env.revealed',
  'env.deleted',
  'deployment.started',
  'deployment.rolled_back',
  'deployment.cancelled',
  'domain.added',
  'domain.removed',
  'build_doctor.fix_applied',
  'project.deleted',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/** Labels for the activity list. */
export const AUDIT_ACTION_LABELS: Record<AuditAction, string> = {
  'auth.login': 'Signed in',
  'auth.login_failed': 'Failed sign-in (wrong password)',
  'auth.two_factor_failed': 'Failed sign-in (wrong two-factor code)',
  'auth.password_reset': 'Password reset',
  'auth.two_factor_enabled': 'Two-factor authentication turned on',
  'auth.two_factor_disabled': 'Two-factor authentication turned off',
  'auth.recovery_codes_regenerated': 'New recovery codes created',
  'auth.recovery_code_used': 'Signed in with a recovery code',
  'server.added': 'Server added',
  'server.removed': 'Server removed',
  'env.changed': 'Environment variables changed',
  'env.revealed': 'Environment variable revealed',
  'env.deleted': 'Environment variable deleted',
  'deployment.started': 'Deployment started',
  'deployment.rolled_back': 'Rolled back',
  'deployment.cancelled': 'Deployment cancelled',
  'domain.added': 'Domain added',
  'domain.removed': 'Domain removed',
  'build_doctor.fix_applied': 'Build Doctor fix applied',
  'project.deleted': 'Project deleted',
};

/** One entry of the audit log. */
export interface AuditEventDto {
  id: string;
  action: AuditAction;
  targetType: string | null;
  targetId: string | null;
  targetName: string | null;
  metadata: Record<string, string>;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
}

/** Response of `GET /audit-events` (newest first, cursor-paginated). */
export interface AuditEventListResponse {
  items: AuditEventDto[];
  /** Pass as `?before=` to get older events; null when there are no more. */
  nextCursor: string | null;
}
