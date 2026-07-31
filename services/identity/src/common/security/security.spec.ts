import {
  maskDevice,
  maskPhone,
  sha256,
  timingSafeStringEqual,
} from './security';

describe('security utilities', () => {
  it('masks phone and device identifiers without returning raw values', () => {
    expect(maskPhone('+12025550123')).toBe('+12******123');
    expect(maskDevice('private-device-id')).toMatch(/^device:[a-f0-9]{12}$/u);
    expect(maskDevice('private-device-id')).not.toContain('private-device-id');
  });

  it('uses length-safe constant-time equality semantics', () => {
    expect(timingSafeStringEqual(sha256('a'), sha256('a'))).toBe(true);
    expect(timingSafeStringEqual(sha256('a'), sha256('b'))).toBe(false);
    expect(timingSafeStringEqual('', '')).toBe(false);
  });
});
