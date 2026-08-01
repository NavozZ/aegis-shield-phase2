import {
  sabclStatusResponseSchema,
  type SabclStatusResponse,
} from '@aegis/contracts';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SabclStatusPanel } from './sabcl-status-panel';
import { dictionaries } from '@/lib/i18n/dictionaries';

const dictionary = dictionaries.EN;

const status: SabclStatusResponse = {
  protocolVersion: 'SABCL/1',
  mode: 'strict',
  strict: true,
  gatewayKey: 'gateway.v1:9f3c1a',
  peerKeyIds: ['ledger.v1', 'payments.v1'],
  routerReachable: true,
  router: {
    protocolVersion: 'SABCL/1',
    mode: 'strict',
    strict: true,
    routerKey: 'sabcl-router.v1:44ab02',
    rotation: [
      {
        service: 'ledger',
        active: 'ledger.v2',
        accepted: ['ledger.v1', 'ledger.v2'],
        revoked: [],
      },
      {
        service: 'payments',
        active: 'payments.v1',
        accepted: ['payments.v1'],
        revoked: [],
      },
    ],
    routes: ['ledger.accounts', 'payments.transfer'],
    reachability: [
      { routeId: 'ledger.accounts', service: 'ledger', reachable: true },
      { routeId: 'payments.transfer', service: 'payments', reachable: false },
    ],
    padding: { policy: 'bucketed', unit: 'bytes' },
    counters: { 'envelope.accepted': 42, 'envelope.replayed': 1 },
    replayState: 'ok',
  },
};

describe('SabclStatusPanel', () => {
  it('shows mode, protocol version and abbreviated key fingerprints', () => {
    render(<SabclStatusPanel status={status} dictionary={dictionary} />);
    expect(screen.getByText('SABCL/1')).toBeInTheDocument();
    expect(screen.getByText('gateway.v1:9f3c1a')).toBeInTheDocument();
    expect(screen.getByText('sabcl-router.v1:44ab02')).toBeInTheDocument();
  });

  it('states strictness in words, not only by colour', () => {
    render(<SabclStatusPanel status={status} dictionary={dictionary} />);
    // Anyone who cannot distinguish the pill fills still gets the meaning.
    expect(screen.getByText(dictionary.sabclStrictOn)).toBeInTheDocument();
  });

  it('labels an unreachable route in text', () => {
    render(<SabclStatusPanel status={status} dictionary={dictionary} />);
    expect(screen.getByText(dictionary.sabclUnreachable)).toBeInTheDocument();
    expect(screen.getByText(dictionary.sabclReachable)).toBeInTheDocument();
  });

  it('shows rotation state including which key is active', () => {
    render(<SabclStatusPanel status={status} dictionary={dictionary} />);
    expect(screen.getByText('ledger.v2')).toBeInTheDocument();
    expect(screen.getByText('ledger.v1, ledger.v2')).toBeInTheDocument();
  });

  it('shows capability names rather than destinations', () => {
    render(<SabclStatusPanel status={status} dictionary={dictionary} />);
    const markup = document.body.innerHTML;
    expect(markup).toContain('ledger.accounts');
    // A destination URL would tell an observer which host serves which
    // capability, which is exactly the mapping the layer hides.
    expect(markup).not.toContain('127.0.0.1');
    expect(markup).not.toContain('http://');
  });

  it('gives every group a heading and every table a caption', () => {
    render(<SabclStatusPanel status={status} dictionary={dictionary} />);
    expect(screen.getAllByRole('heading', { level: 2 }).length).toBeGreaterThan(
      2,
    );
    for (const table of screen.getAllByRole('table')) {
      expect(table.querySelector('caption')?.textContent).toBeTruthy();
    }
  });

  it('renders in Sinhala and Tamil without falling back to English', () => {
    for (const language of ['SI', 'TA'] as const) {
      const { unmount } = render(
        <SabclStatusPanel
          status={status}
          dictionary={dictionaries[language]}
        />,
      );
      expect(
        screen.getByText(dictionaries[language].sabclStrictOn),
      ).toBeInTheDocument();
      unmount();
    }
  });

  it('renders when the router is unreachable', () => {
    render(
      <SabclStatusPanel
        status={{ ...status, routerReachable: false, router: null }}
        dictionary={dictionary}
      />,
    );
    expect(screen.getByText('SABCL/1')).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
  });
});

describe('the status contract', () => {
  it('rejects a payload carrying anything beyond the documented fields', () => {
    // The schema is the last line of defence for the page: if the gateway ever
    // started returning a key or a route token, this parse fails and the page
    // renders "unavailable" rather than displaying it.
    for (const extra of [
      { routeSecret: 'AAAA' },
      { privateKey: 'BBBB' },
      { routeTokens: ['CCCC'] },
      { payload: { customerId: 'cus_1' } },
    ]) {
      expect(
        sabclStatusResponseSchema.safeParse({ ...status, ...extra }).success,
      ).toBe(false);
    }
  });

  it('accepts the documented shape', () => {
    expect(sabclStatusResponseSchema.safeParse(status).success).toBe(true);
  });

  it('rejects anything in a key field that is not an abbreviated fingerprint', () => {
    // A raw 32-byte key is 43 base64url characters and matches no fingerprint
    // pattern, so it cannot pass validation and cannot reach the page.
    for (const value of [
      Buffer.alloc(32, 7).toString('base64url'),
      'gateway.v1:' + 'a'.repeat(64),
      'not-a-key',
    ]) {
      expect(
        sabclStatusResponseSchema.safeParse({ ...status, gatewayKey: value })
          .success,
      ).toBe(false);
    }
  });
});
