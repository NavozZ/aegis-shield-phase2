import { createHash, timingSafeEqual } from 'node:crypto';
export const sha256 = (value: string): string =>
  createHash('sha256').update(value).digest('hex');
export function timingSafeStringEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}
