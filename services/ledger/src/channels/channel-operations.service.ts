import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { JournalService } from '../ledger/journal.service';
import {
  accountNotActiveError,
  accountNotFoundError,
  insufficientFundsError,
  LedgerError,
} from '../common/errors/ledger.error';
import { signedBalanceMinor } from '../money/money';

@Injectable()
export class ChannelOperationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly journals: JournalService,
  ) {}

  async resolveAccountByReference(publicReference: string) {
    const account = await this.prisma.client.customerAccount.findUnique({
      where: { publicReference },
      select: { id: true, customerId: true, maskedReference: true },
    });

    if (!account) throw accountNotFoundError();

    return {
      accountId: account.id,
      customerId: account.customerId,
      maskedReference: account.maskedReference,
    };
  }

  private async getCustomerAccount(accountId: string) {
    const acc = await this.prisma.client.customerAccount.findUnique({
      where: { id: accountId },
      include: { ledgerAccount: { include: { balanceProjection: true } } },
    });
    if (!acc) throw accountNotFoundError();
    if (acc.status !== 'ACTIVE') throw accountNotActiveError();
    return acc;
  }

  private async getSystemAccount(type: 'AGENT_FLOAT', currency: string) {
    const acc = await this.prisma.client.ledgerAccount.findFirst({
      where: { systemAccountType: type, currency },
      include: { balanceProjection: true },
    });
    if (!acc)
      throw new LedgerError('INTERNAL_ERROR', 'System account not found', 500);
    return acc;
  }

  private balance(account: {
    accountClass: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';
    balanceProjection: {
      debitTotalMinor: bigint;
      creditTotalMinor: bigint;
    } | null;
  }): bigint {
    const projection = account.balanceProjection;
    if (!projection) throw accountNotFoundError();
    return signedBalanceMinor(
      account.accountClass,
      projection.debitTotalMinor,
      projection.creditTotalMinor,
    );
  }

  async qrPayment(
    input: {
      sourceAccountId: string;
      recipientAccountId: string;
      currency: string;
      amountMinor: string;
      transferReference: string;
      transferId: string;
      idempotencyKey: string;
    },
    correlationId: string,
  ) {
    const [source, recipient] = await Promise.all([
      this.getCustomerAccount(input.sourceAccountId),
      this.getCustomerAccount(input.recipientAccountId),
    ]);

    if (source.id === recipient.id)
      throw new LedgerError('SELF_TRANSFER', 'Cannot transfer to self', 409);
    if (
      source.currency !== recipient.currency ||
      source.currency !== input.currency
    )
      throw new LedgerError('CURRENCY_MISMATCH', 'Currency mismatch', 409);

    const amount = BigInt(input.amountMinor);
    if (amount <= 0n)
      throw new LedgerError('INVALID_REQUEST', 'Invalid amount', 400);
    if (this.balance(source.ledgerAccount) < amount)
      throw insufficientFundsError();

    const journal = await this.journals.post(
      {
        reference: input.transferReference,
        entryType: 'QR_PAYMENT',
        currency: input.currency,
        description: 'QR Payment',
        idempotencyKey: input.idempotencyKey,
        postings: [
          {
            ledgerAccountId: source.ledgerAccountId,
            direction: 'DEBIT',
            amountMinor: input.amountMinor,
          },
          {
            ledgerAccountId: recipient.ledgerAccountId,
            direction: 'CREDIT',
            amountMinor: input.amountMinor,
          },
        ],
        metadata: { transferId: input.transferId },
      },
      correlationId,
      { type: 'SERVICE', id: 'payments' },
    );

    return { journalId: journal.id };
  }

  async agentCashIn(
    input: {
      customerAccountId: string;
      currency: string;
      amountMinor: string;
      operationReference: string;
      operationId: string;
      agentId: string;
      idempotencyKey: string;
    },
    correlationId: string,
  ) {
    const customer = await this.getCustomerAccount(input.customerAccountId);
    const float = await this.getSystemAccount('AGENT_FLOAT', input.currency);

    const amount = BigInt(input.amountMinor);
    if (amount <= 0n)
      throw new LedgerError('INVALID_REQUEST', 'Invalid amount', 400);

    const journal = await this.journals.post(
      {
        reference: input.operationReference,
        entryType: 'AGENT_CASH_IN',
        currency: input.currency,
        description: 'Agent Cash In',
        idempotencyKey: input.idempotencyKey,
        postings: [
          {
            ledgerAccountId: float.id,
            direction: 'DEBIT',
            amountMinor: input.amountMinor,
          },
          {
            ledgerAccountId: customer.ledgerAccountId,
            direction: 'CREDIT',
            amountMinor: input.amountMinor,
          },
        ],
        metadata: { operationId: input.operationId, agentId: input.agentId },
      },
      correlationId,
      { type: 'SERVICE', id: 'payments' },
    );

    return { journalId: journal.id };
  }

  async agentCashOut(
    input: {
      customerAccountId: string;
      currency: string;
      amountMinor: string;
      operationReference: string;
      operationId: string;
      agentId: string;
      idempotencyKey: string;
    },
    correlationId: string,
  ) {
    const customer = await this.getCustomerAccount(input.customerAccountId);
    const float = await this.getSystemAccount('AGENT_FLOAT', input.currency);

    const amount = BigInt(input.amountMinor);
    if (amount <= 0n)
      throw new LedgerError('INVALID_REQUEST', 'Invalid amount', 400);
    if (this.balance(customer.ledgerAccount) < amount)
      throw insufficientFundsError();

    const journal = await this.journals.post(
      {
        reference: input.operationReference,
        entryType: 'AGENT_CASH_OUT',
        currency: input.currency,
        description: 'Agent Cash Out',
        idempotencyKey: input.idempotencyKey,
        postings: [
          {
            ledgerAccountId: customer.ledgerAccountId,
            direction: 'DEBIT',
            amountMinor: input.amountMinor,
          },
          {
            ledgerAccountId: float.id,
            direction: 'CREDIT',
            amountMinor: input.amountMinor,
          },
        ],
        metadata: { operationId: input.operationId, agentId: input.agentId },
      },
      correlationId,
      { type: 'SERVICE', id: 'payments' },
    );

    return { journalId: journal.id };
  }
}
