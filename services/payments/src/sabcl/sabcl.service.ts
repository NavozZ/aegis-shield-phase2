import {
  createSabclRecipientRuntime,
  type SabclRecipientOutcome,
  type SabclRecipientRuntime,
} from '@aegis/sabcl';
import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
} from '@nestjs/common';
import {
  PAYMENTS_CONFIG,
  type PaymentsConfig,
} from '../common/config/payments.config';

/**
 * Payments' SABCL recipient.
 *
 * The transfer orchestration path is the most sensitive traffic in the system:
 * it carries amounts, recipient references and PIN authorisation. All of it
 * travels inside `ct`, so the router that forwards a transfer confirmation
 * cannot tell it from an account balance read.
 */
@Injectable()
export class PaymentsSabclService implements OnModuleDestroy {
  private readonly logger = new Logger('payments-sabcl');
  private readonly runtime: SabclRecipientRuntime | null;

  constructor(@Inject(PAYMENTS_CONFIG) config: PaymentsConfig) {
    this.runtime = createSabclRecipientRuntime({
      service: 'payments',
      environmentPrefix: 'SABCL_PAYMENTS',
      selfUrl: `http://${config.host}:${config.port}`,
      internalToken: config.internalToken,
      nodeEnvironment: config.nodeEnvironment,
      redisUrl:
        process.env.REDIS_URL?.trim() ||
        'redis://:aegis-local-redis-change-me@127.0.0.1:6379/0',
      redisPrefix:
        process.env.SABCL_REDIS_PREFIX?.trim() || 'aegis:sabcl:payments:',
      dispatchTimeoutMs: config.httpTimeoutMs,
    });
    if (this.runtime) {
      this.logger.log(
        JSON.stringify({
          event: 'sabcl.recipient.ready',
          mode: this.runtime.environment.mode,
          keyId: this.runtime.environment.keyring.own.keyId,
        }),
      );
    }
  }

  get enabled(): boolean {
    return this.runtime !== null;
  }

  get mode(): string {
    return this.runtime?.environment.mode ?? 'off';
  }

  async onModuleDestroy(): Promise<void> {
    await this.runtime?.shutdown();
  }

  async handle(envelope: unknown): Promise<SabclRecipientOutcome> {
    if (!this.runtime) {
      return { status: 503, body: { error: { code: 'SABCL_NOT_CONFIGURED' } } };
    }
    return this.runtime.handle(envelope);
  }

  async ready(): Promise<boolean> {
    return this.runtime ? this.runtime.ready() : false;
  }
}
