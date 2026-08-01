import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { AgentService } from './agent.service';

@Controller('internal')
export class AgentController {
  constructor(private readonly agentService: AgentService) {}

  @Post('agent/cash-in/preview')
  @HttpCode(HttpStatus.OK)
  async previewCashIn(
    @Body() body: { agentId: string; agentReference: string; customerReference: string; amountMinor: string; currency: string },
    @Req() request: Request,
  ) {
    const correlationId = (request.headers['x-correlation-id'] as string) || crypto.randomUUID();
    return this.agentService.preview({ ...body, operationType: 'AGENT_CASH_IN' }, correlationId);
  }

  @Post('agent/cash-out/preview')
  @HttpCode(HttpStatus.OK)
  async previewCashOut(
    @Body() body: { agentId: string; agentReference: string; customerReference: string; amountMinor: string; currency: string },
    @Req() request: Request,
  ) {
    const correlationId = (request.headers['x-correlation-id'] as string) || crypto.randomUUID();
    return this.agentService.preview({ ...body, operationType: 'AGENT_CASH_OUT' }, correlationId);
  }

  @Post('agent/cash/confirm')
  @HttpCode(HttpStatus.OK)
  async confirm(
    @Body() body: { agentId: string; intentToken: string; idempotencyKey: string },
    @Req() request: Request,
  ) {
    const correlationId = (request.headers['x-correlation-id'] as string) || crypto.randomUUID();
    return this.agentService.confirm(body, correlationId);
  }

  @Get('agent/:agentId/cash/:operationId/status')
  async status(@Param('agentId') agentId: string, @Param('operationId') operationId: string) {
    return this.agentService.status(agentId, operationId);
  }

  @Get('agent/:agentReference/limits')
  async limits(@Param('agentReference') agentReference: string) {
    return this.agentService.limits(agentReference);
  }
}
