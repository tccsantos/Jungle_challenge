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
        expect(transactionRollback.ledgerDirectionFor(transaction)).toBe(LedgerDirection.Credit);
    });

    it('should not allow transitions of Processed, Failed and Rejected status', () => {
        const transaction = WagerTransaction.create({
            ...baseProps,
            kind: WagerTransactionKind.Win
        });
        transaction.markProcessed(new Date())

        expect(() =>
            transaction.fail(FailureCode.InternalError)
        ).toThrow(new InvalidTransactionStateError(transaction.status));
    });

    it('should reject referencens with unmatched values, wallets and currency', () => {
        const transaction = WagerTransaction.create({
            ...baseProps,
            kind: WagerTransactionKind.Win
        });
        transaction.markProcessed(new Date())
        const transactionRollback = WagerTransaction.create({
            ...baseProps,
            externalTransactionId: 'externalId-2',
            kind: WagerTransactionKind.Rollback,
            referenceExternalTransactionId: transaction.externalTransactionId,
            money: Money.fromDecimal('100.00', 'USD')
        });

        expect(() =>
            transactionRollback.ledgerDirectionFor()
        ).toThrow('Reference transaction is required');
    });
});

