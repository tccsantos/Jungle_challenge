import { BadRequestException } from '@nestjs/common';

export interface LedgerCursor {
  walletId: string;
  createdAt: string;
  id: string;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

export function encodeLedgerCursor(
  cursor: LedgerCursor,
): string {
  return Buffer.from(
    JSON.stringify({
      v: 1,
      walletId: cursor.walletId,
      createdAt: cursor.createdAt,
      id: cursor.id,
    }),
    'utf8',
  ).toString('base64url');
}

export function decodeLedgerCursor(
  encoded: string,
  walletId: string,
): LedgerCursor {
  try {
    if (
      !encoded ||
      encoded.length > 1024 ||
      !/^[A-Za-z0-9_-]+$/.test(encoded)
    ) {
      throw new Error('Invalid encoding');
    }

    const decoded: unknown = JSON.parse(
      Buffer.from(encoded, 'base64url').toString('utf8'),
    );

    if (
      decoded === null ||
      typeof decoded !== 'object' ||
      Array.isArray(decoded)
    ) {
      throw new Error('Invalid cursor');
    }

    const value = decoded as Record<string, unknown>;

    if (
      value.v !== 1 ||
      value.walletId !== walletId ||
      typeof value.id !== 'string' ||
      !UUID_PATTERN.test(value.id) ||
      typeof value.createdAt !== 'string' ||
      !TIMESTAMP_PATTERN.test(value.createdAt) ||
      Number.isNaN(Date.parse(value.createdAt))
    ) {
      throw new Error('Invalid cursor fields');
    }

    return {
      walletId,
      createdAt: value.createdAt,
      id: value.id,
    };
  } catch {
    throw new BadRequestException(
      'Invalid or incompatible ledger cursor',
    );
  }
}
