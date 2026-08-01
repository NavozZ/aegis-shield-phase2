import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
export const sha256 = (value: string): string =>
  createHash('sha256').update(value, 'utf8').digest('hex');
export const newIntentToken = (): string =>
  randomBytes(32).toString('base64url');
export const newTransferReference = (): string => {
  const value = randomBytes(12).toString('hex').toUpperCase();
  return `AEGIS-TRF-${value.slice(0, 4)}-${value.slice(4, 8)}-${value.slice(8, 12)}`;
};
export function timingSafeStringEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length > 0 && a.length === b.length && timingSafeEqual(a, b);
}
export function canonicalHash(value: unknown): string {
  const sort = (input: unknown): unknown =>
    Array.isArray(input)
      ? input.map(sort)
      : input && typeof input === 'object'
        ? Object.fromEntries(
            Object.entries(input as Record<string, unknown>)
              .filter(([, item]) => item !== undefined)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([key, item]) => [key, sort(item)]),
          )
        : input;
  return sha256(JSON.stringify(sort(value)));
}
export function advisoryKey(value: string): bigint {
  return BigInt.asIntN(64, BigInt(`0x${sha256(value).slice(0, 16)}`));
}
