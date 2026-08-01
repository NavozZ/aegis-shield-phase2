import {
  type InternalLedgerTransferCommand,
  type InternalLedgerTransferResult,
  type InternalTransferPreview,
  type InternalTransferPreviewResult,
} from '@aegis/contracts';
import { Injectable } from '@nestjs/common';
import {
  accountNotActiveError,
  accountNotFoundError,
  currencyMismatchError,
  insufficientFundsError,
  LedgerError,
} from '../common/errors/ledger.error';
import { PrismaService } from '../database/prisma.service';
import { JournalService } from '../ledger/journal.service';
import { serializeMinorUnits, signedBalanceMinor } from '../money/money';

type Account = {
  id: string;
  customerId: string;
  publicReference: string;
  maskedReference: string;
  currency: string;
  status: 'ACTIVE' | 'FROZEN' | 'CLOSED';
  ledgerAccountId: string;
  ledgerAccount: {
    accountClass: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';
    balanceProjection: {
      debitTotalMinor: bigint;
      creditTotalMinor: bigint;
    } | null;
  };
};

@Injectable()
export class CustomerTransferService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly journals: JournalService,
  ) {}
  private async resolve(
    input: InternalTransferPreview,
  ): Promise<{ source: Account; recipient: Account }> {
    const [source, recipient] = await Promise.all([
      this.prisma.client.customerAccount.findFirst({
        where: {
          id: input.sourceAccountId,
          customerId: input.senderCustomerId,
        },
        include: { ledgerAccount: { include: { balanceProjection: true } } },
      }),
      this.prisma.client.customerAccount.findUnique({
        where: { publicReference: input.recipientReference },
        include: { ledgerAccount: { include: { balanceProjection: true } } },
      }),
    ]);
    if (!source) throw accountNotFoundError();
    if (!recipient)
      throw new LedgerError(
        'ACCOUNT_NOT_FOUND',
        'The transfer recipient is unavailable.',
        409,
      );
    if (source.status !== 'ACTIVE' || recipient.status !== 'ACTIVE')
      throw accountNotActiveError();
    if (source.id === recipient.id)
      throw new LedgerError(
        'SELF_TRANSFER',
        'A transfer cannot use the same account.',
        409,
      );
    if (
      source.currency !== recipient.currency ||
      source.currency !== input.currency
    )
      throw currencyMismatchError();
    return { source: source as Account, recipient: recipient as Account };
  }
  private balance(account: Account): bigint {
    const projection = account.ledgerAccount.balanceProjection;
    if (!projection) throw accountNotFoundError();
    return signedBalanceMinor(
      account.ledgerAccount.accountClass,
      projection.debitTotalMinor,
      projection.creditTotalMinor,
    );
  }
  async preview(
    input: InternalTransferPreview,
  ): Promise<InternalTransferPreviewResult> {
    const { source, recipient } = await this.resolve(input);
    return {
      sourceAccountId: source.id,
      sourceMaskedReference: source.maskedReference,
      sourceBalance: {
        currency: source.currency,
        minorUnits: serializeMinorUnits(this.balance(source)),
      },
      recipientAccountId: recipient.id,
      recipientCustomerId: recipient.customerId,
      recipientMaskedReference: recipient.maskedReference,
      currency: source.currency,
    };
  }
  async transfer(
    input: InternalLedgerTransferCommand,
    correlationId: string,
  ): Promise<InternalLedgerTransferResult> {
    const { source, recipient } = await this.resolve(input);
    const amount = BigInt(input.amountMinor);
    if (amount <= 0n)
      throw new LedgerError('INVALID_REQUEST', 'The request is invalid.');
    if (this.balance(source) < amount) throw insufficientFundsError();
    const journal = await this.journals.post(
      {
        reference: input.transferReference,
        entryType: 'CUSTOMER_TRANSFER',
        currency: input.currency,
        description: 'Customer transfer',
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
        metadata: {
          transferId: input.transferId,
          transferReference: input.transferReference,
        },
      },
      correlationId,
      { type: 'SERVICE', id: 'payments' },
    );
    const senderPosting = journal.postings.find(
      (item) => item.ledgerAccountId === source.ledgerAccountId,
    );
    const recipientPosting = journal.postings.find(
      (item) => item.ledgerAccountId === recipient.ledgerAccountId,
    );
    if (!senderPosting || !recipientPosting) throw accountNotFoundError();
    const [sourceAfter, recipientAfter] = await Promise.all([
      this.prisma.client.balanceProjection.findUniqueOrThrow({
        where: { ledgerAccountId: source.ledgerAccountId },
      }),
      this.prisma.client.balanceProjection.findUniqueOrThrow({
        where: { ledgerAccountId: recipient.ledgerAccountId },
      }),
    ]);
    return {
      journalId: journal.id,
      senderPostingId: senderPosting.id,
      recipientPostingId: recipientPosting.id,
      senderAccountId: source.id,
      recipientAccountId: recipient.id,
      senderMaskedReference: source.maskedReference,
      recipientMaskedReference: recipient.maskedReference,
      senderBalanceAfter: {
        currency: source.currency,
        minorUnits: serializeMinorUnits(
          signedBalanceMinor(
            'LIABILITY',
            sourceAfter.debitTotalMinor,
            sourceAfter.creditTotalMinor,
          ),
        ),
      },
      recipientBalanceAfter: {
        currency: recipient.currency,
        minorUnits: serializeMinorUnits(
          signedBalanceMinor(
            'LIABILITY',
            recipientAfter.debitTotalMinor,
            recipientAfter.creditTotalMinor,
          ),
        ),
      },
      currency: input.currency,
      amount: { currency: input.currency, minorUnits: input.amountMinor },
      postedAt: journal.createdAt,
    };
  }
}
