import { Injectable } from '@nestjs/common';
import { sha256 } from '../common/security/security';
import { RedisService } from '../redis/redis.service';
@Injectable()
export class VelocityService {
  constructor(private readonly redis: RedisService) {}
  async increment(
    scopeId: string,
    signal: string,
    windowSeconds: number,
    amount = 1,
  ): Promise<number> {
    const key = this.redis.key('velocity', signal, sha256(scopeId));
    const transaction = this.redis.client
      .multi()
      .incrBy(key, amount)
      .expire(key, windowSeconds, 'NX');
    const result = await transaction.exec();
    return Number(result[0]);
  }
  async read(scopeId: string, signal: string): Promise<number> {
    return Number(
      (await this.redis.client.get(
        this.redis.key('velocity', signal, sha256(scopeId)),
      )) || 0,
    );
  }
}
