import { Injectable } from '@nestjs/common';
import {
  IDENTITY_CONFIG,
  type IdentityConfig,
} from '../../common/config/identity.config';

export interface OtpProvider {
  exposeForDemo(code: string): string | undefined;
}

export const OTP_PROVIDER = Symbol('OTP_PROVIDER');

@Injectable()
export class DemoOtpProvider implements OtpProvider {
  exposeForDemo(code: string): string {
    return code;
  }
}

@Injectable()
export class DisabledOtpProvider implements OtpProvider {
  exposeForDemo(): undefined {
    return undefined;
  }
}

export const otpProviderFactory = {
  provide: OTP_PROVIDER,
  inject: [IDENTITY_CONFIG, DemoOtpProvider, DisabledOtpProvider],
  useFactory: (
    config: IdentityConfig,
    demo: DemoOtpProvider,
    disabled: DisabledOtpProvider,
  ): OtpProvider => (config.demoAuthEnabled ? demo : disabled),
};
