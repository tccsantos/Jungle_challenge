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
  HttpCode, HttpStatus
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

import {
  decodeLedgerCursor,
} from './repositories/wallet-ledger-cursor.js';

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

  @HttpCode(HttpStatus.OK)
  @Post(':id/reconciliation')
  async reconcileWallet(
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    const result =
      await this.reconcileWallets.executeForWallet(id);

    if (!result) {
      throw new NotFoundException('Wallet not found');
    }

    return result;
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

    @Query('offset')
    offsetRaw?: string,

    @Query('cursor')
    cursorRaw?: string,
  ) {
    if (limit < 1 || limit > 100) {
      throw new BadRequestException(
        'limit must be between 1 and 100',
      );
    }

    const wallet = await this.walletRepository.findById(id);

    if (!wallet) {
      throw new NotFoundException('Wallet not found');
    }

    // Compatibilidade com clientes antigos.
    if (offsetRaw !== undefined) {
      if (cursorRaw !== undefined) {
        throw new BadRequestException(
          'cursor and offset cannot be combined',
        );
      }

      if (!/^\d+$/.test(offsetRaw)) {
        throw new BadRequestException(
          'offset must be a non-negative integer',
        );
      }

      const offset = Number(offsetRaw);

      if (!Number.isSafeInteger(offset)) {
        throw new BadRequestException(
          'offset must be a safe integer',
        );
      }

      return this.walletLedgerRepository.findHistory(
        id,
        limit,
        offset,
      );
    }

    // Novo contrato por cursor.
    const cursor =
      cursorRaw === undefined
        ? undefined
        : decodeLedgerCursor(cursorRaw, id);

    return this.walletLedgerRepository.findHistoryByCursor(
      id,
      limit,
      cursor,
    );
  }


}
