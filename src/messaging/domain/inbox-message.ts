export interface ReceiveInboxProps {
  messageId: string;
  consumerName: string;
  payloadHash: string;
  receivedAt?: Date;
}

export interface InboxMessageState {
  messageId: string;
  consumerName: string;
  payloadHash: string;
  receivedAt: Date;
  processedAt?: Date;
}

export class InvalidInboxMessageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidInboxMessageError';
  }
}

export class InboxMessageAlreadyProcessedError extends Error {
  constructor() {
    super('Inbox message has already been processed');
    this.name = 'InboxMessageAlreadyProcessedError';
  }
}

export class InboxMessage {
  private _processedAt?: Date;

  private constructor(
    public readonly messageId: string,
    public readonly consumerName: string,
    public readonly payloadHash: string,
    private readonly _receivedAt: Date,
    processedAt?: Date,
  ) {
    this._processedAt = processedAt
      ? new Date(processedAt.getTime())
      : undefined;
  }

  static receive(props: ReceiveInboxProps): InboxMessage {
    this.validateRequiredString(props.messageId, 'messageId');
    this.validateRequiredString(props.consumerName, 'consumerName');
    this.validateRequiredString(props.payloadHash, 'payloadHash');

    const receivedAt = props.receivedAt ?? new Date();

    this.validateDate(receivedAt, 'receivedAt');

    return new InboxMessage(
      props.messageId,
      props.consumerName,
      props.payloadHash,
      receivedAt,
    );
  }

  static rehydrate(state: InboxMessageState): InboxMessage {
    this.validateRequiredString(state.messageId, 'messageId');
    this.validateRequiredString(state.consumerName, 'consumerName');
    this.validateRequiredString(state.payloadHash, 'payloadHash');
    this.validateDate(state.receivedAt, 'receivedAt');

    if (state.processedAt !== undefined) {
      this.validateDate(state.processedAt, 'processedAt');
    }

    return new InboxMessage(
      state.messageId,
      state.consumerName,
      state.payloadHash,
      state.receivedAt,
      state.processedAt,
    );
  }

  get receivedAt(): Date {
    return new Date(this._receivedAt.getTime());
  }

  get processedAt(): Date | undefined {
    return this._processedAt
      ? new Date(this._processedAt.getTime())
      : undefined;
  }

  isProcessed(): boolean {
    return this._processedAt !== undefined;
  }

  markProcessed(at: Date): void {
    if (this.isProcessed()) {
      throw new InboxMessageAlreadyProcessedError();
    }

    InboxMessage.validateDate(at, 'processedAt');

    this._processedAt = new Date(at.getTime());
  }

  private static validateRequiredString(
    value: string,
    field: string,
  ): void {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new InvalidInboxMessageError(
        `${field} must be a non-empty string`,
      );
    }
  }

  private static validateDate(value: Date, field: string): void {
    if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
      throw new InvalidInboxMessageError(
        `${field} must be a valid date`,
      );
    }
  }
}
