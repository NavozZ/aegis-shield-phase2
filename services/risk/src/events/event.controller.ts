import { securityEventV1Schema } from '@aegis/contracts';
import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { PublicRoute } from '../common/security/public.decorator';
import { EventService } from './event.service';
@Controller('internal/v1/events')
export class EventController {
  constructor(private readonly events: EventService) {}
  @PublicRoute() @Post() @HttpCode(HttpStatus.ACCEPTED) ingest(
    @Body() body: unknown,
    @Headers('x-aegis-source-token') token?: string,
  ) {
    const sourceToken = token?.trim() || '';
    this.events.authenticateSourceToken(sourceToken);
    return this.events.ingest(securityEventV1Schema.parse(body), sourceToken);
  }
}
