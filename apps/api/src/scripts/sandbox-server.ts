/**
 * Marks a server as a free sandbox server (or back to a normal server).
 *
 *   pnpm --filter @selfship/api sandbox-server <server-id> on|off
 *
 * The server must already be added and set up in Selfship (by an admin
 * account). Sandbox servers run many users' small apps with resource limits.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { PrismaClient, PrismaPg } from '@selfship/db';

async function main(): Promise<void> {
  // Local checkouts keep settings in the root .env; containers get them from the environment.
  const envFile = path.resolve(__dirname, '../../../../.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  const [serverId, mode] = process.argv.slice(2);
  if (!serverId || (mode !== 'on' && mode !== 'off')) {
    process.stderr.write('Usage: pnpm --filter @selfship/api sandbox-server <server-id> on|off\n');
    process.exit(2);
  }
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  try {
    const server = await prisma.server.update({
      where: { id: serverId },
      data: { isPlatformSandbox: mode === 'on' },
      select: { name: true, host: true, status: true, isPlatformSandbox: true },
    });
    process.stdout.write(
      `${server.name} (${server.host}) is ${server.isPlatformSandbox ? 'now a sandbox server' : 'a normal server again'}` +
        (server.status === 'ready'
          ? ''
          : ` — note: its status is "${server.status}", run setup first`) +
        '\n',
    );
  } finally {
    await prisma.$disconnect();
  }
}

void main();
