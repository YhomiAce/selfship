import type { PrismaService } from '../prisma/prisma.service';
import { SandboxExpiryService } from './sandbox-expiry.service';
import type { TeardownService } from './teardown.service';

describe('SandboxExpiryService', () => {
  it('removes expired sandbox apps and frees their projects, retrying failures later', async () => {
    const updates: string[] = [];
    const prisma = {
      project: {
        findMany: () =>
          Promise.resolve([
            { id: 'p1', name: 'one', serverId: 'sbx' },
            { id: 'p2', name: 'two', serverId: 'sbx' },
          ]),
        update: ({ where }: { where: { id: string } }) => {
          updates.push(`project:${where.id}`);
          return Promise.resolve();
        },
      },
      deployment: {
        updateMany: ({ where }: { where: { projectId: string } }) => {
          updates.push(`deployments:${where.projectId}`);
          return Promise.resolve();
        },
      },
      $transaction: (operations: Promise<unknown>[]) => Promise.all(operations),
    } as unknown as PrismaService;
    const torn: string[] = [];
    const teardown = {
      teardown: (projectId: string) => {
        if (projectId === 'p2') return Promise.reject(new Error('server unreachable'));
        torn.push(projectId);
        return Promise.resolve();
      },
    } as unknown as TeardownService;

    await expect(new SandboxExpiryService(prisma, teardown).expire()).resolves.toBe(1);
    expect(torn).toEqual(['p1']);
    expect(updates).toEqual(['deployments:p1', 'project:p1']);
  });
});
