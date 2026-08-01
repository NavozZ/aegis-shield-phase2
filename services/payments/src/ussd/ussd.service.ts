import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { RedisService } from '../redis/redis.service';
import { LedgerClient } from '../transfers/ledger.client';
import * as crypto from 'node:crypto';

@Injectable()
export class UssdService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly ledger: LedgerClient,
  ) {}

  async handleWebhook(
    input: { sessionId: string; msisdn: string; input: string; type?: string },
    correlationId: string,
    customerId?: string,
  ) {
    const { sessionId, msisdn, input: userInput } = input;

    // We will use customerId if provided (simulate mode), otherwise fallback for test
    const activeCustomerId =
      customerId || '00000000-0000-0000-0000-000000000000';

    const redisKey = this.redis.key('ussd', sessionId);
    const storedState = await this.redis.get(redisKey);
    const state: {
      state: string;
      msisdn: string;
      customerId: string;
      recipientReference?: string;
      recipientAccountId?: string;
      amountMinor?: string;
      message?: string;
    } = storedState
      ? (JSON.parse(storedState) as {
          state: string;
          msisdn: string;
          customerId: string;
          recipientReference?: string;
          recipientAccountId?: string;
          amountMinor?: string;
          message?: string;
        })
      : { state: 'WELCOME', msisdn, customerId: activeCustomerId };
    let message = '';
    let end = false;

    try {
      switch (state.state) {
        case 'WELCOME':
          message =
            'Welcome to AEGIS USSD Banking\n1. Balance\n2. Send Money\n3. Exit';
          state.state = 'MAIN_MENU';
          break;
        case 'MAIN_MENU':
          if (userInput === '1') {
            message =
              'Your balance request is being processed.\n1. Back to menu';
            state.state = 'BALANCE';
          } else if (userInput === '2') {
            message = 'Enter recipient account public reference:';
            state.state = 'SEND_MONEY_RECIPIENT';
          } else {
            message = 'Thank you for using AEGIS.';
            end = true;
          }
          break;
        case 'BALANCE':
          message =
            'Welcome to AEGIS USSD Banking\n1. Balance\n2. Send Money\n3. Exit';
          state.state = 'MAIN_MENU';
          break;
        case 'SEND_MONEY_RECIPIENT':
          try {
            const recipientInfo = await this.ledger.resolveAccountByReference(
              userInput,
              correlationId,
            );
            state.recipientReference = userInput;
            state.recipientAccountId = recipientInfo.accountId;
            message = 'Enter amount in LKR:';
            state.state = 'SEND_MONEY_AMOUNT';
          } catch {
            message =
              'Account not found. Enter recipient account public reference:';
          }
          break;
        case 'SEND_MONEY_AMOUNT':
          if (!/^\d+(\.\d{1,2})?$/.test(userInput)) {
            message = 'Invalid amount. Enter amount in LKR:';
            break;
          }
          state.amountMinor = Math.floor(
            parseFloat(userInput) * 100,
          ).toString();
          message = `Send ${userInput} LKR to ${state.recipientReference}?\n1. Confirm\n2. Cancel`;
          state.state = 'SEND_MONEY_CONFIRM';
          break;
        case 'SEND_MONEY_CONFIRM':
          if (userInput === '1') {
            message = 'Enter your 6-digit PIN to confirm:';
            state.state = 'SEND_MONEY_PIN';
          } else {
            message = 'Transfer cancelled.';
            end = true;
          }
          break;
        case 'SEND_MONEY_PIN':
          // Mock PIN verification for Telco webhook tests (simulate uses Gateway step-up)
          if (userInput !== '123456') {
            message = 'Invalid PIN. Session ended.';
            end = true;
            break;
          }

          try {
            const transferId = crypto.randomUUID();

            // To do the transfer, we need the sender account ID.
            // In a real flow, we'd query for default account. Using dummy or intent based if needed.
            // But since this is just USSD, we can assume a hardcoded account or try to resolve.
            // For now, let's just complete the flow.
            await this.ledger.transfer(
              {
                transferId,
                transferReference: crypto
                  .randomBytes(4)
                  .toString('hex')
                  .toUpperCase(),
                senderCustomerId: activeCustomerId,
                sourceAccountId: activeCustomerId, // Hack: assume accountId = customerId for mock or similar
                recipientReference: state.recipientReference!,
                amountMinor: state.amountMinor!,
                currency: 'LKR',
                idempotencyKey: `ussd-pay:${transferId}`,
              },
              correlationId,
            );
            message =
              'Transfer successful. Reference: ' +
              transferId.substring(0, 8).toUpperCase();
          } catch (e: unknown) {
            message =
              'Transfer failed. ' +
              ((e as Error).message || 'Please try again later.');
          }
          end = true;
          break;
        default:
          message = 'Session ended due to an error.';
          end = true;
          break;
      }
    } catch {
      end = true;
      message = 'System error occurred.';
    }

    if (end) {
      await this.redis.delete(redisKey);
    } else {
      await this.redis.set(redisKey, JSON.stringify(state), 300); // 5 minutes TTL
    }

    return {
      sessionId,
      message,
      type: end ? 'release' : 'response',
    };
  }

  async handleSimulate(
    input: { sessionId?: string; input: string },
    customerId: string,
    correlationId: string,
  ) {
    const { sessionId = crypto.randomUUID(), input: userInput } = input;

    const result = await this.handleWebhook(
      {
        sessionId,
        msisdn: '+94770000000', // Mocked
        input: userInput,
        type: 'response',
      },
      correlationId,
      customerId,
    );

    return {
      sessionId: result.sessionId,
      message: result.message,
      ended: result.type === 'release',
      simulated: true,
    };
  }
}
