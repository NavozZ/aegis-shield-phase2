import { Controller, Get, HttpException, HttpStatus } from '@nestjs/common';
import { LedgerClient } from '../accounts/ledger.client';
import { PaymentsClient } from '../transfers/payments.client';
import { IdentityClient } from '../auth/identity.client';
import {
  APPLICATION_NAME,
  APPLICATION_VERSION,
  DEFAULT_ENVIRONMENT,
} from '../constants/application.constants';
import type { HealthResponse } from './health.types';

@Controller('health')
export class HealthController {
  constructor(
    private readonly identity: IdentityClient,
    private readonly ledger: LedgerClient,
    private readonly payments: PaymentsClient,
  ) {}

  @Get()
  getHealth(): HealthResponse {
    return {
      status: 'ok',
      service: APPLICATION_NAME,
      version: APPLICATION_VERSION,
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV?.trim() || DEFAULT_ENVIRONMENT,
    };
  }

  @Get('ready')
  async getReadiness(): Promise<{
    status: 'ready';
    dependencies: { identity: 'up'; ledger: 'up'; payments: 'up' };
  }> {
    const [identityReady, ledgerReady, paymentsReady] = await Promise.all([
      this.identity.ready(),
      this.ledger.ready(),
      this.payments.ready(),
    ]);
    if (!identityReady) {
      throw new HttpException(
        { error: { code: 'IDENTITY_UNAVAILABLE' } },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    if (!ledgerReady) {
      throw new HttpException(
        { error: { code: 'LEDGER_UNAVAILABLE' } },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    if (!paymentsReady) {
      throw new HttpException(
        { error: { code: 'PAYMENTS_UNAVAILABLE' } },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return {
      status: 'ready',
      dependencies: { identity: 'up', ledger: 'up', payments: 'up' },
    };
  }
}
