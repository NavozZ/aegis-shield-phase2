import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type GenerateAuthenticationOptionsOpts,
  type GenerateRegistrationOptionsOpts,
  type VerifyAuthenticationResponseOpts,
  type VerifyRegistrationResponseOpts,
} from '@simplewebauthn/server';
import { Injectable } from '@nestjs/common';

@Injectable()
export class WebAuthnAdapter {
  generateRegistration(options: GenerateRegistrationOptionsOpts) {
    return generateRegistrationOptions(options);
  }

  verifyRegistration(options: VerifyRegistrationResponseOpts) {
    return verifyRegistrationResponse({
      ...options,
      response: options.response,
    });
  }

  generateAuthentication(options: GenerateAuthenticationOptionsOpts) {
    return generateAuthenticationOptions(options);
  }

  verifyAuthentication(options: VerifyAuthenticationResponseOpts) {
    return verifyAuthenticationResponse({
      ...options,
      response: options.response,
    });
  }
}
