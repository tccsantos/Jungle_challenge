import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { EntityManager } from '@mikro-orm/postgresql';

import { Money } from '../../shared/domain/money.js';
import { WalletEntity } from '../entities/wallet.entity.js';

export interface CreateWalletInput {
  playerId: string;
  initialBalance: {
    amount: string;
    currency: string;
  };
}

export interface CreateWalletOutput {
  id: string;
  playerId: string;
  balance: {
    amount: string;
    currency: string;
  };
  version: number;
}

@Injectable()
export class CreateWalletUseCase {
  constructor(private readonly em: EntityManager) {}

  async execute(input: CreateWalletInput): Promise<CreateWalletOutput> {
    if (!input?.playerId?.trim()) {
      throw new BadRequestException('playerId is required');
    }

    if (
      typeof input.initialBalance?.amount !== 'string' ||
      typeof input.initialBalance?.currency !== 'string'
    ) {
      throw new BadRequestException(
        'initialBalance must contain amount and currency',
      );
    }

    let initialBalance: Money;

    try {
      initialBalance = Money.fromDecimal(
        input.initialBalance.amount,
        input.initialBalance.currency,
      );
    } catch {
      throw new BadRequestException('Invalid initialBalance');
    }

    if (initialBalance.isNegative()) {
        throw new BadRequestException(
            'Initial balance cannot be negative',
        );
    }

    // Temporário: saldo positivo exigirá OPENING + ledger + outbox.
    if (!initialBalance.isZero()) {
        throw new BadRequestException(
            'Positive initial balance is not implemented yet',
        );
    }

    try {
      return await this.em.transactional(async (tx) => {
        const wallet = new WalletEntity();

        wallet.id = randomUUID();
        wallet.playerId = input.playerId.trim();
        wallet.currency = input.initialBalance.currency;
        wallet.balance = '0.00';
        wallet.version = 1;

        tx.persist(wallet);

        return {
          id: wallet.id,
          playerId: wallet.playerId,
          balance: {
            amount: wallet.balance,
            currency: wallet.currency,
          },
          version: wallet.version,
        };
      });
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new ConflictException(
          'Wallet already exists for this player and currency',
        );
      }

      throw error;
    }
  }

  private isUniqueViolation(error: unknown): boolean {
    let current: unknown = error;

    while (current && typeof current === 'object') {
      const candidate = current as {
        code?: string;
        cause?: unknown;
      };

      if (candidate.code === '23505') {
        return true;
      }

      current = candidate.cause;
    }

    return false;
  }
}
