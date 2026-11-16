import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';

import {
  CreateWalletUseCase,
  type CreateWalletInput,
  type CreateWalletOutput,
} from './application/create-wallet.use-case.js';

import {
  ReconcileWalletsUseCase,
} from './application/reconcile-wallets.use-case.js';

import { WalletRepository } from './repositories/wallet.repository.js';

@Controller('wallets')
export class WalletController {
  constructor(
    private readonly createWallet: CreateWalletUseCase,
    private readonly walletRepository: WalletRepository,
    private readonly reconcileWallets: ReconcileWalletsUseCase,
  ) {}

  @Post()
  async create(
    @Body() body: CreateWalletInput,
  ): Promise<CreateWalletOutput> {
    return this.createWallet.execute(body);
  }

  @Get('reconciliation')
  async reconciliation() {
    return this.reconcileWallets.execute();
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    const wallet = await this.walletRepository.findById(id);

    if (!wallet) {
      throw new NotFoundException('Wallet not found');
    }

    return {
      id: wallet.id,
      playerId: wallet.playerId,
      currency: wallet.currency,
      balance: {
        amount: wallet.balance.toDecimalString(),
        currency: wallet.currency,
      },
      version: wallet.version,
      createdAt: wallet.createdAt,
      updatedAt: wallet.updatedAt,
    };
  }
}
