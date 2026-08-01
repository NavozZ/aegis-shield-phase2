import { Module } from '@nestjs/common';
import { RoutingModule } from '../routing/routing.module';
import { HealthController } from './health.controller';

@Module({
  imports: [RoutingModule],
  controllers: [HealthController],
})
export class HealthModule {}
