import { DEFAULT_API_PORT } from '../constants/application.constants';
import { resolveApiPort } from './api-port';

describe('resolveApiPort', () => {
  it('uses the safe default when API_PORT is absent', () => {
    expect(resolveApiPort(undefined)).toBe(DEFAULT_API_PORT);
  });

  it('accepts a valid TCP port', () => {
    expect(resolveApiPort('4100')).toBe(4100);
  });

  it.each(['0', '65536', '4000.5', 'not-a-port'])(
    'rejects invalid value %s',
    (value) => {
      expect(() => resolveApiPort(value)).toThrow(
        'API_PORT must be an integer between 1 and 65535.',
      );
    },
  );
});
