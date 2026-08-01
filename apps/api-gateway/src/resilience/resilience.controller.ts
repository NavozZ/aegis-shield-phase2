import {
  operatorAcknowledgementRequestSchema,
  recordPlannedDrillRequestSchema,
} from '@aegis/contracts';
import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Inject,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { z } from 'zod';
import { readCookie } from '../auth/cookies';
import { requireCsrfToken } from '../common/http/csrf';
import type { RequestContext } from '../common/http/request-context';
import { GATEWAY_CONFIG, type GatewayConfig } from '../config/gateway.config';
import { RiskClient } from '../risk/risk.client';
import { ResilienceClient } from './resilience.client';

/*
 * Recovery operations, browser-facing.
 *
 * Authorization is not re-implemented here. The Risk service already owns
 * security-operator sessions, and every route below validates the operator's
 * session against it before touching Resilience — a second session store would
 * be a second place to get session expiry, revocation and CSRF wrong.
 *
 * The route surface is deliberately small and read-heavy. An operator can look
 * at recovery evidence, plan a drill and acknowledge a failed one. There is no
 * route that starts a backup, starts a restore, names a file, names a database
 * or supplies a key, because none of those belong to a browser.
 */

const identifierSchema = z.string().regex(/^[A-Za-z0-9:_-]{8,128}$/u);
// Deliberately the same bounds as the service's own query contract. A gateway
// that accepted a wider range would only be forwarding requests it knows will
// be rejected one hop later.
const historyQuerySchema = z
  .object({
    cursor: identifierSchema.optional(),
    limit: z.coerce.number().int().min(1).max(50).optional(),
    state: z
      .enum([
        'PLANNED',
        'RUNNING',
        'BACKUP_CREATED',
        'RESTORE_VERIFIED',
        'RECONCILIATION_PASSED',
        'PASSED',
        'FAILED',
        'CLEANED_UP',
      ])
      .optional(),
  })
  .strict();

@Controller('api/v1/security-ops/resilience')
export class ResilienceController {
  constructor(
    private readonly risk: RiskClient,
    private readonly resilience: ResilienceClient,
    @Inject(GATEWAY_CONFIG) private readonly config: GatewayConfig,
  ) {}

  /**
   * Confirms the caller is a signed-in security operator and returns their id.
   *
   * Mutations additionally require the double-submit CSRF token, so a malicious
   * page cannot acknowledge a failed drill using an operator's ambient cookie.
   */
  private async operator(
    request: RequestContext,
    mutation = false,
    csrfHeader?: string,
  ): Promise<string> {
    const session = readCookie(
      request.header('cookie'),
      this.config.operatorSessionCookieName,
    );
    const csrf = mutation
      ? requireCsrfToken(
          request.header('cookie'),
          this.config.operatorCsrfCookieName,
          csrfHeader,
        )
      : undefined;
    const identity = z
      .object({
        operatorId: identifierSchema,
        role: z.literal('SECURITY_OPERATOR'),
      })
      .loose()
      .safeParse(
        await this.risk.operator('/validate', 'POST', request, {
          session,
          csrf,
        }),
      );
    // A session that validates but is not a security operator is refused here
    // rather than passed on with a hopeful role check downstream.
    if (!identity.success) {
      throw new ForbiddenException({
        error: {
          code: 'OPERATOR_UNAUTHORIZED',
          message: 'Security operator authentication is required.',
        },
      });
    }
    return identity.data.operatorId;
  }

  @Get('readiness') async readiness(@Req() request: RequestContext) {
    await this.operator(request);
    return this.resilience.readiness(request);
  }

  @Get('drills') async drills(
    @Req() request: RequestContext,
    @Query() query: unknown,
  ) {
    await this.operator(request);
    const parsed = historyQuerySchema.parse(query ?? {});
    const search = new URLSearchParams();
    if (parsed.cursor) search.set('cursor', parsed.cursor);
    if (parsed.limit) search.set('limit', String(parsed.limit));
    if (parsed.state) search.set('state', parsed.state);
    const suffix = search.size > 0 ? `?${search.toString()}` : '';
    return this.resilience.history(request, suffix);
  }

  @Get('drills/:drillId') async drill(
    @Req() request: RequestContext,
    @Param('drillId') drillId: string,
  ) {
    await this.operator(request);
    return this.resilience.drill(request, identifierSchema.parse(drillId));
  }

  @Get('drills/:drillId/events') async events(
    @Req() request: RequestContext,
    @Param('drillId') drillId: string,
  ) {
    await this.operator(request);
    return this.resilience.events(request, identifierSchema.parse(drillId));
  }

  @Post('drills') async plan(
    @Req() request: RequestContext,
    @Body() body: unknown,
    @Headers('x-csrf-token') csrf?: string,
  ) {
    const operatorId = await this.operator(request, true, csrf);
    return this.resilience.recordPlanned(
      request,
      operatorId,
      recordPlannedDrillRequestSchema.parse(body),
    );
  }

  @Post('drills/:drillId/acknowledge') async acknowledge(
    @Req() request: RequestContext,
    @Param('drillId') drillId: string,
    @Body() body: unknown,
    @Headers('x-csrf-token') csrf?: string,
  ) {
    const operatorId = await this.operator(request, true, csrf);
    return this.resilience.acknowledge(
      request,
      identifierSchema.parse(drillId),
      operatorId,
      operatorAcknowledgementRequestSchema.parse(body).reason,
    );
  }
}
