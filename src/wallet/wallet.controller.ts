import {
  Body,
  Controller,
  Post,
} from '@nestjs/common';

import {
  CreateWalletUseCase,
  type CreateWalletInput,
  type CreateWalletOutput,
} from './application/create-wallet.use-case.js';

@Controller('wallets')
export class WalletController {
  constructor(
    private readonly createWallet: CreateWalletUseCase,
  ) {}

  @Post()
  async create(
    @Body() body: CreateWalletInput,
  ): Promise<CreateWalletOutput> {
    return this.createWallet.execute(body);
  }
}
