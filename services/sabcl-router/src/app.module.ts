import { Module } from '@nestjs/common';
import { RouterConfigModule } from './common/config/config.module';
import { HealthModule } from './health/health.module';
import { RouterRedisModule } from './redis/redis.module';
import { RoutingModule } from './routing/routing.module';

/**
 * The router has no database and no internal-token guard.
 *
 * There is nothing for a token to protect: authenticity is established by the
 * Ed25519 signature the recipient verifies, and authorisation is the route
 * table. Adding a shared bearer token here would create a credential that
 * grants routing without proving anything about the sender.
 */
@Module({
  imports: [RouterConfigModule, RouterRedisModule, RoutingModule, HealthModule],
})
export class AppModule {}
