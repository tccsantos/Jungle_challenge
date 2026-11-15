import { randomUUID } from 'node:crypto';

import { Money } from '../../shared/domain/money.js';
import { LedgerDirection } from '../../wallet/domain/wallet-ledger-entry.js';

export enum WagerTransactionKind {
  Opening = 'OPENING',
  Bet = 'BET',
  Win = 'WIN',
  Loss = 'LOSS',
  Refund = 'REFUND',
  Rollback = 'ROLLBACK',
}

export enum WagerTransactionStatus {
  Pending = 'PENDING',
  PendingReference = 'PENDING_REFERENCE',
  Processed = 'PROCESSED',
  Rejected = 'REJECTED',
  Failed = 'FAILED',
}

export enum FailureCode {
  InsufficientFunds = 'INSUFFICIENT_FUNDS',
  InvalidReference = 'INVALID_REFERENCE',
  ReferenceNotFound = 'REFERENCE_NOT_FOUND',
  ReversalWouldOverdraw = 'REVERSAL_WOULD_OVERDRAW',
  InvalidTransaction = 'INVALID_TRANSACTION',
  InternalError = 'INTERNAL_ERROR',
}

export interface CreateWagerTransactionProps {
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  payloadHash: string;
  walletId: string;
  playerId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  money: Money;
  referenceExternalTransactionId?: string;
}

export interface WagerTransactionState
  extends CreateWagerTransactionProps {
  id: string;
  createdAt: Date;
  status: WagerTransactionStatus;
  referenceTransactionId?: string;
  failureCode?: FailureCode;
  processedAt?: Date;
}

export class InvalidTransactionStateError extends Error {
  constructor(status: WagerTransactionStatus) {
    super(`Cannot transition transaction from status ${status}`);
    this.name = 'InvalidTransactionStateError';
  }
}

export class WagerTransaction {
  private readonly createdAtTimestamp: number;

  private _status: WagerTransactionStatus;
  private _referenceTransactionId?: string;
  private _failureCode?: FailureCode;
  private _processedAtTimestamp?: number;

  private constructor(
    public readonly id: string,
    public readonly providerId: string,
    public readonly externalTransactionId: string,
    public readonly idempotencyKey: string,
    public readonly payloadHash: string,
    public readonly walletId: string,
    public readonly playerId: string,
    public readonly roundId: string,
    public readonly gameId: string,
    public readonly kind: WagerTransactionKind,
    public readonly money: Money,
    public readonly referenceExternalTransactionId: string | undefined,
    createdAt: Date,
    status: WagerTransactionStatus,
    referenceTransactionId?: string,
    failureCode?: FailureCode,
    processedAt?: Date,
  ) {
    this.createdAtTimestamp = createdAt.getTime();
    this._status = status;
    this._referenceTransactionId = referenceTransactionId;
    this._failureCode = failureCode;
    this._processedAtTimestamp = processedAt?.getTime();
  }

  static create(props: CreateWagerTransactionProps): WagerTransaction {
    const requiredFields = [
      props.providerId,
      props.externalTransactionId,
      props.idempotencyKey,
      props.payloadHash,
      props.walletId,
      props.playerId,
      props.roundId,
      props.gameId,
    ];

    if (requiredFields.some((value) => !value.trim())) {
      throw new Error('Transaction fields cannot be empty');
    }

    if (
      !Object.values(WagerTransactionKind).includes(props.kind)
    ) {
      throw new Error('Invalid transaction kind');
    }

    if (props.money.isNegative() || props.money.isZero()) {
      throw new Error('Transaction amount must be greater than zero');
    }

    const requiresReference =
      props.kind === WagerTransactionKind.Refund ||
      props.kind === WagerTransactionKind.Rollback;

    if (requiresReference && !props.referenceExternalTransactionId?.trim()) {
      throw new Error('This transaction kind requires a reference');
    }

    if (!requiresReference && props.referenceExternalTransactionId) {
      throw new Error('This transaction kind cannot have a reference');
    }

    return new WagerTransaction(
      randomUUID(),
      props.providerId,
      props.externalTransactionId,
      props.idempotencyKey,
      props.payloadHash,
      props.walletId,
      props.playerId,
      props.roundId,
      props.gameId,
      props.kind,
      props.money,
      props.referenceExternalTransactionId,
      new Date(),
      WagerTransactionStatus.Pending,
    );
  }

