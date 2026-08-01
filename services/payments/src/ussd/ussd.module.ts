import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { UssdController } from './ussd.controller';
import { UssdService } from './ussd.service';

@Module({
  imports: [DatabaseModule],
  controllers: [UssdController],
  providers: [UssdService],
  exports: [UssdService],
})
export class UssdModule {}
