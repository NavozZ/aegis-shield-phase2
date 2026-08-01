import { Global, Module } from '@nestjs/common';
import { RouterRedisService } from './redis.service';

@Global()
@Module({
  providers: [RouterRedisService],
  exports: [RouterRedisService],
})
export class RouterRedisModule {}
