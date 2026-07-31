import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function keyedDigest(value: string, secret: string): string {
  return createHmac('sha256', secret).update(value, 'utf8').digest('hex');
}

export function timingSafeStringEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, 'utf8');
  const rightBuffer = Buffer.from(right, 'utf8');
  if (leftBuffer.length !== rightBuffer.length || leftBuffer.length === 0) {
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function maskPhone(phone: string): string {
  if (phone.length <= 7) return '***';
  return `${phone.slice(0, 3)}${'*'.repeat(phone.length - 6)}${phone.slice(-3)}`;
}

export function maskDevice(deviceId?: string): string | undefined {
  return deviceId ? `device:${sha256(deviceId).slice(0, 12)}` : undefined;
}
