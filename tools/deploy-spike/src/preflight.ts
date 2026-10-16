import type { SshConnection } from './ssh.ts';

/** What a server looks like before we touch it. */
export interface PreflightReport {
  os: string;
  osId: string;
  osVersion: string;
  arch: string;
  ramMb: number;
  swapMb: number;
  diskFreeGb: number;
  cpus: number;
  /** Passwordless sudo available (required). */
  sudo: boolean;
  dockerVersion: string | null;
  /** Processes already listening on 80/443 (e.g. nginx/apache). */
  portsInUse: string[];
  problems: string[];
  warnings: string[];
}

/** Collects facts as KEY=VALUE lines; every command tolerates failure. */
const SCRIPT = `
. /etc/os-release 2>/dev/null
echo "OS=$PRETTY_NAME"; echo "OS_ID=$ID"; echo "OS_VERSION=$VERSION_ID"
echo "ARCH=$(uname -m)"
echo "RAM_MB=$(awk '/MemTotal/{print int($2/1024)}' /proc/meminfo)"
echo "SWAP_MB=$(awk '/SwapTotal/{print int($2/1024)}' /proc/meminfo)"
echo "DISK_FREE_GB=$(df -Pk / | awk 'NR==2{print int($4/1024/1024)}')"
echo "CPUS=$(nproc)"
if sudo -n true 2>/dev/null; then echo "SUDO=yes"; else echo "SUDO=no"; fi
echo "DOCKER=$(sudo -n docker version -f '{{.Server.Version}}' 2>/dev/null || true)"
echo "PORTS=$(sudo -n ss -ltnpH 2>/dev/null | awk '$4 ~ /:(80|443)$/ {print $4"("$6")"}' | tr '\\n' ' ')"
`;

/**
 * Inspects a server and flags anything that would stop a deploy.
 *
 * @param ssh - Open connection
 * @returns Facts, blocking problems and warnings
 */
export async function preflight(ssh: SshConnection): Promise<PreflightReport> {
  const { stdout } = await ssh.exec(SCRIPT, { check: false });
  const facts = Object.fromEntries(
    stdout
      .split('\n')
      .map((line) => line.match(/^([A-Z_]+)=(.*)$/))
      .filter((match): match is RegExpMatchArray => match !== null)
      .map((match) => [match[1], (match[2] ?? '').trim()]),
  ) as Record<string, string | undefined>;

  const num = (key: string): number => Number(facts[key] ?? 0) || 0;
  const report: PreflightReport = {
    os: facts.OS ?? 'unknown',
    osId: facts.OS_ID ?? '',
    osVersion: facts.OS_VERSION ?? '',
    arch: facts.ARCH ?? '',
    ramMb: num('RAM_MB'),
    swapMb: num('SWAP_MB'),
    diskFreeGb: num('DISK_FREE_GB'),
    cpus: num('CPUS'),
    sudo: facts.SUDO === 'yes',
    dockerVersion: facts.DOCKER || null,
    portsInUse: (facts.PORTS ?? '').split(' ').filter(Boolean),
    problems: [],
    warnings: [],
  };

  const supported =
    (report.osId === 'ubuntu' && ['22.04', '24.04'].includes(report.osVersion)) ||
    (report.osId === 'debian' && ['12', '13'].includes(report.osVersion));
  if (!supported)
    report.problems.push(`Unsupported OS "${report.os}" (need Ubuntu 22.04/24.04 or Debian 12/13)`);
  if (!['x86_64', 'aarch64'].includes(report.arch))
    report.problems.push(`Unsupported CPU architecture ${report.arch}`);
  if (!report.sudo) report.problems.push('The SSH user needs passwordless sudo');
  if (report.diskFreeGb < 5)
    report.problems.push(`Only ${report.diskFreeGb} GB disk free (need at least 5)`);
  const foreign = report.portsInUse.filter(
    (p) => !p.includes('docker-proxy') && !p.includes('traefik'),
  );
  if (foreign.length) report.problems.push(`Ports 80/443 already used by: ${foreign.join(', ')}`);
  if (report.ramMb < 900) report.warnings.push('Less than 1 GB RAM: only static sites will fit');
  else if (report.ramMb < 1900)
    report.warnings.push('Less than 2 GB RAM: swap will be added; large builds may be slow');
  return report;
}
