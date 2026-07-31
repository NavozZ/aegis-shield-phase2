import '@testing-library/jest-dom/vitest';

Object.defineProperty(globalThis, 'crypto', {
  configurable: true,
  value: {
    ...globalThis.crypto,
    randomUUID: () => '550e8400-e29b-41d4-a716-446655440000',
  },
});
