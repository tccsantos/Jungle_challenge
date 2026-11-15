import {
  IntegrationEvent,
  type IntegrationEventProps,
} from '../integration-event.js';
import type {
  FailureCode,
} from '../../../wagering/domain/wager-transaction.js';
import type {
  WagerTransactionEventData,
} from './wager-transaction-event.data.js';

export interface WagerTransactionRejectedData
  extends WagerTransactionEventData {
  failureCode: FailureCode;
}

export class WagerTransactionRejected extends IntegrationEvent<WagerTransactionRejectedData> {
  readonly eventType = 'WagerTransactionRejected';
  readonly version = 1;

  constructor(
    props: IntegrationEventProps<WagerTransactionRejectedData>,
  ) {
    super(props);
  }
}
