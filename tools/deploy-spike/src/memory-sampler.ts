import type { SshConnection } from './ssh.ts';

/** Peak memory use observed while sampling. */
export interface MemoryPeak {
  /** Highest RAM in use (total − available), MB. */
  ramUsedMb: number;
  /** Highest swap in use, MB. */
  swapUsedMb: number;
}

/**
 * Samples server memory once a second until stopped, to measure how much a
 * build really needs (the spike's main experiment).
 *
 * @param ssh - Open connection
 * @returns `stop()` resolving to the peak values
 */
export function sampleMemory(ssh: SshConnection): { stop: () => Promise<MemoryPeak> } {
  const peak: MemoryPeak = { ramUsedMb: 0, swapUsedMb: 0 };
  let buffer = '';
  const script = `while [ ! -f /tmp/selfship-sampler-stop ]; do awk '/MemTotal/{t=$2}/MemAvailable/{a=$2}/SwapTotal/{st=$2}/SwapFree/{sf=$2}END{print int((t-a)/1024), int((st-sf)/1024)}' /proc/meminfo; sleep 1; done; rm -f /tmp/selfship-sampler-stop`;
  const running = ssh.exec(`rm -f /tmp/selfship-sampler-stop; ${script}`, {
    check: false,
    onOutput: (chunk) => {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const [ram = 0, swap = 0] = line.trim().split(/\s+/).map(Number);
        peak.ramUsedMb = Math.max(peak.ramUsedMb, ram);
        peak.swapUsedMb = Math.max(peak.swapUsedMb, swap);
      }
    },
  });
  return {
    stop: async () => {
      await ssh.exec('touch /tmp/selfship-sampler-stop', { check: false });
      await running;
      return peak;
    },
  };
}
