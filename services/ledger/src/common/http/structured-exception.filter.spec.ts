import {
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import {
  accountNotFoundError,
  insufficientFundsError,
  LedgerError,
} from '../errors/ledger.error';
import { StructuredExceptionFilter } from './structured-exception.filter';

const correlationId = '77777777-7777-4777-8777-777777777777';

function buildHost() {
  const json = jest.fn();
  const status = jest.fn(() => ({ json }));
  const host = {
    switchToHttp: () => ({
      getRequest: () => ({ correlationId }),
      getResponse: () => ({ status }),
    }),
  } as unknown as ArgumentsHost;
  return { host, status, json };
}

describe('StructuredExceptionFilter', () => {
  const filter = new StructuredExceptionFilter();

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('maps a ledger error to its code, message and status', () => {
    const { host, status, json } = buildHost();
    filter.catch(insufficientFundsError(), host);

    expect(status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
    expect(json).toHaveBeenCalledWith({
      error: {
        code: 'INSUFFICIENT_FUNDS',
        message: 'The account has insufficient available funds.',
        correlationId,
      },
    });
  });

  it('returns a generic not-found for a concealed account', () => {
    const { host, json } = buildHost();
    filter.catch(accountNotFoundError(), host);

    expect(json).toHaveBeenCalledWith({
      error: {
        code: 'ACCOUNT_NOT_FOUND',
        message: 'The account could not be found.',
        correlationId,
      },
    });
  });

  it('never leaks a database message to the caller', () => {
    const { host, status, json } = buildHost();
    const databaseFailure = Object.assign(
      new Error(
        'duplicate key value violates unique constraint "customer_accounts_public_reference_key" DETAIL: Key (public_reference)=(AEGIS-4K7P-2R9M-8T3W) already exists.',
      ),
      { code: '23505' },
    );

    filter.catch(databaseFailure, host);

    expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    const body = JSON.stringify(json.mock.calls[0]);
    expect(body).not.toContain('AEGIS-4K7P');
    expect(body).not.toContain('unique constraint');
    expect(json).toHaveBeenCalledWith({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'The request could not be completed.',
        correlationId,
      },
    });
  });

  it('logs only the error class and a constrained code', () => {
    const errorLog = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const { host } = buildHost();

    filter.catch(new Error('sensitive value 0771234567'), host);

    const logged = String(errorLog.mock.calls[0]?.[0]);
    expect(logged).not.toContain('0771234567');
    expect(JSON.parse(logged)).toEqual({
      correlationId,
      errorName: 'Error',
      errorCode: undefined,
    });
  });

  it('maps an unauthenticated HTTP exception without detail', () => {
    const { host, json } = buildHost();
    filter.catch(new HttpException('nope', HttpStatus.UNAUTHORIZED), host);

    expect(json).toHaveBeenCalledWith({
      error: {
        code: 'UNAUTHENTICATED',
        message: 'The request is invalid.',
        correlationId,
      },
    });
  });

  it('preserves an explicit conflict status from a ledger error', () => {
    const { host, status } = buildHost();
    filter.catch(
      new LedgerError('IDEMPOTENCY_CONFLICT', 'Conflict.', HttpStatus.CONFLICT),
      host,
    );
    expect(status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
  });
});
