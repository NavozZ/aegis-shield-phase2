import { Injectable, HttpStatus } from '@nestjs/common';
import { PaymentsError } from '../common/errors/payments.error';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class UssdService {
  constructor(private readonly prisma: PrismaService) {}

  // Basic in-memory state for local dev (production would use Redis)
  private sessions = new Map<string, any>();

  async handleWebhook(input: any, correlationId: string) {
    const { sessionId, msisdn, input: userInput, type } = input;
    
    // Simplistic menu logic
    let state = this.sessions.get(sessionId) || { state: 'WELCOME', msisdn };
    let message = '';
    let end = false;

    switch (state.state) {
      case 'WELCOME':
        message = 'Welcome to AEGIS USSD Banking\n1. Balance\n2. Send Money\n3. Exit';
        state.state = 'MAIN_MENU';
        break;
      case 'MAIN_MENU':
        if (userInput === '1') {
          message = 'Your balance is 5,000 LKR\n1. Back to menu';
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
        message = 'Welcome to AEGIS USSD Banking\n1. Balance\n2. Send Money\n3. Exit';
        state.state = 'MAIN_MENU';
        break;
      case 'SEND_MONEY_RECIPIENT':
        state.recipient = userInput;
        message = 'Enter amount in LKR:';
        state.state = 'SEND_MONEY_AMOUNT';
        break;
      case 'SEND_MONEY_AMOUNT':
        state.amount = userInput;
        message = `Send ${userInput} LKR to ${state.recipient}?\n1. Confirm\n2. Cancel`;
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
        // Here we would call Identity to verify PIN and Ledger to transfer
        message = 'Transfer successful. Reference: ' + require('node:crypto').randomBytes(4).toString('hex').toUpperCase();
        end = true;
        break;
      default:
        message = 'Session ended due to an error.';
        end = true;
        break;
    }

    if (end) {
      this.sessions.delete(sessionId);
    } else {
      this.sessions.set(sessionId, state);
    }

    return {
      sessionId,
      message,
      type: end ? 'release' : 'response',
    };
  }

  async handleSimulate(input: any, customerId: string, correlationId: string) {
    const { sessionId = crypto.randomUUID(), input: userInput } = input;
    
    // Delegate to the same webhook logic by mocking the msisdn mapping
    const result = await this.handleWebhook({
      sessionId,
      msisdn: '+94770000000', // Mocked
      input: userInput,
      type: 'response',
    }, correlationId);

    return {
      sessionId: result.sessionId,
      message: result.message,
      ended: result.type === 'release',
      simulated: true,
    };
  }
}
