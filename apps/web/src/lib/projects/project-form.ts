import { z } from 'zod';
import {
  type AdapterName,
  BranchNameSchema,
  ProjectNameSchema,
  type ProjectSettings,
  ProjectSettingsSchema,
  RelativePathSchema,
} from '@selfship/shared';

/** Form used by both the "new project" wizard and the settings page. */
export const ProjectFormSchema = z.object({
  name: ProjectNameSchema,
  branch: BranchNameSchema,
  rootDirectory: RelativePathSchema,
  settings: ProjectSettingsSchema,
});
export type ProjectFormInput = z.input<typeof ProjectFormSchema>;
export type ProjectFormValues = z.output<typeof ProjectFormSchema>;

/** Which settings fields each project type uses (others are hidden and cleared). */
export const ADAPTER_FIELDS: Record<
  AdapterName,
  { install: boolean; build: boolean; start: boolean; output: boolean; node: boolean }
> = {
  nextjs: { install: true, build: true, start: true, output: false, node: true },
  node: { install: true, build: true, start: true, output: false, node: true },
  spa: { install: true, build: true, start: false, output: true, node: true },
  static: { install: false, build: false, start: false, output: true, node: false },
  dockerfile: { install: false, build: false, start: false, output: false, node: false },
};

/**
 * Clears settings the chosen project type doesn't use, so stale values
 * (e.g. a start command left over after switching to "Static") aren't saved.
 *
 * @param settings - Validated settings from the form
 * @returns Settings with unused fields set to null
 */
export function cleanSettings(settings: ProjectSettings): ProjectSettings {
  const fields = ADAPTER_FIELDS[settings.adapter];
  return {
    ...settings,
    installCommand: fields.install ? settings.installCommand : null,
    buildCommand: fields.build ? settings.buildCommand : null,
    startCommand: fields.start ? settings.startCommand : null,
    outputDirectory: fields.output ? settings.outputDirectory : null,
    nodeVersion: fields.node ? settings.nodeVersion : null,
  };
}

/**
 * Suggests a project name from a repository name: lowercase, dashes for
 * anything else, trimmed to the allowed length.
 *
 * @param repoName - Repository name, e.g. "My_Cool.Site"
 * @returns A valid project name (or "my-app" if nothing usable is left)
 */
export function suggestProjectName(repoName: string): string {
  const slug = repoName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, 40)
    .replace(/^-+|-+$/g, '');
  return slug || 'my-app';
}

/** API field paths that differ from the form's (create uses `source.*`). */
export const API_FIELD_ALIASES: Record<string, string> = {
  'source.branch': 'branch',
  'source.rootDirectory': 'rootDirectory',
};
