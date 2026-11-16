import {
  BadRequestException,
  Controller,
  DefaultValuePipe,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Query,
} from '@nestjs/common';

import { WagerTransactionQueryRepository } from './repositories/wager-transaction-query.repository.js';

@Controller()
export class WagerTransactionQueryController {
  constructor(
    private readonly transactions: WagerTransactionQueryRepository,
  ) {}

  @Get('wagering/transactions/:id')
  async findOne(
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    const transaction = await this.transactions.findById(id);

    if (!transaction) {
      throw new NotFoundException(
        'Transaction not found',
      );
    }

    return transaction;
  }

  @Get(
    'providers/:providerId/wagering/transactions/:externalTransactionId',
  )
  async findByProviderAndExternalId(
    @Param('providerId') providerId: string,
    @Param('externalTransactionId')
    externalTransactionId: string,
  ) {
    const transaction =
      await this.transactions.findByProviderAndExternalId(
        providerId,
        externalTransactionId,
      );

    if (!transaction) {
      throw new NotFoundException(
        'Transaction not found',
      );
    }

    return transaction;
  }

  @Get('wallets/:id/transactions')
  async history(
    @Param('id', new ParseUUIDPipe()) walletId: string,
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

    const result = await this.transactions.findByWallet(
      walletId,
      limit,
      offset,
    );

    if (!result) {
      throw new NotFoundException(
        'Wallet not found',
      );
    }

    return result;
  }
}
