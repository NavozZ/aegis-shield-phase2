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
  IDENTITY_CONFIG,
  type IdentityConfig,
} from '../common/config/identity.config';

/**
 * Identity's SABCL recipient.
 *
 * Only the session and transfer step-up capabilities are exposed. Onboarding,
 * PIN creation, passkey registration and logout are deliberately absent from
 * the catalogue: those are browser-driven flows that must keep arriving through
 * the gateway's authenticated, CSRF-protected path, and giving them a SABCL
 * route would create a second way in.
 */
@Injectable()
export class IdentitySabclService implements OnModuleDestroy {
  private readonly logger = new Logger('identity-sabcl');
  private readonly runtime: SabclRecipientRuntime | null;

  constructor(@Inject(IDENTITY_CONFIG) config: IdentityConfig) {
    this.runtime = createSabclRecipientRuntime({
      service: 'identity',
      environmentPrefix: 'SABCL_IDENTITY',
      selfUrl: `http://${config.host}:${config.port}`,
      internalToken: config.internalToken,
      nodeEnvironment: config.nodeEnvironment,
      redisUrl: config.redisUrl,
      // Namespaced away from the identity service's own session keys so SABCL
      // replay state cannot collide with authentication state.
      redisPrefix: `${config.redisKeyPrefix}sabcl:`,
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
