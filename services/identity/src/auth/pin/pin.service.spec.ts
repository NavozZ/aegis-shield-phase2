import { argon2id } from 'argon2';
import { PinService } from './pin.service';

describe('PinService', () => {
  it('creates a salted Argon2id hash and verifies only the correct PIN', async () => {
    const service = new PinService();
    const first = await service.hashPin('739182');
    const second = await service.hashPin('739182');

    expect(first).toContain('$argon2id$');
    expect(first).not.toContain('739182');
    expect(first).not.toBe(second);
    await expect(service.verifyPin(first, '739182')).resolves.toBe(true);
    await expect(service.verifyPin(first, '739183')).resolves.toBe(false);
    expect(argon2id).toBe(2);
  });
});
