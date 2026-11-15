export interface MoneyProps {
  amount: string;
  currency: string;
}

export interface IntegrationEventProps<T> {
  eventId: string;
  aggregateId: string;
  correlationId: string;
  causationId?: string;
  occurredAt?: Date;
  data: T;
}

export interface EventContext {
  correlationId: string;
  eventId: string;
  causationId?: string;
  occurredAt?: Date;
}

export abstract class IntegrationEvent<T> {
  abstract readonly eventType: string;
  abstract readonly version: number;

  readonly eventId: string;
  readonly aggregateId: string;
  readonly correlationId: string;
  readonly causationId?: string;
  readonly occurredAt: Date;
  readonly data: Readonly<T>;

  protected constructor(props: IntegrationEventProps<T>) {
    this.eventId = props.eventId;
    this.aggregateId = props.aggregateId;
    this.correlationId = props.correlationId;
    this.causationId = props.causationId;
    this.occurredAt = new Date(
      (props.occurredAt ?? new Date()).getTime(),
    );

    this.validate();

    this.data = this.freezeData(props.data);
  }

  toJSON(): {
    eventId: string;
    eventType: string;
    aggregateId: string;
    correlationId: string;
    causationId?: string;
    occurredAt: string;
    version: number;
    data: T;
  } {
    return {
      eventId: this.eventId,
      eventType: this.eventType,
      aggregateId: this.aggregateId,
      correlationId: this.correlationId,
      ...(this.causationId
        ? { causationId: this.causationId }
        : {}),
      occurredAt: this.occurredAt.toISOString(),
      version: this.version,
      data: JSON.parse(JSON.stringify(this.data)) as T,
    };
  }

  private validate(): void {
    if (!this.eventId.trim()) {
      throw new Error('Event ID cannot be empty.');
    }

    if (!this.aggregateId.trim()) {
      throw new Error('Aggregate ID cannot be empty.');
    }

    if (!this.correlationId.trim()) {
      throw new Error('Correlation ID cannot be empty.');
    }

    if (Number.isNaN(this.occurredAt.getTime())) {
      throw new Error('Invalid event occurrence date.');
    }
  }

  private freezeData(value: T): Readonly<T> {
    const serialized = JSON.stringify(value);

    if (serialized === undefined) {
      throw new Error('Event data must be JSON serializable.');
    }

    const copy = JSON.parse(serialized) as T;

    const freeze = (item: unknown): void => {
      if (
        item === null ||
        typeof item !== 'object' ||
        Object.isFrozen(item)
      ) {
        return;
      }

      Object.values(item).forEach(freeze);
      Object.freeze(item);
    };

    freeze(copy);

    return copy;
  }
}
