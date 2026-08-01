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
  LEDGER_CONFIG,
  type LedgerConfig,
} from '../common/config/ledger.config';

/**
 * Ledger's SABCL recipient.
 *
 * Decryption happens here and nowhere earlier in the path. The router that
 * forwarded the envelope holds no key that opens it.
 */
@Injectable()
export class LedgerSabclService implements OnModuleDestroy {
  private readonly logger = new Logger('ledger-sabcl');
  private readonly runtime: SabclRecipientRuntime | null;

  constructor(@Inject(LEDGER_CONFIG) config: LedgerConfig) {
    this.runtime = createSabclRecipientRuntime({
      service: 'ledger',
      environmentPrefix: 'SABCL_LEDGER',
      selfUrl: `http://${config.host}:${config.port}`,
      internalToken: config.internalToken,
      nodeEnvironment: config.nodeEnvironment,
      redisUrl:
        process.env.REDIS_URL?.trim() ||
        'redis://:aegis-local-redis-change-me@127.0.0.1:6379/0',
      redisPrefix:
        process.env.SABCL_REDIS_PREFIX?.trim() || 'aegis:sabcl:ledger:',
      dispatchTimeoutMs: 5_000,
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

  /**
   * Handles a forwarded envelope.
   *
   * When SABCL is off the endpoint reports itself unconfigured rather than
   * falling back to an unauthenticated path.
   */
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
