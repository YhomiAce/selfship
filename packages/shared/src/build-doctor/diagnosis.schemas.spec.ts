import type { ProjectSettings } from '../projects/project.schemas';
import { DiagnosisSchema, settingsAfterRemediation } from './diagnosis.schemas';

const settings: ProjectSettings = {
  adapter: 'node',
  installCommand: 'npm ci',
  buildCommand: null,
  startCommand: 'npm start',
  outputDirectory: null,
  port: 3000,
  nodeVersion: 22,
};

describe('settingsAfterRemediation', () => {
  it('applies valid settings changes', () => {
    expect(settingsAfterRemediation(settings, { action: 'set_port', value: '8080' })).toEqual({
      settings: { ...settings, port: 8080 },
      description: 'Port set to 8080',
    });
    expect(
      settingsAfterRemediation(settings, { action: 'set_install_command', value: 'npm install' })
        ?.settings.installCommand,
    ).toBe('npm install');
  });

  it('refuses values the settings form would refuse', () => {
    expect(settingsAfterRemediation(settings, { action: 'set_port', value: '99999' })).toBeNull();
    expect(
      settingsAfterRemediation(settings, { action: 'set_node_version', value: '16' }),
    ).toBeNull();
    expect(
      settingsAfterRemediation(settings, { action: 'set_start_command', value: 'a\nrm -rf /' }),
    ).toBeNull();
    expect(
      settingsAfterRemediation(settings, { action: 'set_output_directory', value: '../etc' }),
    ).toBeNull();
  });

  it('ignores server actions and missing values', () => {
    expect(settingsAfterRemediation(settings, { action: 'add_swap', value: null })).toBeNull();
    expect(settingsAfterRemediation(settings, { action: 'set_port', value: null })).toBeNull();
    expect(settingsAfterRemediation(settings, null)).toBeNull();
  });
});

describe('DiagnosisSchema', () => {
  it('rejects actions outside the allowlist', () => {
    const base = {
      category: 'platform',
      summary: 's',
      rootCause: 'r',
      evidence: [],
      fixSteps: [],
      suggestedPatch: null,
      confidence: 'high',
    };
    expect(
      DiagnosisSchema.safeParse({
        ...base,
        remediation: { action: 'run_shell', value: 'rm -rf /' },
      }).success,
    ).toBe(false);
    expect(DiagnosisSchema.safeParse({ ...base, remediation: null }).success).toBe(true);
  });
});
