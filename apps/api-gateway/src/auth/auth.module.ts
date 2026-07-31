import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { IdentityClient } from './identity.client';

@Module({
  controllers: [AuthController],
  providers: [IdentityClient],
  exports: [IdentityClient],
})
export class AuthModule {}
