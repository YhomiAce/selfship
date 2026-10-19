import type { DeploymentHint, DeploymentStage } from './deployment.schemas';

/** What the explainer looks at. */
export interface FailureContext {
  /** Stage that failed (null when it failed before the pipeline started). */
  stage: DeploymentStage | null;
  /** The deployment log (only the end is examined). */
  log: string;
  /** The error summary shown to the user. */
  error: string | null;
}

/** One known failure: a test on the text, and the explanation. */
interface Rule {
  /** Stages the rule applies to (any stage when omitted). */
  stages?: readonly (DeploymentStage | null)[];
  pattern: RegExp;
  explain: (match: RegExpMatchArray) => DeploymentHint;
}

/** Only the end of the log matters, and it keeps regexes fast. */
const MAX_TEXT = 40_000;

/**
 * Known failures, most specific first. Each turns a cryptic log line into
 * what happened and what to do. Advice names Selfship settings by the labels
 * users see in the dashboard.
 */
const RULES: readonly Rule[] = [
  {
    pattern: /ERR_OSSL_EVP_UNSUPPORTED|0308010C:digital envelope routines::unsupported/,
    explain: () => ({
      title: 'This project uses an old webpack that newer Node.js versions reject',
      advice:
        'Add an environment variable NODE_OPTIONS = --openssl-legacy-provider with scope "Build", then deploy again. Upgrading react-scripts/webpack fixes it for good.',
    }),
  },
  {
    pattern: /Treating warnings as errors because process\.env\.CI = true/,
    explain: () => ({
      title: 'The build stops on warnings because CI is set',
      advice:
        'Create React App fails on lint warnings when CI=true. Fix the warnings shown above, or add an environment variable CI = false with scope "Build".',
    }),
  },
  {
    pattern: /JavaScript heap out of memory|Reached heap limit/,
    explain: () => ({
      title: 'Node.js ran out of memory during the build',
      advice:
        'Give the build more memory with a "Build" variable NODE_OPTIONS = --max-old-space-size=1536 (on 2 GB+ servers), or use a server with more RAM.',
    }),
  },
  {
    pattern: /exit code:? 137|\bOOMKilled\b|Cannot allocate memory|\bENOMEM\b|^\s*Killed\s*$/m,
    explain: () => ({
      title: 'Your server ran out of memory',
      advice:
        'The process was killed for using too much memory. Builds of large apps (e.g. Next.js) need about 2 GB; Selfship adds swap on 1 GB servers, but a 2 GB server is more reliable. Make sure only one build runs at a time.',
    }),
  },
  {
    pattern: /no space left on device/i,
    explain: () => ({
      title: "Your server's disk is full",
      advice:
        'Free some space (e.g. remove unused Docker images with "docker system prune") or use a bigger disk. Selfship keeps the last 3 images per app and clears the build cache when the disk is over 80% full.',
    }),
  },
  {
    pattern:
      /npm ci` can only install|can only install with an existing package-lock|package\.json and package-lock\.json .*are not in sync|ERR_PNPM_NO_LOCKFILE|ERR_PNPM_OUTDATED_LOCKFILE|frozen-lockfile|lockfile needs to be updated|YN0028/i,
    explain: () => ({
      title: 'The lockfile is missing or out of date',
      advice:
        'Run your package manager locally (e.g. "npm install") and commit the updated lockfile. Or change the install command in Build settings (e.g. "npm install" instead of "npm ci").',
    }),
  },
  {
    pattern: /ERESOLVE|unable to resolve dependency tree|conflicting peer dependency/i,
    explain: () => ({
      title: "npm couldn't agree on compatible package versions",
      advice:
        'Two dependencies need different versions of the same package. Fix the versions in package.json, or change the install command to "npm install --legacy-peer-deps".',
    }),
  },
  {
    pattern: /Missing script: "?([\w:.-]+)"?/,
    explain: (match) => ({
      title: `package.json has no "${match[1] ?? ''}" script`,
      advice:
        'Check the build and start commands in Build settings, or add the script to package.json.',
    }),
  },
  {
    pattern:
      /npm (?:ERR!|error) (?:code )?E404|ERR_PNPM_FETCH_40[134]|npm (?:ERR!|error) code E401/,
    explain: () => ({
      title: 'A package could not be downloaded (private or misspelled)',
      advice:
        'If it is a private package, add an NPM_TOKEN variable with scope "Build" and an .npmrc in the repository that uses it. Otherwise check the package name in package.json.',
    }),
  },
  {
    pattern:
      /The engine "node" is incompatible|Unsupported engine|requires Node(?:\.js)? (?:version )?[>^~]?\d+/i,
    explain: () => ({
      title: 'The project needs a different Node.js version',
      advice:
        'Pick the Node.js version the project expects in Build settings (see "engines" in package.json), then deploy again.',
    }),
  },
  {
    pattern: /Module not found: Error: Can't resolve '([^']+)'|Cannot find module '([^']+)'/,
    explain: (match) => ({
      title: `A file or package couldn't be found: ${match[1] ?? match[2] ?? ''}`,
      advice:
        'Linux file names are case-sensitive: an import that works on macOS or Windows can fail here if the capitalisation differs. Otherwise the package may be missing from package.json "dependencies".',
    }),
  },
  {
    pattern: /failed to read dockerfile|open Dockerfile: no such file/i,
    explain: () => ({
      title: 'There is no Dockerfile in the project folder',
      advice:
        'Pick another project type in Build settings, or check the root directory if the Dockerfile is in a subfolder.',
    }),
  },
  {
    pattern: /"\/app\/[\w./-]+": not found|COPY failed: .*no such file/,
    explain: () => ({
      title: "The build output folder doesn't exist",
      advice:
        'The build finished but its output is somewhere else. Check the output directory in Build settings (e.g. dist, build or out).',
    }),
  },
  {
    stages: ['health_check'],
    pattern:
      /ECONNREFUSED[^\n]*:(?:5432|3306|27017|6379)\b|MongoNetworkError|MongooseServerSelectionError|querySrv E[A-Z]+|getaddrinfo ENOTFOUND|ENOTFOUND [\w.-]*(?:mongodb|postgres|mysql|redis)/,
    explain: () => ({
      title: "Your app couldn't reach its database",
      advice:
        'Set the database connection variables (e.g. DATABASE_URL or MONGODB_URI) under Environment variables. "localhost" inside the app means the app itself, not your server: use the database\'s real address.',
    }),
  },
  {
    stages: ['health_check'],
    pattern: /EADDRINUSE/,
    explain: () => ({
      title: 'The app tried to use a port that is already taken',
      advice:
        'Start the server once, on the port from the PORT variable (process.env.PORT), and set the same port in Build settings.',
    }),
  },
  {
    stages: ['health_check'],
    pattern: /didn't answer on port (\d+)/,
    explain: (match) => ({
      title: `Nothing answered on port ${match[1] ?? ''}`,
      advice: `Make the app listen on 0.0.0.0 (not localhost) and on process.env.PORT, which Selfship sets to ${match[1] ?? 'the configured port'}. If it uses another port, change it in Build settings.`,
    }),
  },
  {
    stages: ['health_check'],
    pattern: /exited right after starting/,
    explain: () => ({
      title: 'Your app crashed while starting',
      advice:
        'Look at the last output of the app above. Common causes: a missing environment variable, a wrong start command, or a dependency that is only in devDependencies.',
    }),
  },
  {
    pattern: /Cannot connect to the Docker daemon|docker: command not found|docker\.sock: connect/,
    explain: () => ({
      title: "Docker isn't running on the server",
      advice: 'Open the server in Selfship and click "Re-run setup".',
    }),
  },
  {
    pattern: /Couldn't log in to the server/,
    explain: () => ({
      title: "Selfship's key was removed from the server",
      advice:
        'Open the server in Selfship and add the key again with the command shown there, then deploy again.',
    }),
  },
  {
    pattern: /Couldn't reach the server/,
    explain: () => ({
      title: 'The server is offline or blocking SSH',
      advice:
        "Check that the server is running and that its firewall (and your provider's) allows SSH, then deploy again.",
    }),
  },
  {
    stages: ['cloning'],
    pattern: /not our ref|unadvertised object|did not match any file|couldn't find remote ref/i,
    explain: () => ({
      title: 'That commit no longer exists on GitHub',
      advice: 'The branch was probably force-pushed. Deploy again to use its latest commit.',
    }),
  },
  {
    stages: ['cloning'],
    pattern: /Repository not found|Authentication failed|could not read Username|HTTP 40[134]/i,
    explain: () => ({
      title: 'Selfship lost access to the repository',
      advice:
        'Check that the Selfship GitHub app still has access to this repository (GitHub → Settings → Applications), then deploy again.',
    }),
  },
];

