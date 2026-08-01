import { Module } from '@nestjs/common';
import { EventController } from './event.controller';
import { EventService } from './event.service';
import { VelocityService } from './velocity.service';
@Module({
  controllers: [EventController],
  providers: [EventService, VelocityService],
  exports: [EventService, VelocityService],
})
export class EventsModule {}
