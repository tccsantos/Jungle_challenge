import {
  Body,
  Controller,
  Headers,
  Post,
} from '@nestjs/common';

import {
  ProcessWagerTransactionUseCase,
  type ProcessWagerInput,
  type ProcessWagerOutput,
} from './application/process-wager-transaction.use-case.js';

@Controller('wagering/transactions')
export class WageringController {
  constructor(
    private readonly processWager: ProcessWagerTransactionUseCase,
  ) {}

  @Post()
  async create(
    @Body() body: Omit<ProcessWagerInput, 'idempotencyKey'>,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<ProcessWagerOutput> {
    return this.processWager.execute({
      ...body,
      idempotencyKey: idempotencyKey ?? '',
    });
  }
}
