'use client';

import {
  startAuthentication,
  startRegistration,
  type AuthenticationResponseJSON,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/browser';
import type {
  PasskeyAuthenticationVerificationInput,
  PasskeyRegistrationVerificationInput,
} from '@aegis/contracts';
import { authClient } from '../api/auth-client';

export function isPasskeySupported(): boolean {
  return typeof window !== 'undefined' && 'PublicKeyCredential' in window;
}

export async function registerPasskey(nickname?: string): Promise<void> {
  const options = await authClient.requestPasskeyRegistrationOptions();
  const credential: RegistrationResponseJSON = await startRegistration({
    optionsJSON: options as unknown as PublicKeyCredentialCreationOptionsJSON,
  });
  await authClient.verifyPasskeyRegistration({
    challenge: options.challenge,
    credential:
      credential as unknown as PasskeyRegistrationVerificationInput['credential'],
    nickname,
  });
}

export async function authenticateWithPasskey(): Promise<void> {
  const options = await authClient.requestPasskeyAuthenticationOptions();
  const credential: AuthenticationResponseJSON = await startAuthentication({
    optionsJSON: options as PublicKeyCredentialRequestOptionsJSON,
  });
  await authClient.verifyPasskeyAuthentication({
    challenge: options.challenge,
    credential:
      credential as unknown as PasskeyAuthenticationVerificationInput['credential'],
  });
}
