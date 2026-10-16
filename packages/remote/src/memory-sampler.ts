import type { CommandRunner } from './ssh';

/** Peak memory use observed while sampling. */
export interface MemoryPeak {
  /** Highest RAM in use (total − available), MB. */
  ramUsedMb: number;
  /** Highest swap in use, MB. */
  swapUsedMb: number;
}

const STOP_FILE = '/tmp/selfship-sampler-stop';

/**
 * Samples server memory once a second until stopped (build metrics).
 *
 * @param runner - Connection to the server
 * @returns `stop()` resolving to the peak values
 */
export function sampleMemory(runner: CommandRunner): { stop: () => Promise<MemoryPeak> } {
  const peak: MemoryPeak = { ramUsedMb: 0, swapUsedMb: 0 };
  let buffer = '';
  const script = `rm -f ${STOP_FILE}; while [ ! -f ${STOP_FILE} ]; do awk '/MemTotal/{t=$2}/MemAvailable/{a=$2}/SwapTotal/{st=$2}/SwapFree/{sf=$2}END{print int((t-a)/1024), int((st-sf)/1024)}' /proc/meminfo; sleep 1; done; rm -f ${STOP_FILE}`;
  const running = runner.exec(script, {
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
  let stopped: Promise<MemoryPeak> | null = null;
  return {
    stop: () => {
      stopped ??= runner.exec(`touch ${STOP_FILE}`, { check: false }).then(async () => {
        await running;
        return peak;
      });
      return stopped;
    },
  };
}
