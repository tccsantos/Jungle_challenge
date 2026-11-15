import {
  IntegrationEvent,
  type IntegrationEventProps,
} from '../integration-event.js';
import type {
  WagerTransactionEventData,
} from './wager-transaction-event.data.js';

export class WagerTransactionProcessed extends IntegrationEvent<WagerTransactionEventData> {
  readonly eventType = 'WagerTransactionProcessed';
  readonly version = 1;

  constructor(props: IntegrationEventProps<WagerTransactionEventData>) {
    super(props);
  }
}
