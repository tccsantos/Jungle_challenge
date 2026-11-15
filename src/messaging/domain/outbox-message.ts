export interface IntegrationEventLike {
  readonly eventId: string;
  readonly aggregateId: string;
  readonly eventType: string;
  readonly occurredAt: Date;
  toJSON(): Record<string, unknown>;
}

export interface OutboxMessageState {
  id: string;
  aggregateId: string;
  eventType: string;
  payload: Readonly<Record<string, unknown>>;
  occurredAt: Date;
  attempts: number;
  nextAttemptAt?: Date;
  publishedAt?: Date;
}

export class InvalidOutboxMessageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidOutboxMessageError';
  }
}

export class OutboxMessageAlreadyPublishedError extends Error {
  constructor() {
    super('Outbox message has already been published');
    this.name = 'OutboxMessageAlreadyPublishedError';
  }
}

export class OutboxMessage {
  private _attempts: number;
  private _nextAttemptAt?: Date;
  private _publishedAt?: Date;

  private constructor(
    public readonly id: string,
    public readonly aggregateId: string,
    public readonly eventType: string,
    public readonly payload: Readonly<Record<string, unknown>>,
    private readonly _occurredAt: Date,
    attempts: number,
    nextAttemptAt?: Date,
    publishedAt?: Date,
  ) {
    this._occurredAt = new Date(_occurredAt.getTime());
    this.payload = OutboxMessage.freezePayload(payload);
    this._attempts = attempts;
    this._nextAttemptAt = nextAttemptAt
      ? new Date(nextAttemptAt.getTime())
      : undefined;
    this._publishedAt = publishedAt
      ? new Date(publishedAt.getTime())
      : undefined;
  }

  static enqueue(event: IntegrationEventLike): OutboxMessage {
    this.validateRequiredString(event.eventId, 'eventId');
    this.validateRequiredString(event.aggregateId, 'aggregateId');
    this.validateRequiredString(event.eventType, 'eventType');
    this.validateDate(event.occurredAt, 'occurredAt');

    const payload = this.validatePayload(event.toJSON());

    return new OutboxMessage(
      event.eventId,
      event.aggregateId,
      event.eventType,
      payload,
      event.occurredAt,
      0,
    );
  }

  static rehydrate(state: OutboxMessageState): OutboxMessage {
    this.validateRequiredString(state.id, 'id');
    this.validateRequiredString(state.aggregateId, 'aggregateId');
    this.validateRequiredString(state.eventType, 'eventType');
    this.validateDate(state.occurredAt, 'occurredAt');

    if (!Number.isInteger(state.attempts) || state.attempts < 0) {
      throw new InvalidOutboxMessageError(
        'attempts must be a non-negative integer',
      );
    }

    if (state.nextAttemptAt !== undefined) {
      this.validateDate(state.nextAttemptAt, 'nextAttemptAt');
    }

    if (state.publishedAt !== undefined) {
      this.validateDate(state.publishedAt, 'publishedAt');
    }

    if (state.publishedAt && state.nextAttemptAt) {
      throw new InvalidOutboxMessageError(
        'A published message cannot have a scheduled retry',
      );
    }

    const payload = this.validatePayload(state.payload);

    return new OutboxMessage(
      state.id,
      state.aggregateId,
      state.eventType,
      payload,
      state.occurredAt,
      state.attempts,
      state.nextAttemptAt,
      state.publishedAt,
    );
  }

  get occurredAt(): Date {
    return new Date(this._occurredAt.getTime());
  }

  get attempts(): number {
    return this._attempts;
  }

  get nextAttemptAt(): Date | undefined {
    return this._nextAttemptAt
      ? new Date(this._nextAttemptAt.getTime())
      : undefined;
  }

  get publishedAt(): Date | undefined {
    return this._publishedAt
      ? new Date(this._publishedAt.getTime())
      : undefined;
  }

  isPending(): boolean {
    return this._publishedAt === undefined;
  }

  isDue(now: Date): boolean {
    OutboxMessage.validateDate(now, 'now');

    if (!this.isPending()) {
      return false;
    }

    return (
      this._nextAttemptAt === undefined ||
      this._nextAttemptAt.getTime() <= now.getTime()
    );
  }

  markPublished(at: Date): void {
    if (!this.isPending()) {
      throw new OutboxMessageAlreadyPublishedError();
    }

    OutboxMessage.validateDate(at, 'publishedAt');

    this._publishedAt = new Date(at.getTime());
    this._nextAttemptAt = undefined;
  }

  scheduleRetry(now: Date): void {
    if (!this.isPending()) {
      throw new OutboxMessageAlreadyPublishedError();
    }

    OutboxMessage.validateDate(now, 'now');

    this._attempts += 1;

    const baseDelayMs = 1_000;
    const maxDelayMs = 60 * 60 * 1_000;
    const exponentialDelay = baseDelayMs * 2 ** (this._attempts - 1);
    const delayMs = Math.min(exponentialDelay, maxDelayMs);

    this._nextAttemptAt = new Date(now.getTime() + delayMs);
  }

  private static validateRequiredString(
    value: string,
    field: string,
  ): void {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new InvalidOutboxMessageError(
        `${field} must be a non-empty string`,
      );
    }
  }

  private static validateDate(value: Date, field: string): void {
    if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
      throw new InvalidOutboxMessageError(`${field} must be a valid date`);
    }
  }

  private static validatePayload(
    payload: Readonly<Record<string, unknown>>,
  ): Readonly<Record<string, unknown>> {
    if (
      payload === null ||
      typeof payload !== 'object' ||
      Array.isArray(payload)
    ) {
      throw new InvalidOutboxMessageError(
        'payload must be a JSON object',
      );
    }

    try {
      const serialized = JSON.stringify(payload);

      if (serialized === undefined) {
        throw new Error('Payload cannot be serialized');
      }

      return JSON.parse(serialized) as Record<string, unknown>;
    } catch {
      throw new InvalidOutboxMessageError(
        'payload must contain only JSON-serializable values',
      );
    }
  }

  private static freezePayload(
    payload: Readonly<Record<string, unknown>>,
  ): Readonly<Record<string, unknown>> {
    const freeze = (value: unknown): unknown => {
      if (value !== null && typeof value === 'object') {
        Object.values(value).forEach(freeze);
        Object.freeze(value);
      }

      return value;
    };

    return freeze(payload) as Readonly<Record<string, unknown>>;
  }
}
