import { sessionResponseSchema } from '@aegis/contracts';
import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { readCookie } from '../auth/cookies';
import { IDENTITY_ENDPOINTS, IdentityClient } from '../auth/identity.client';
import type { RequestContext } from '../common/http/request-context';
import { GATEWAY_CONFIG, type GatewayConfig } from '../config/gateway.config';

export function unauthenticatedError(): HttpException {
  return new HttpException(
    {
      error: {
        code: 'UNAUTHENTICATED',
        message: 'Authentication is required.',
      },
    },
    HttpStatus.UNAUTHORIZED,
  );
}

/**
 * Resolves the acting customer from the session cookie by asking the Identity
 * service.
 *
 * This is the only source of a customer identifier for account routes. A
 * customer identifier supplied in a request body, query string or header is
 * never consulted, so a browser cannot act on another customer's behalf.
 */
@Injectable()
export class SessionCustomerResolver {
  constructor(
    private readonly identity: IdentityClient,
    @Inject(GATEWAY_CONFIG) private readonly config: GatewayConfig,
  ) {}

  async resolve(request: RequestContext): Promise<string> {
    const sessionId = readCookie(
      request.header('cookie'),
      this.config.sessionCookieName,
    );
    if (!sessionId) throw unauthenticatedError();

    const session = await this.identity.request<unknown>(
      IDENTITY_ENDPOINTS.session,
      'GET',
      request,
      undefined,
      { sessionId },
    );
    const parsed = sessionResponseSchema.safeParse(session);
    if (!parsed.success) throw unauthenticatedError();
    return parsed.data.user.id;
  }
}
