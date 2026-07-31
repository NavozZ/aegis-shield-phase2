import { Controller, Get } from '@nestjs/common';
import {
  APPLICATION_NAME,
  APPLICATION_VERSION,
  DEFAULT_ENVIRONMENT,
} from '../constants/application.constants';
import type { HealthResponse } from './health.types';

@Controller('health')
export class HealthController {
  @Get()
  getHealth(): HealthResponse {
    return {
      status: 'ok',
      service: APPLICATION_NAME,
      version: APPLICATION_VERSION,
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV?.trim() || DEFAULT_ENVIRONMENT,
    };
  }
}
