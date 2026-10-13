import { BadRequestException } from '@nestjs/common';
import { hashToken } from '../common/crypto';
import type { PrismaService } from '../prisma/prisma.service';
import { TokenService } from './token.service';

describe('TokenService.consume', () => {
  const prisma = {
    verificationToken: { findUnique: jest.fn(), updateMany: jest.fn() },
  };
  const service = new TokenService(prisma as unknown as PrismaService);
  const future = new Date(Date.now() + 60_000);

  beforeEach(() => jest.resetAllMocks());

  it('returns the user ID for a valid token and marks it used', async () => {
    prisma.verificationToken.findUnique.mockResolvedValue({
      id: 't1',
      userId: 'u1',
      purpose: 'EMAIL_VERIFICATION',
      usedAt: null,
      expiresAt: future,
    });
    prisma.verificationToken.updateMany.mockResolvedValue({ count: 1 });

    await expect(service.consume('raw-token', 'EMAIL_VERIFICATION')).resolves.toBe('u1');
    expect(prisma.verificationToken.findUnique).toHaveBeenCalledWith({
      where: { tokenHash: hashToken('raw-token') },
    });
  });

  it.each([
    ['unknown', null],
    ['expired', { purpose: 'EMAIL_VERIFICATION', usedAt: null, expiresAt: new Date(0) }],
    ['already used', { purpose: 'EMAIL_VERIFICATION', usedAt: new Date(), expiresAt: future }],
    ['for another purpose', { purpose: 'PASSWORD_RESET', usedAt: null, expiresAt: future }],
  ])('rejects a token that is %s', async (_label, record) => {
    prisma.verificationToken.findUnique.mockResolvedValue(
      record && { id: 't', userId: 'u', ...record },
    );
    await expect(service.consume('raw', 'EMAIL_VERIFICATION')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects when a concurrent request used the token first', async () => {
    prisma.verificationToken.findUnique.mockResolvedValue({
      id: 't1',
      userId: 'u1',
      purpose: 'PASSWORD_RESET',
      usedAt: null,
      expiresAt: future,
    });
    prisma.verificationToken.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.consume('raw', 'PASSWORD_RESET')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
