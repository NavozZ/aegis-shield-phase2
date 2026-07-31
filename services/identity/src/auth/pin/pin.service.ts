import { Injectable, type OnModuleInit } from '@nestjs/common';
import { hash, verify, argon2id } from 'argon2';
import { randomInt } from 'node:crypto';

export const PIN_ALGORITHM = 'argon2id-v=19-m=19456,t=2,p=1';

@Injectable()
export class PinService implements OnModuleInit {
  private dummyHash = '';

  private dummyPin(): string {
    return randomInt(0, 1_000_000).toString().padStart(6, '0');
  }

  async onModuleInit(): Promise<void> {
    this.dummyHash = await this.hashPin(this.dummyPin());
  }

  hashPin(pin: string): Promise<string> {
    return hash(pin, {
      type: argon2id,
      memoryCost: 19_456,
      timeCost: 2,
      parallelism: 1,
      hashLength: 32,
    });
  }

  verifyPin(pinHash: string, pin: string): Promise<boolean> {
    return verify(pinHash, pin);
  }

  async performDummyVerification(pin: string): Promise<void> {
    if (!this.dummyHash) this.dummyHash = await this.hashPin(this.dummyPin());
    await this.verifyPin(this.dummyHash, pin);
  }
}
