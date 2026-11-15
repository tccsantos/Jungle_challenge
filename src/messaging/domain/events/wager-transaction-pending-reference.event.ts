import {
  IntegrationEvent,
  type IntegrationEventProps,
} from '../integration-event.js';
import type {
  WagerTransactionEventData,
} from './wager-transaction-event.data.js';

export interface WagerTransactionPendingReferenceData
  extends WagerTransactionEventData {
  referenceExternalTransactionId: string;
}

export class WagerTransactionPendingReference extends IntegrationEvent<WagerTransactionPendingReferenceData> {
  readonly eventType = 'WagerTransactionPendingReference';
  readonly version = 1;

  constructor(
    props: IntegrationEventProps<WagerTransactionPendingReferenceData>,
  ) {
    super(props);
  }
}
