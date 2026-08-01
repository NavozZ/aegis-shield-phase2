import {
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { RISK_CONFIG, type RiskConfig } from '../common/config/risk.config';
import { sha256, timingSafeStringEqual } from '../common/security/security';
import { RedisService } from '../redis/redis.service';
export interface OperatorIdentity {
  operatorId: string;
  role: 'SECURITY_OPERATOR';
  createdAt: string;
  expiresAt: string;
}
@Injectable()
export class OperatorService {
  constructor(
    private readonly redis: RedisService,
    @Inject(RISK_CONFIG) private readonly config: RiskConfig,
  ) {}
  async bootstrap(accessToken: string) {
    if (
      !this.config.operatorBootstrapToken ||
      !timingSafeStringEqual(accessToken, this.config.operatorBootstrapToken)
    )
      throw new UnauthorizedException();
    const sessionToken = randomBytes(32).toString('base64url');
    const csrfToken = randomBytes(32).toString('base64url');
    const now = Date.now();
    const identity: OperatorIdentity = {
      operatorId: 'operator:development-security',
      role: 'SECURITY_OPERATOR',
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(
        now + this.config.operatorSessionTtlSeconds * 1000,
      ).toISOString(),
    };
    await this.redis.client.set(
      this.redis.key('operator-session', sha256(sessionToken)),
      JSON.stringify({ ...identity, csrfHash: sha256(csrfToken) }),
      { EX: this.config.operatorSessionTtlSeconds },
    );
    return { sessionToken, csrfToken, ...identity };
  }
  async validate(
    sessionToken: string,
    csrfToken?: string,
    mutation = false,
  ): Promise<OperatorIdentity> {
    const raw = await this.redis.client.get(
      this.redis.key('operator-session', sha256(sessionToken)),
    );
    if (!raw) throw new UnauthorizedException();
    const value = JSON.parse(raw) as OperatorIdentity & { csrfHash: string };
    if (
      value.role !== 'SECURITY_OPERATOR' ||
      new Date(value.expiresAt) <= new Date()
    )
      throw new UnauthorizedException();
    if (
      mutation &&
      (!csrfToken || !timingSafeStringEqual(sha256(csrfToken), value.csrfHash))
    )
      throw new ForbiddenException();
    return {
      operatorId: value.operatorId,
      role: value.role,
      createdAt: value.createdAt,
      expiresAt: value.expiresAt,
    };
  }
  async revoke(sessionToken: string) {
    await this.redis.client.del(
      this.redis.key('operator-session', sha256(sessionToken)),
    );
    return { revoked: true as const };
  }
}
