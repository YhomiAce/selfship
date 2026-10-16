import { CAPABILITY_TIER_LABELS, type ServerDto } from '@selfship/shared';

/**
 * What the last check found: OS, hardware, Docker and the capability tier.
 *
 * @param props.server - The server
 */
export function ServerSpecs({ server }: { server: ServerDto }): React.ReactNode {
  const { specs, tier } = server;
  const rows: [string, string | null][] = [
    ['Operating system', specs.os],
    ['Architecture', specs.arch],
    ['CPUs', specs.cpus ? String(specs.cpus) : null],
    ['Memory', specs.ramMb ? `${(specs.ramMb / 1024).toFixed(1)} GB` : null],
    ['Swap', specs.swapMb !== null ? `${(specs.swapMb / 1024).toFixed(1)} GB` : null],
    ['Free disk', specs.diskFreeGb !== null ? `${specs.diskFreeGb} GB` : null],
    ['Docker', specs.dockerVersion ?? 'Not installed'],
  ];
  return (
    <div className="flex flex-col gap-4">
      {tier ? (
        <div className="rounded-lg border p-3">
          <p className="text-sm font-medium">{CAPABILITY_TIER_LABELS[tier].label}</p>
          <p className="text-muted-foreground text-sm">
            {CAPABILITY_TIER_LABELS[tier].description}
          </p>
        </div>
      ) : null}
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted-foreground">{label}</dt>
            <dd>{value ?? '—'}</dd>
          </div>
        ))}
        <dt className="text-muted-foreground">Host key</dt>
        <dd className="font-mono text-xs break-all">
          {server.hostKeyFingerprint ?? 'Not pinned yet'}
        </dd>
      </dl>
    </div>
  );
}
