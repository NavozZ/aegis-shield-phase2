'use client';

import { AuthClientError } from '@/lib/api/auth-client';
import type { Dictionary } from '@/lib/i18n/dictionaries';

export function authErrorMessage(
  error: unknown,
  dictionary: Dictionary,
): string {
  if (!(error instanceof AuthClientError)) return dictionary.unexpected;
  const messages = {
    invalid_input: dictionary.invalidInput,
    invalid_otp: dictionary.invalidOtp,
    rate_limited: dictionary.rateLimited,
    temporarily_locked: dictionary.temporarilyLocked,
    authentication_failed: dictionary.authenticationFailed,
    session_expired: dictionary.sessionExpired,
    request_conflict: dictionary.requestConflict,
    service_unavailable: dictionary.serviceUnavailable,
    network_unavailable: dictionary.networkUnavailable,
    unexpected: dictionary.unexpected,
  };
  return messages[error.kind];
}
