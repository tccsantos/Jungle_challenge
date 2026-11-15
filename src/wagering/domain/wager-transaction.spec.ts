import { describe, expect, it } from 'vitest';
import { Money } from '../../shared/domain/money.js';
import { LedgerDirection } from '../../wallet/domain/wallet-ledger-entry.js';
import { 
    WagerTransaction,
    WagerTransactionKind,
    WagerTransactionStatus,
    FailureCode,
    InvalidTransactionStateError
 } from './wager-transaction.js';

describe('WagerTransaction', () => {

    const baseProps = {
        providerId: 'provider-1',
        externalTransactionId: 'externalId-1',
        idempotencyKey: 'idempotency-1',
        payloadHash: 'hash-1',
        walletId: 'wallet-1',
        playerId: 'player-1',
        roundId: 'round-1',
        gameId: 'game-1',
        money: Money.fromDecimal('100.00', 'BRL')
    };

    it('should start a transaction with pending status', () => {
        const transaction = WagerTransaction.create({
            ...baseProps,
            kind: WagerTransactionKind.Bet
        });

        expect(transaction.status).toBe(WagerTransactionStatus.Pending);
    });

    it('should require external reference Rollback and Refund transaction kinds', () => {
        
        expect(() =>
            WagerTransaction.create({
            ...baseProps,
            kind: WagerTransactionKind.Rollback,
            }),
        ).toThrow('This transaction kind requires a reference');

        expect(() =>
            WagerTransaction.create({
            ...baseProps,
            kind: WagerTransactionKind.Refund,
            }),
        ).toThrow('This transaction kind requires a reference');
    });

    it('should reject external reference Bet, Win and Loss transaction kinds', () => {
        
        expect(() =>
            WagerTransaction.create({
            ...baseProps,
            kind: WagerTransactionKind.Bet,
            referenceExternalTransactionId: 'externalId-2'
            }),
        ).toThrow('This transaction kind cannot have a reference');

        expect(() =>
            WagerTransaction.create({
            ...baseProps,
            kind: WagerTransactionKind.Win,
            referenceExternalTransactionId: 'externalId-2'
            }),
        ).toThrow('This transaction kind cannot have a reference');

        expect(() =>
            WagerTransaction.create({
            ...baseProps,
            kind: WagerTransactionKind.Loss,
            referenceExternalTransactionId: 'externalId-2'
            }),
        ).toThrow('This transaction kind cannot have a reference');
    });

    it('should not affect balance Loss transaction kind', () => {
        const transaction = WagerTransaction.create({
            ...baseProps,
            kind: WagerTransactionKind.Loss
        });

        expect(transaction.affectsBalance()).toBe(false);
    });

    it('should generate debit direction Bet transaction kind', () => {
        const transaction = WagerTransaction.create({
            ...baseProps,
            kind: WagerTransactionKind.Bet
        });

        expect(transaction.ledgerDirectionFor()).toBe(LedgerDirection.Debit);
    });

    it('should generate credit direction Win and Opening transaction kinds', () => {
        const transactionWin = WagerTransaction.create({
            ...baseProps,
            kind: WagerTransactionKind.Win
        });
        const transactionOpen = WagerTransaction.create({
            ...baseProps,
            kind: WagerTransactionKind.Opening
        });

        expect(transactionWin.ledgerDirectionFor()).toBe(LedgerDirection.Credit);
        expect(transactionOpen.ledgerDirectionFor()).toBe(LedgerDirection.Credit);
    });

    it('should generate credit direction Refund of a Bet transaction kind', () => {
        const transaction = WagerTransaction.create({
            ...baseProps,
            kind: WagerTransactionKind.Bet
        });
        transaction.markProcessed(new Date())
        const transactionRefund = WagerTransaction.create({
            ...baseProps,
            externalTransactionId: 'externalId-2',
            kind: WagerTransactionKind.Refund,
            referenceExternalTransactionId: transaction.externalTransactionId
            
        });

        expect(() =>
            transactionRefund.ledgerDirectionFor()
        ).toThrow('Reference transaction is required');
        expect(transactionRefund.ledgerDirectionFor(transaction)).toBe(LedgerDirection.Credit);
    });

    it('should generate debit direction Rollback of a Win transaction kind', () => {
        const transaction = WagerTransaction.create({
            ...baseProps,
            kind: WagerTransactionKind.Win
        });
        transaction.markProcessed(new Date())
        const transactionRollback = WagerTransaction.create({
            ...baseProps,
            externalTransactionId: 'externalId-2',
            kind: WagerTransactionKind.Rollback,
            referenceExternalTransactionId: transaction.externalTransactionId
            
        });

        expect(() =>
            transactionRollback.ledgerDirectionFor()
        ).toThrow('Reference transaction is required');
        expect(transactionRollback.ledgerDirectionFor(transaction)).toBe(LedgerDirection.Debit);
    });

    it.each([
        WagerTransactionStatus.Processed,
        WagerTransactionStatus.Rejected,
        WagerTransactionStatus.Failed,
    ])('should not allow transitions from terminal status %s', (status: WagerTransactionStatus) => {
        const transaction = WagerTransaction.create({
            ...baseProps,
            kind: WagerTransactionKind.Bet,
        });

        if (status === WagerTransactionStatus.Processed) {
            transaction.markProcessed(new Date());
        } else if (status === WagerTransactionStatus.Rejected) {
            transaction.reject(FailureCode.InsufficientFunds);
        } else {
            transaction.fail(FailureCode.InternalError);
        }

        expect(() => transaction.reject(FailureCode.InvalidTransaction))
            .toThrow(InvalidTransactionStateError);
    });

    it('should reject references with different currencies', () => {
        const reference = WagerTransaction.create({
            ...baseProps,
            kind: WagerTransactionKind.Bet,
        });

        reference.markProcessed(new Date());

        const rollback = WagerTransaction.create({
            ...baseProps,
            externalTransactionId: 'externalId-2',
            kind: WagerTransactionKind.Rollback,
            referenceExternalTransactionId: reference.externalTransactionId,
            money: Money.fromDecimal('100.00', 'USD'),
        });

        expect(() => rollback.ledgerDirectionFor(reference))
            .toThrow('Reference transaction does not match');
    });

    it('should reject references with different wallets', () => {
        const reference = WagerTransaction.create({
            ...baseProps,
            kind: WagerTransactionKind.Bet,
        });

        reference.markProcessed(new Date());

        const rollback = WagerTransaction.create({
            ...baseProps,
            externalTransactionId: 'externalId-2',
            kind: WagerTransactionKind.Rollback,
            referenceExternalTransactionId: reference.externalTransactionId,
            walletId: 'alternate-wallet',
        });

        expect(() => rollback.ledgerDirectionFor(reference))
            .toThrow('Reference transaction does not match');
    });

    it('should reject references with different players', () => {
        const reference = WagerTransaction.create({
            ...baseProps,
            kind: WagerTransactionKind.Bet,
        });

        reference.markProcessed(new Date());

        const rollback = WagerTransaction.create({
            ...baseProps,
            externalTransactionId: 'externalId-2',
            kind: WagerTransactionKind.Rollback,
            referenceExternalTransactionId: reference.externalTransactionId,
            playerId: 'alternate-player'
        });

        expect(() => rollback.ledgerDirectionFor(reference))
            .toThrow('Reference transaction does not match');
    });

    it('should reject references with different rounds', () => {
        const reference = WagerTransaction.create({
            ...baseProps,
            kind: WagerTransactionKind.Bet,
        });

        reference.markProcessed(new Date());

        const rollback = WagerTransaction.create({
            ...baseProps,
            externalTransactionId: 'externalId-2',
            kind: WagerTransactionKind.Rollback,
            referenceExternalTransactionId: reference.externalTransactionId,
            roundId: 'alternate-round'
        });

        expect(() => rollback.ledgerDirectionFor(reference))
            .toThrow('Reference transaction does not match');
    });

    it('should reject references with different providers', () => {
        const reference = WagerTransaction.create({
            ...baseProps,
            kind: WagerTransactionKind.Bet,
        });

        reference.markProcessed(new Date());

        const rollback = WagerTransaction.create({
            ...baseProps,
            externalTransactionId: 'externalId-2',
            kind: WagerTransactionKind.Rollback,
            referenceExternalTransactionId: reference.externalTransactionId,
            providerId: 'alternate-provider'
        });

        expect(() => rollback.ledgerDirectionFor(reference))
            .toThrow('Reference transaction does not match');
    });

    it('should reject references with different external transaction ids', () => {
        const reference = WagerTransaction.create({
            ...baseProps,
            kind: WagerTransactionKind.Bet,
        });

        reference.markProcessed(new Date());

        const rollback = WagerTransaction.create({
            ...baseProps,
            externalTransactionId: 'externalId-2',
            kind: WagerTransactionKind.Rollback,
            referenceExternalTransactionId: 'alternate-external-transaction-id',
        });

        expect(() => rollback.ledgerDirectionFor(reference))
            .toThrow('Reference transaction does not match');
    });
});