/**
 * Explains a failed deployment in plain language, using known patterns
 * (no AI: that's the Build Doctor). Returns null when nothing matches.
 *
 * @param context - Failed stage, log and error summary
 * @returns Title and advice, or null
 */
export function explainFailure(context: FailureContext): DeploymentHint | null {
  const text = `${context.log.slice(-MAX_TEXT)}\n${context.error ?? ''}`;
  for (const rule of RULES) {
    if (rule.stages && !rule.stages.includes(context.stage)) continue;
    const match = text.match(rule.pattern);
    if (match) return rule.explain(match);
  }
  return null;
}

/**
 * Explains why a certificate couldn't be issued, from Traefik's ACME errors.
 *
 * @param text - Traefik log lines about the domain
 * @returns Title and advice, or null
 */
export function explainCertificateError(text: string): DeploymentHint | null {
  if (/too many certificates|rateLimited|too many failed authorizations/i.test(text)) {
    return {
      title: "Let's Encrypt's rate limit was reached for this domain",
      advice:
        "Let's Encrypt limits how many certificates a domain can get per week. Wait (usually up to an hour for failed attempts, up to a week for issued ones) and Selfship will retry automatically.",
    };
  }
  if (/NXDOMAIN|no valid A records|DNS problem/i.test(text)) {
    return {
      title: "Let's Encrypt couldn't find the domain's DNS record",
      advice:
        'Check the DNS record at your domain provider. New records can take a few minutes (sometimes hours) to be visible everywhere.',
    };
  }
  if (/Timeout during connect|Connection refused|firewall/i.test(text)) {
    return {
      title: "Let's Encrypt couldn't connect to your server on port 80",
      advice:
        "Allow ports 80 and 443 in your server's firewall and in your provider's network/firewall settings.",
    };
  }
  if (/CAA record/i.test(text)) {
    return {
      title: "The domain's CAA record doesn't allow Let's Encrypt",
      advice:
        'Add letsencrypt.org to the CAA record at your DNS provider, or remove the CAA record.',
    };
  }
  return null;
}
