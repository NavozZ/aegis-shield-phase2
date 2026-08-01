import { Module } from '@nestjs/common';
import { ResilienceClient } from './resilience.client';
import { ResilienceController } from './resilience.controller';

@Module({
  controllers: [ResilienceController],
  providers: [ResilienceClient],
})
export class ResilienceModule {}
