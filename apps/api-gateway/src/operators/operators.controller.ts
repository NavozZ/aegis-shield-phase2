import {
  applyControlRequestSchema,
  releaseControlRequestSchema,
} from '@aegis/contracts';
import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { readCookie, serializeCookie } from '../auth/cookies';
import { requireCsrfToken } from '../common/http/csrf';
import type { RequestContext } from '../common/http/request-context';
import { GATEWAY_CONFIG, type GatewayConfig } from '../config/gateway.config';
import { RiskClient } from '../risk/risk.client';
const bootstrapResponse = z
  .object({
    sessionToken: z.string(),
    csrfToken: z.string(),
    operatorId: z.string(),
    role: z.literal('SECURITY_OPERATOR'),
    expiresAt: z.iso.datetime(),
  })
  .passthrough();
const bootstrapRequest = z
  .object({ accessToken: z.string().min(16).max(256) })
  .strict();
const incidentUpdate = z
  .object({
    status: z
      .enum([
        'OPEN',
        'INVESTIGATING',
        'CONTAINED',
        'RESOLVED',
        'FALSE_POSITIVE',
      ])
      .optional(),
    assignedTo: z.string().min(8).max(128).optional(),
    note: z.string().trim().min(3).max(1000).optional(),
    resolutionReason: z.string().trim().min(8).max(500).optional(),
  })
  .strict();
@Controller('api/v1/security-ops')
export class OperatorsController {
  constructor(
    private readonly risk: RiskClient,
    @Inject(GATEWAY_CONFIG) private readonly config: GatewayConfig,
  ) {}
  private session(request: RequestContext) {
    return readCookie(
      request.header('cookie'),
      this.config.operatorSessionCookieName,
    );
  }
  private auth(request: RequestContext, mutation = false, csrfHeader?: string) {
    const session = this.session(request);
    const csrf = mutation
      ? requireCsrfToken(
          request.header('cookie'),
          this.config.operatorCsrfCookieName,
          csrfHeader,
        )
      : undefined;
    return { session, csrf };
  }
  @Post('sign-in') async signIn(
    @Body() body: unknown,
    @Req() request: RequestContext,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = bootstrapResponse.parse(
      await this.risk.operator(
        '/bootstrap',
        'POST',
        request,
        { session: '' },
        bootstrapRequest.parse(body),
      ),
    );
    const maxAge = Math.max(
      0,
      Math.floor((new Date(result.expiresAt).getTime() - Date.now()) / 1000),
    );
    const secure = this.config.nodeEnvironment === 'production';
    response.setHeader('set-cookie', [
      serializeCookie(
        this.config.operatorSessionCookieName,
        result.sessionToken,
        { httpOnly: true, secure, maxAgeSeconds: maxAge },
      ),
      serializeCookie(this.config.operatorCsrfCookieName, result.csrfToken, {
        httpOnly: false,
        secure,
        maxAgeSeconds: maxAge,
      }),
    ]);
    return {
      operatorId: result.operatorId,
      role: result.role,
      expiresAt: result.expiresAt,
    };
  }
  @Get('session') sessionInfo(@Req() request: RequestContext) {
    return this.risk.operator('/validate', 'POST', request, this.auth(request));
  }
  @Post('logout') async logout(
    @Req() request: RequestContext,
    @Res({ passthrough: true }) response: Response,
    @Headers('x-csrf-token') csrf?: string,
  ) {
    const result = await this.risk.operator(
      '/logout',
      'POST',
      request,
      this.auth(request, true, csrf),
    );
    const secure = this.config.nodeEnvironment === 'production';
    response.setHeader('set-cookie', [
      serializeCookie(this.config.operatorSessionCookieName, '', {
        httpOnly: true,
        secure,
        maxAgeSeconds: 0,
      }),
      serializeCookie(this.config.operatorCsrfCookieName, '', {
        httpOnly: false,
        secure,
        maxAgeSeconds: 0,
      }),
    ]);
    return result;
  }
  @Get('overview') overview(@Req() request: RequestContext) {
    return this.risk.operator('/overview', 'GET', request, this.auth(request));
  }
  @Get('events') events(
    @Req() request: RequestContext,
    @Query('cursor') cursor?: string,
  ) {
    return this.risk.operator(
      `/events${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`,
      'GET',
      request,
      this.auth(request),
    );
  }
  @Get('assessments') assessments(
    @Req() request: RequestContext,
    @Query('cursor') cursor?: string,
  ) {
    return this.risk.operator(
      `/assessments${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`,
      'GET',
      request,
      this.auth(request),
    );
  }
  @Get('controls') controls(
    @Req() request: RequestContext,
    @Query('cursor') cursor?: string,
  ) {
    return this.risk.operator(
      `/controls${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`,
      'GET',
      request,
      this.auth(request),
    );
  }
  @Get('incidents') incidents(
    @Req() request: RequestContext,
    @Query('cursor') cursor?: string,
  ) {
    return this.risk.operator(
      `/incidents${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`,
      'GET',
      request,
      this.auth(request),
    );
  }
  @Get('incidents/:id') incident(
    @Req() request: RequestContext,
    @Param('id') id: string,
  ) {
    return this.risk.operator(
      `/incidents/${z.uuid().parse(id)}`,
      'GET',
      request,
      this.auth(request),
    );
  }
  @Post('controls') apply(
    @Req() request: RequestContext,
    @Body() body: unknown,
    @Headers('x-csrf-token') csrf?: string,
  ) {
    return this.risk.operator(
      '/controls',
      'POST',
      request,
      this.auth(request, true, csrf),
      applyControlRequestSchema.parse(body),
    );
  }
  @Post('controls/:id/release') release(
    @Req() request: RequestContext,
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('x-csrf-token') csrf?: string,
  ) {
    return this.risk.operator(
      `/controls/${z.uuid().parse(id)}/release`,
      'POST',
      request,
      this.auth(request, true, csrf),
      releaseControlRequestSchema.parse(body),
    );
  }
  @Post('incidents/:id') updateIncident(
    @Req() request: RequestContext,
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('x-csrf-token') csrf?: string,
  ) {
    return this.risk.operator(
      `/incidents/${z.uuid().parse(id)}`,
      'POST',
      request,
      this.auth(request, true, csrf),
      incidentUpdate.parse(body),
    );
  }
}
