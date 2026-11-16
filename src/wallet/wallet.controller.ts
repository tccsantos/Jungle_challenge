import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  DefaultValuePipe,
  ParseIntPipe,
  ParseUUIDPipe,
  Query,
  BadRequestException,
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

import { WalletLedgerRepository } from './repositories/wallet-ledger.repository.js';

@Controller('wallets')
export class WalletController {
  constructor(
    private readonly createWallet: CreateWalletUseCase,
    private readonly walletRepository: WalletRepository,
    private readonly reconcileWallets: ReconcileWalletsUseCase,
    private readonly walletLedgerRepository: WalletLedgerRepository,
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


  @Get(':id/ledger')
  async history(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe)
    limit: number,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe)
    offset: number,
  ) {
    if (limit < 1 || limit > 100) {
      throw new BadRequestException(
        'limit must be between 1 and 100',
      );
    }

    if (!Number.isSafeInteger(offset) || offset < 0) {
      throw new BadRequestException(
        'offset must be a non-negative safe integer',
      );
    }

    const wallet = await this.walletRepository.findById(id);

    if (!wallet) {
      throw new NotFoundException('Wallet not found');
    }

    return this.walletLedgerRepository.findHistory(
      id,
      limit,
      offset,
    );
  }

}
