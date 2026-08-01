import {
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { RISK_CONFIG, type RiskConfig } from '../common/config/risk.config';
@Injectable()
export class IdentityControlClient {
  constructor(@Inject(RISK_CONFIG) private readonly config: RiskConfig) {}
  async revokeSession(
    sessionId: string,
    controlId: string,
    reasonCode: string,
  ): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.config.identityTimeoutMs,
    );
    try {
      const response = await fetch(
        new URL('/internal/v1/sessions/revoke', this.config.identityServiceUrl),
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-aegis-internal-token': this.config.identityInternalToken,
            'x-aegis-session-id': sessionId,
          },
          body: JSON.stringify({ controlId, reasonCode }),
          signal: controller.signal,
        },
      );
      if (!response.ok) throw new Error('Identity rejected revocation.');
    } catch {
      throw new ServiceUnavailableException({
        error: {
          code: 'IDENTITY_CONTROL_UNAVAILABLE',
          message: 'The security control could not be fully applied.',
        },
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}
