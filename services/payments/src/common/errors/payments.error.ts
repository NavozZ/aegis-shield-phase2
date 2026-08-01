import { HttpStatus } from '@nestjs/common';
export class PaymentsError extends Error {
  constructor(
    readonly code: string,
    message = 'The transfer could not be completed.',
    readonly status = HttpStatus.CONFLICT,
  ) {
    super(message);
    this.name = 'PaymentsError';
  }
}
export const paymentError = (code: string, status?: number) =>
  new PaymentsError(code, 'The transfer could not be completed.', status);
