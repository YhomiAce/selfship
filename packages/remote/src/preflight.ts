import type { CommandRunner } from './ssh';

/** What a server can realistically run, from its memory. */
export type CapabilityTier = 'static_only' | 'standard' | 'recommended';

/** What a server looks like, and whether we can use it. */
export interface PreflightReport {
  os: string;
  osId: string;
  osVersion: string;
  arch: string;
  cpus: number;
  ramMb: number;
  swapMb: number;
  diskFreeGb: number;
  /** Passwordless sudo is available (required). */
  sudo: boolean;
  dockerVersion: string | null;
  /** Listeners on 80/443, e.g. `0.0.0.0:80(users:(("nginx",…)))`. */
  portsInUse: string[];
  tier: CapabilityTier;
  /** Blocking issues: setup won't run until they're fixed. */
  problems: string[];
  /** Non-blocking advice. */
  warnings: string[];
}

/** Supported operating systems: `id` → versions. */
export const SUPPORTED_OS: Readonly<Record<string, readonly string[]>> = {
  ubuntu: ['22.04', '24.04'],
  debian: ['12', '13'],
};

/** Prints facts as KEY=VALUE lines. Every probe tolerates failure. */
export const PREFLIGHT_SCRIPT = `
. /etc/os-release 2>/dev/null
echo "OS=$PRETTY_NAME"; echo "OS_ID=$ID"; echo "OS_VERSION=$VERSION_ID"
echo "ARCH=$(uname -m)"
echo "CPUS=$(nproc 2>/dev/null)"
echo "RAM_MB=$(awk '/MemTotal/{print int($2/1024)}' /proc/meminfo)"
echo "SWAP_MB=$(awk '/SwapTotal/{print int($2/1024)}' /proc/meminfo)"
echo "DISK_FREE_GB=$(df -Pk / | awk 'NR==2{print int($4/1024/1024)}')"
if sudo -n true 2>/dev/null; then echo "SUDO=yes"; else echo "SUDO=no"; fi
echo "DOCKER=$(sudo -n docker version -f '{{.Server.Version}}' 2>/dev/null || true)"
echo "PORTS=$(sudo -n ss -ltnpH 2>/dev/null | awk '$4 ~ /:(80|443)$/ {print $4"("$6")"}' | tr '\\n' ' ')"
`;

/**
 * Maps RAM to a capability tier. Thresholds sit slightly below 1/2 GB because
 * VPSes report a little less than their nominal memory (e.g. 909 MB for 1 GB).
 *
 * @param ramMb - Total RAM in MB
 * @returns Tier
 */
export function capabilityTier(ramMb: number): CapabilityTier {
  if (ramMb < 850) return 'static_only';
  if (ramMb < 1800) return 'standard';
  return 'recommended';
}

/**
 * Turns the script's output into a report and flags problems.
 *
 * @param stdout - Output of {@link PREFLIGHT_SCRIPT}
 * @returns The report
 */
export function parsePreflight(stdout: string): PreflightReport {
  const facts = new Map<string, string>();
  for (const line of stdout.split('\n')) {
    const match = /^([A-Z_]+)=(.*)$/.exec(line);
    if (match?.[1]) facts.set(match[1], (match[2] ?? '').trim());
  }
  const num = (key: string): number => Number(facts.get(key) ?? 0) || 0;

  const report: PreflightReport = {
    os: facts.get('OS') || 'unknown',
    osId: facts.get('OS_ID') ?? '',
    osVersion: facts.get('OS_VERSION') ?? '',
    arch: facts.get('ARCH') ?? '',
    cpus: num('CPUS'),
    ramMb: num('RAM_MB'),
    swapMb: num('SWAP_MB'),
    diskFreeGb: num('DISK_FREE_GB'),
    sudo: facts.get('SUDO') === 'yes',
    dockerVersion: facts.get('DOCKER') || null,
    portsInUse: (facts.get('PORTS') ?? '').split(' ').filter(Boolean),
    tier: capabilityTier(num('RAM_MB')),
    problems: [],
    warnings: [],
  };

  const versions = SUPPORTED_OS[report.osId];
  if (!versions?.includes(report.osVersion)) {
    report.problems.push(
      `Unsupported operating system "${report.os}". Selfship supports Ubuntu 22.04/24.04 and Debian 12/13.`,
    );
  }
  if (!['x86_64', 'aarch64'].includes(report.arch)) {
    report.problems.push(
      `Unsupported CPU architecture "${report.arch || 'unknown'}" (need x86_64 or arm64).`,
    );
  }
  if (!report.sudo) {
    report.problems.push(
      'The SSH user needs passwordless sudo. Connect as root, or add the user to sudoers with NOPASSWD.',
    );
  }
  if (report.diskFreeGb < 5)
    report.problems.push(`Only ${report.diskFreeGb} GB of disk is free; at least 5 GB is needed.`);

  const foreign = report.portsInUse.filter((p) => !/docker-proxy|traefik/.test(p));
  if (foreign.length > 0) {
    const names = [...new Set(foreign.map((p) => /\("([^"]+)"/.exec(p)?.[1] ?? 'another program'))];
    report.problems.push(
      `Ports 80/443 are already used by ${names.join(', ')}. Selfship needs them for its web proxy: stop or remove ${names.length > 1 ? 'those services' : 'that service'} (e.g. "sudo systemctl disable --now ${names[0] ?? 'nginx'}") and check again.`,
    );
  }

  if (report.tier === 'static_only')
    report.warnings.push('Under 1 GB of RAM: only static sites will run reliably.');
  else if (report.tier === 'standard') {
    report.warnings.push(
      report.swapMb >= 1024
        ? `Under 2 GB of RAM (${report.swapMb} MB swap in place): large builds (e.g. Next.js) will be slower.`
        : 'Under 2 GB of RAM: 2 GB of swap will be added; large builds (e.g. Next.js) will be slower.',
    );
  }
  if (report.dockerVersion && Number(report.dockerVersion.split('.')[0]) < 23) {
    report.warnings.push(`Docker ${report.dockerVersion} is old; setup will upgrade it.`);
  }
  return report;
}

/**
 * Inspects a server without changing anything.
 *
 * @param runner - Connection to the server
 * @returns Facts, blocking problems and warnings
 */
export async function preflight(runner: CommandRunner): Promise<PreflightReport> {
  const { stdout } = await runner.exec(PREFLIGHT_SCRIPT, { check: false, timeoutMs: 60_000 });
  return parsePreflight(stdout);
}
