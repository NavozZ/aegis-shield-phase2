import { ForbiddenException, HttpException } from '@nestjs/common';
import type { GatewayConfig } from '../config/gateway.config';
import type { RequestContext } from '../common/http/request-context';
import type { RiskClient } from '../risk/risk.client';
import type { ResilienceClient } from './resilience.client';
import { ResilienceController } from './resilience.controller';

/*
 * The recovery console's authorization boundary.
 *
 * Every test below is about one question: can something that is not a
 * signed-in security operator reach recovery evidence, and can a signed-in
 * operator be tricked into acting through a cross-site request. Coverage of the
 * happy path is secondary to that.
 */

const config = {
  operatorSessionCookieName: 'aegis_operator_session',
  operatorCsrfCookieName: 'aegis_operator_csrf',
} as GatewayConfig;

const OPERATOR = {
  operatorId: 'operator:development-security',
  role: 'SECURITY_OPERATOR',
};

function requestWith(cookie?: string): RequestContext {
  return {
    correlationId: 'correlation-0000-0000',
    header: (name: string) =>
      name.toLowerCase() === 'cookie' ? cookie : undefined,
  } as unknown as RequestContext;
}

const SIGNED_IN = requestWith(
  'aegis_operator_session=session-token-value; aegis_operator_csrf=csrf-token-value',
);

/**
 * Builds a controller over plain mock functions.
 *
 * The mocks are returned by reference rather than read back off the client
 * objects, so assertions never detach a method from its instance.
 */
function build(overrides?: { validate?: jest.Mock }) {
  const validate = overrides?.validate ?? jest.fn().mockResolvedValue(OPERATOR);
  const readiness = jest.fn().mockResolvedValue({ platformState: 'HEALTHY' });
  const history = jest.fn().mockResolvedValue({ drills: [], nextCursor: null });
  const drill = jest.fn().mockResolvedValue({ drillId: 'drill:1' });
  const events = jest.fn().mockResolvedValue({ events: [] });
  const acknowledge = jest.fn().mockResolvedValue({ drillId: 'drill:1' });
  const recordPlanned = jest.fn().mockResolvedValue({ drillId: 'drill:2' });
  const risk = { operator: validate } as unknown as RiskClient;
  const resilience = {
    readiness,
    history,
    drill,
    events,
    acknowledge,
    recordPlanned,
  } as unknown as ResilienceClient;
  return {
    controller: new ResilienceController(risk, resilience, config),
    validate,
    readiness,
    history,
    drill,
    events,
    acknowledge,
    recordPlanned,
  };
}

describe('ResilienceController', () => {
  it('rejects a caller with no operator session before contacting resilience', async () => {
    // Risk is the authority on sessions; an empty token is rejected there.
    const { controller, validate, readiness } = build({
      validate: jest.fn().mockRejectedValue(
        new HttpException(
          {
            error: {
              code: 'OPERATOR_UNAUTHORIZED',
              message: 'Security operator authentication is required.',
            },
          },
          401,
        ),
      ),
    });
    await expect(controller.readiness(requestWith())).rejects.toBeInstanceOf(
      HttpException,
    );
    expect(validate).toHaveBeenCalledTimes(1);
    expect(readiness).not.toHaveBeenCalled();
  });

  it('rejects a valid session whose role is not SECURITY_OPERATOR', async () => {
    const { controller, readiness } = build({
      validate: jest.fn().mockResolvedValue({
        operatorId: 'operator:support',
        role: 'SUPPORT',
      }),
    });
    await expect(controller.readiness(SIGNED_IN)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(readiness).not.toHaveBeenCalled();
  });

  it('requires a matching CSRF token to acknowledge a failed drill', async () => {
    const { controller, ...mocks } = build();
    await expect(
      controller.acknowledge(
        SIGNED_IN,
        'drill:2026-08-01:abcd1234',
        { reason: 'Investigated; restore host was out of disk.' },
        'a-different-token',
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect(mocks.acknowledge).not.toHaveBeenCalled();
  });

  it('acknowledges with the authenticated operator id, never one from the body', async () => {
    const { controller, ...mocks } = build();
    await controller.acknowledge(
      SIGNED_IN,
      'drill:2026-08-01:abcd1234',
      { reason: 'Investigated; restore host was out of disk.' },
      'csrf-token-value',
    );
    expect(mocks.acknowledge).toHaveBeenCalledWith(
      SIGNED_IN,
      'drill:2026-08-01:abcd1234',
      OPERATOR.operatorId,
      'Investigated; restore host was out of disk.',
    );
  });

  it('records a planned drill against the authenticated operator', async () => {
    const { controller, ...mocks } = build();
    await controller.plan(
      SIGNED_IN,
      { type: 'SCHEDULED', note: 'Weekly recovery drill' },
      'csrf-token-value',
    );
    expect(mocks.recordPlanned).toHaveBeenCalledWith(
      SIGNED_IN,
      OPERATOR.operatorId,
      { type: 'SCHEDULED', note: 'Weekly recovery drill' },
    );
  });

  it('refuses a drill identifier that is not an opaque identifier', async () => {
    const { controller, ...mocks } = build();
    for (const bad of ['../../etc/passwd', 'drill; DROP TABLE', 'short']) {
      await expect(controller.drill(SIGNED_IN, bad)).rejects.toBeDefined();
    }
    expect(mocks.drill).not.toHaveBeenCalled();
  });

  it('passes only allow-listed history parameters upstream', async () => {
    const { controller, ...mocks } = build();
    await controller.drills(SIGNED_IN, {
      cursor: 'opaque-cursor',
      limit: '25',
      state: 'FAILED',
    });
    expect(mocks.history).toHaveBeenCalledWith(
      SIGNED_IN,
      '?cursor=opaque-cursor&limit=25&state=FAILED',
    );
  });

  it('rejects an unknown history parameter rather than forwarding it', async () => {
    const { controller, ...mocks } = build();
    // A strict query schema is what stops `?databaseUrl=…` style probing from
    // reaching an internal service.
    await expect(
      controller.drills(SIGNED_IN, { limit: '5', unexpected: 'value' }),
    ).rejects.toBeDefined();
    expect(mocks.history).not.toHaveBeenCalled();
  });

  it('rejects an acknowledgement reason that is too short to be an audit record', async () => {
    const { controller, ...mocks } = build();
    await expect(
      controller.acknowledge(
        SIGNED_IN,
        'drill:2026-08-01:abcd1234',
        { reason: 'ok' },
        'csrf-token-value',
      ),
    ).rejects.toBeDefined();
    expect(mocks.acknowledge).not.toHaveBeenCalled();
  });
});
