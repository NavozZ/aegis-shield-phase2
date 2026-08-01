import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import { z } from 'zod';
import type { RequestContext } from '../../common/http/request-context';
import { AuthEventService } from '../events/auth-event.service';
import { SessionService } from './session.service';
const command = z
  .object({
    controlId: z.uuid(),
    reasonCode: z.string().regex(/^[A-Z0-9_]{3,64}$/u),
  })
  .strict();
@Controller('internal/v1/sessions')
export class SessionControlController {
  constructor(
    private readonly sessions: SessionService,
    private readonly events: AuthEventService,
  ) {}
  @Post('revoke') @HttpCode(HttpStatus.OK) async revoke(
    @Headers('x-aegis-session-id') sessionId: string | undefined,
    @Body() body: unknown,
    @Req() request: RequestContext,
  ) {
    const id = z.string().min(32).max(256).parse(sessionId);
    const input = command.parse(body);
    const userId = await this.sessions.revokeTrusted(id);
    if (userId)
      await this.events.record({
        userId,
        eventType: 'SESSION_CONTROL',
        outcome: 'ACCEPTED',
        correlationId: request.correlationId,
        metadata: { controlId: input.controlId, reasonCode: input.reasonCode },
      });
    return { revoked: Boolean(userId) };
  }
}
