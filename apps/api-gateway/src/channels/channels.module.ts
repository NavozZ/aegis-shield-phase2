import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TransfersModule } from '../transfers/transfers.module';
import { ChannelsController } from './channels.controller';
import { AccountsModule } from '../accounts/accounts.module';
import { GatewayConfigModule } from '../config/gateway-config.module';

@Module({
  imports: [AuthModule, TransfersModule, AccountsModule, GatewayConfigModule],
  controllers: [ChannelsController],
})
export class ChannelsModule {}
