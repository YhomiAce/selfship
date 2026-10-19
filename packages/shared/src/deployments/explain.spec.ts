import { explainCertificateError, explainFailure } from './explain';

/** Explains a build-stage log and returns the hint title. */
const title = (
  log: string,
  stage: Parameters<typeof explainFailure>[0]['stage'] = 'building',
  error: string | null = null,
): string | undefined => explainFailure({ stage, log, error })?.title;

describe('explainFailure', () => {
  // Real lines from the 2026-10-16 live test (Yhomi/Github-Finder, nodejs_todo_app).
  it('recognises the old-webpack OpenSSL error', () => {
    const hint = explainFailure({
      stage: 'building',
      log: '#14 2.907 Error: error:0308010C:digital envelope routines::unsupported\n#14 ERROR: process "/bin/sh -c npm run build" did not complete successfully: exit code: 1',
      error: 'The build failed. See the log above for the first error.',
    });
    expect(hint?.title).toContain('old webpack');
    expect(hint?.advice).toContain('NODE_OPTIONS = --openssl-legacy-provider');
  });

  it('recognises CRA treating warnings as errors', () => {
    expect(title('#14 15.77 Treating warnings as errors because process.env.CI = true.')).toContain(
      'CI is set',
    );
  });

  it('recognises an app that cannot reach its database', () => {
    const error =
      'The app exited right after starting.\n\nLast output of the app:\nError: querySrv ENOTFOUND _mongodb._tcp.todo-65vtm.mongodb.net';
    expect(title('', 'health_check', error)).toBe("Your app couldn't reach its database");
  });

  it.each([
    [
      '#12 ERROR: process "/bin/sh -c npm run build" did not complete successfully: exit code: 137',
      'ran out of memory',
    ],
    [
      'FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory',
      'Node.js ran out of memory',
    ],
    ['write /var/lib/docker/tmp: no space left on device', 'disk is full'],
    [
      'npm ERR! The `npm ci` command can only install with an existing package-lock.json',
      'lockfile',
    ],
    ['ERR_PNPM_OUTDATED_LOCKFILE Cannot install with "frozen-lockfile"', 'lockfile'],
    [
      'npm ERR! code ERESOLVE\nnpm ERR! ERESOLVE unable to resolve dependency tree',
      'compatible package versions',
    ],
    ['npm ERR! Missing script: "build"', 'package.json has no "build" script'],
    [
      'npm error code E404\nnpm error 404 Not Found - GET https://registry.npmjs.org/@acme%2fui',
      'could not be downloaded',
    ],
    [
      'error web@1.0.0: The engine "node" is incompatible with this module.',
      'different Node.js version',
    ],
    ["Module not found: Error: Can't resolve './Components/Header'", './Components/Header'],
    [
      'ERROR: failed to solve: failed to read dockerfile: open Dockerfile: no such file or directory',
      'no Dockerfile',
    ],
    ['ERROR: failed to compute cache key: "/app/dist": not found', 'output folder'],
  ])('build: %s', (log, expected) => {
    expect(title(log)).toContain(expected);
  });

  it('explains a port problem with the configured port', () => {
    const hint = explainFailure({
      stage: 'health_check',
      log: '',
      error:
        "The app didn't answer on port 3000 within 120s. Check that it listens on 0.0.0.0:3000 (the PORT variable).",
    });
    expect(hint?.title).toBe('Nothing answered on port 3000');
    expect(hint?.advice).toContain('process.env.PORT');
  });

  it('falls back to a generic crash explanation', () => {
    expect(
      title(
        '',
        'health_check',
        'The app exited right after starting.\n\nLast output of the app:\nTypeError: x is not a function',
      ),
    ).toBe('Your app crashed while starting');
  });

  it('explains connection problems before the pipeline starts', () => {
    expect(
      title('', null, "Couldn't log in to the server: Selfship's key was removed from it."),
    ).toContain('key was removed');
    expect(
      title('Cannot connect to the Docker daemon at unix:///var/run/docker.sock', 'building'),
    ).toContain("Docker isn't running");
  });

  it('explains clone failures', () => {
    expect(title('fatal: remote error: upload-pack: not our ref abc', 'cloning')).toContain(
      'no longer exists',
    );
    expect(title('remote: Repository not found.', 'cloning')).toContain('lost access');
  });

  it('only applies stage-specific rules in their stage', () => {
    expect(
      title('Error: listen EADDRINUSE: address already in use :::3000', 'building'),
    ).toBeUndefined();
    expect(
      title('Error: listen EADDRINUSE: address already in use :::3000', 'health_check'),
    ).toContain('already taken');
  });

  it('returns null for unknown failures', () => {
    expect(title('something unusual happened')).toBeUndefined();
  });
});

describe('explainCertificateError', () => {
  it.each([
    [
      'acme: error: 429 :: POST :: urn:ietf:params:acme:error:rateLimited :: too many certificates',
      'rate limit',
    ],
    ['DNS problem: NXDOMAIN looking up A for app.example.com', 'DNS record'],
    ['Timeout during connect (likely firewall problem)', 'port 80'],
    ['CAA record for example.com prevents issuance', 'CAA'],
  ])('%s', (text, expected) => {
    expect(explainCertificateError(text)?.title).toContain(expected);
  });

  it('returns null for unrelated lines', () => {
    expect(explainCertificateError('router created')).toBeNull();
  });
});
