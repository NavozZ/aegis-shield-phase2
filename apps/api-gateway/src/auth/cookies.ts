import type { Response } from 'express';
import type { GatewayConfig } from '../config/gateway.config';

export interface InternalSessionResponse {
  sessionId: string;
  csrfToken: string;
  maxAgeSeconds: number;
  session: unknown;
}

export function serializeCookie(
  name: string,
  value: string,
  options: { httpOnly: boolean; secure: boolean; maxAgeSeconds: number },
): string {
  const attributes = [
    `${encodeURIComponent(name)}=${encodeURIComponent(value)}`,
    'Path=/',
    `Max-Age=${Math.max(0, Math.floor(options.maxAgeSeconds))}`,
    'SameSite=Lax',
  ];
  if (options.httpOnly) attributes.push('HttpOnly');
  if (options.secure) attributes.push('Secure');
  return attributes.join('; ');
}

export function setSessionCookies(
  response: Response,
  config: GatewayConfig,
  session: InternalSessionResponse,
): void {
  const secure = config.nodeEnvironment === 'production';
  response.setHeader('set-cookie', [
    serializeCookie(config.sessionCookieName, session.sessionId, {
      httpOnly: true,
      secure,
      maxAgeSeconds: session.maxAgeSeconds,
    }),
    serializeCookie(config.csrfCookieName, session.csrfToken, {
      httpOnly: false,
      secure,
      maxAgeSeconds: session.maxAgeSeconds,
    }),
  ]);
}

export function clearSessionCookies(
  response: Response,
  config: GatewayConfig,
): void {
  const secure = config.nodeEnvironment === 'production';
  response.setHeader('set-cookie', [
    serializeCookie(config.sessionCookieName, '', {
      httpOnly: true,
      secure,
      maxAgeSeconds: 0,
    }),
    serializeCookie(config.csrfCookieName, '', {
      httpOnly: false,
      secure,
      maxAgeSeconds: 0,
    }),
  ]);
}

export function readCookie(
  requestCookie: string | undefined,
  name: string,
): string {
  if (!requestCookie) return '';
  for (const pair of requestCookie.split(';')) {
    const separator = pair.indexOf('=');
    if (separator < 0) continue;
    const candidateName = decodeURIComponent(pair.slice(0, separator).trim());
    if (candidateName === name) {
      return decodeURIComponent(pair.slice(separator + 1).trim());
    }
  }
  return '';
}