  static rehydrate(state: WagerTransactionState): WagerTransaction {
    return new WagerTransaction(
      state.id,
      state.providerId,
      state.externalTransactionId,
      state.idempotencyKey,
      state.payloadHash,
      state.walletId,
      state.playerId,
      state.roundId,
      state.gameId,
      state.kind,
      state.money,
      state.referenceExternalTransactionId,
      state.createdAt,
      state.status,
      state.referenceTransactionId,
      state.failureCode,
      state.processedAt,
    );
  }

  get createdAt(): Date {
    return new Date(this.createdAtTimestamp);
  }

  get status(): WagerTransactionStatus {
    return this._status;
  }

  get referenceTransactionId(): string | undefined {
    return this._referenceTransactionId;
  }

  get failureCode(): FailureCode | undefined {
    return this._failureCode;
  }

  get processedAt(): Date | undefined {
    return this._processedAtTimestamp === undefined
      ? undefined
      : new Date(this._processedAtTimestamp);
  }

  markProcessed(
    at: Date,
    referenceTransactionId?: string | undefined,
  ): void {
    this.assertCanTransition();

    if (this.requiresReference() && !referenceTransactionId) {
      throw new Error('Processed reversal requires an internal reference ID');
    }

    if (!this.requiresReference() && referenceTransactionId) {
      throw new Error('Unexpected reference transaction ID');
    }

    this._referenceTransactionId = referenceTransactionId;
    this._processedAtTimestamp = at.getTime();
    this._status = WagerTransactionStatus.Processed;
  }

  markPendingReference(): void {
    this.assertCanTransition();

    if (!this.requiresReference()) {
      throw new Error('Transaction does not require a reference');
    }

    this._status = WagerTransactionStatus.PendingReference;
  }

  reject(code: FailureCode): void {
    this.assertCanTransition();

    this._failureCode = code;
    this._status = WagerTransactionStatus.Rejected;
  }

  fail(code: FailureCode): void {
    this.assertCanTransition();

    this._failureCode = code;
    this._status = WagerTransactionStatus.Failed;
  }

  isTerminal(): boolean {
    return (
      this._status === WagerTransactionStatus.Processed ||
      this._status === WagerTransactionStatus.Rejected ||
      this._status === WagerTransactionStatus.Failed
    );
  }

  affectsBalance(): boolean {
    return this.kind !== WagerTransactionKind.Loss;
  }

  requiresReference(): boolean {
    return (
      this.kind === WagerTransactionKind.Refund ||
      this.kind === WagerTransactionKind.Rollback
    );
  }

  matchesPayload(payloadHash: string): boolean {
    return this.payloadHash === payloadHash;
  }

  ledgerDirectionFor(
    reference?: WagerTransaction,
  ): LedgerDirection {
    switch (this.kind) {
      case WagerTransactionKind.Opening:
      case WagerTransactionKind.Win:
        return LedgerDirection.Credit;

      case WagerTransactionKind.Bet:
        return LedgerDirection.Debit;

      case WagerTransactionKind.Loss:
        throw new Error('LOSS does not generate a ledger entry');

      case WagerTransactionKind.Refund:
      case WagerTransactionKind.Rollback:
        return this.getReversalDirection(reference);
    }
  }

  private getReversalDirection(
    reference?: WagerTransaction,
  ): LedgerDirection {
    if (!reference) {
      throw new Error('Reference transaction is required');
    }

    if (reference.status !== WagerTransactionStatus.Processed) {
      throw new Error('Reference transaction must be processed');
    }

    const validReferenceKinds =
      this.kind === WagerTransactionKind.Refund
        ? [WagerTransactionKind.Bet]
        : [
            WagerTransactionKind.Bet,
            WagerTransactionKind.Win,
            WagerTransactionKind.Refund,
          ];

    if (!validReferenceKinds.includes(reference.kind)) {
      throw new Error('Invalid reference transaction kind');
    }

    if (
      this.providerId !== reference.providerId ||
      this.walletId !== reference.walletId ||
      this.playerId !== reference.playerId ||
      this.roundId !== reference.roundId ||
      this.money.currency !== reference.money.currency ||
      !this.money.equals(reference.money)
    ) {
      throw new Error('Reference transaction does not match');
    }

    const referenceDirection =
      reference.kind === WagerTransactionKind.Bet
        ? LedgerDirection.Debit
        : LedgerDirection.Credit;

    return referenceDirection === LedgerDirection.Debit
      ? LedgerDirection.Credit
      : LedgerDirection.Debit;
  }

  private assertCanTransition(): void {
    if (this.isTerminal()) {
      throw new InvalidTransactionStateError(this._status);
    }
  }
}
