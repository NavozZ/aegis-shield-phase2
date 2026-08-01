import { recoveryReadinessSchema } from '@aegis/contracts';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  RecoveryConsole,
  abbreviate,
  formatAge,
  formatBytes,
  formatDuration,
  type RecoveryDrill,
  type RecoveryReadiness,
} from './recovery-console';

const { operatorRequest } = vi.hoisted(() => ({
  operatorRequest: vi.fn(),
}));
vi.mock('@/lib/security-ops/operator-client', () => ({ operatorRequest }));

function drill(overrides: Partial<RecoveryDrill> = {}): RecoveryDrill {
  return {
    drillId: 'drill:2026-08-01:11112222',
    type: 'CI_AUTOMATED',
    state: 'PASSED',
    startedAt: '2026-08-01T09:00:00.000Z',
    completedAt: '2026-08-01T09:02:00.000Z',
    requestedBy: 'operator:automation',
    backupSetId: 'backup:2026-08-01:aaaabbbb',
    measuredRecoveryPointAgeSeconds: 120,
    measuredRecoveryDurationMs: 45_000,
    reconciliations: [
      {
        service: 'ledger',
        status: 'PASS',
        issueCount: 0,
        checkedAt: '2026-08-01T09:01:30.000Z',
      },
      {
        service: 'payments',
        status: 'PASS',
        issueCount: 0,
        checkedAt: '2026-08-01T09:01:40.000Z',
      },
    ],
    failureCode: null,
    acknowledgedAt: null,
    acknowledgedBy: null,
    ...overrides,
  };
}

const readiness: RecoveryReadiness = {
  platformState: 'HEALTHY',
  services: [
    {
      service: 'ledger',
      state: 'HEALTHY',
      failureCode: null,
      checkedAt: '2026-08-01T09:05:00.000Z',
    },
  ],
  dependencies: [
    {
      name: 'resilience-postgres',
      kind: 'POSTGRES',
      state: 'HEALTHY',
      checkedAt: '2026-08-01T09:05:00.000Z',
    },
    {
      name: 'risk',
      kind: 'HTTP_SERVICE',
      state: 'UNAVAILABLE',
      checkedAt: '2026-08-01T09:05:00.000Z',
    },
  ],
  latestBackup: {
    backupSetId: 'backup:2026-08-01:aaaabbbb',
    createdAt: '2026-08-01T08:58:00.000Z',
    services: ['identity', 'ledger', 'payments', 'risk', 'resilience'],
    manifestChecksum: 'd'.repeat(64),
    encryptionAlgorithm: 'AES-256-GCM',
    sizeBytes: 5_242_880,
    verified: true,
  },
  latestDrill: drill(),
  generatedAt: '2026-08-01T09:05:00.000Z',
};

function respondWith(
  overrides: {
    readiness?: unknown;
    drills?: unknown;
  } = {},
) {
  operatorRequest.mockImplementation((path: string) => {
    if (path.startsWith('/resilience/readiness')) {
      return Promise.resolve(overrides.readiness ?? readiness);
    }
    if (path.startsWith('/resilience/drills?')) {
      return Promise.resolve(
        overrides.drills ?? { drills: [drill()], nextCursor: null },
      );
    }
    return Promise.resolve({});
  });
}

beforeEach(() => {
  operatorRequest.mockReset();
  respondWith();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('RecoveryConsole', () => {
  it('shows a loading status before any recovery data is displayed', () => {
    render(<RecoveryConsole />);
    expect(screen.getByRole('status')).toHaveTextContent(
      'Loading recovery readiness',
    );
  });

  it('renders platform state, dependency health and the latest backup set', async () => {
    render(<RecoveryConsole />);
    await screen.findByText('Platform state');
    expect(screen.getAllByText('HEALTHY').length).toBeGreaterThan(0);
    // The unavailable dependency is stated in words, not only by badge colour.
    expect(screen.getByText('UNAVAILABLE')).toBeInTheDocument();
    expect(screen.getByText('backup:2026-08-01:aaaabbbb')).toBeInTheDocument();
    expect(screen.getByText('AES-256-GCM')).toBeInTheDocument();
    expect(screen.getByText('5.0 MB')).toBeInTheDocument();
  });

  it('labels measurements as prototype figures rather than objectives', async () => {
    render(<RecoveryConsole />);
    expect(
      await screen.findByText('Measured prototype recovery-point age'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Measured prototype recovery duration'),
    ).toBeInTheDocument();
    const markup = document.body.textContent ?? '';
    expect(markup).toContain('not a production recovery-point');
    // The disclaimer names what this prototype does not do; what must never
    // appear is a claim that it does.
    expect(markup).toContain(
      'does not provide multi-region disaster recovery, continuous replication or zero data loss',
    );
    for (const claim of [
      'guaranteed recovery',
      'compliance certified',
      'zero data loss guarantee',
    ]) {
      expect(markup).not.toContain(claim);
    }
  });

  it('abbreviates the manifest checksum instead of printing all 64 characters', async () => {
    render(<RecoveryConsole />);
    await screen.findByText('Platform state');
    expect(document.body.textContent).not.toContain('d'.repeat(64));
    expect(screen.getByText('dddddddd…dddddddd')).toBeInTheDocument();
  });

  it('never renders a URL, password, key, dump path or customer reference', async () => {
    render(<RecoveryConsole />);
    await screen.findByText('Platform state');
    const markup = document.body.innerHTML;
    for (const forbidden of [
      'postgresql://',
      'http://127.0.0.1',
      'PGPASSWORD',
      '.dump',
      '.enc',
      'DR_BACKUP_ENCRYPTION_KEY',
      'x-aegis-internal-token',
    ]) {
      expect(markup).not.toContain(forbidden);
    }
  });

  it('offers no control that runs a backup or a restore', async () => {
    render(<RecoveryConsole />);
    await screen.findByText('Platform state');
    const labels = screen
      .getAllByRole('button')
      .map((button) => button.textContent?.toLowerCase() ?? '');
    for (const label of labels) {
      expect(label).not.toContain('run backup');
      expect(label).not.toContain('restore now');
      expect(label).not.toContain('execute');
    }
    // What it does say is where that work actually happens.
    expect(document.body.textContent).toContain(
      'operator command-line tooling',
    );
  });

  it('acknowledges a failed drill with a reason and reloads the evidence', async () => {
    respondWith({
      drills: {
        drills: [
          drill({
            state: 'FAILED',
            failureCode: 'RESTORE_FAILED',
            measuredRecoveryPointAgeSeconds: null,
            measuredRecoveryDurationMs: null,
            reconciliations: [],
          }),
        ],
        nextCursor: null,
      },
    });
    vi.spyOn(window, 'prompt').mockReturnValue(
      'Reviewed; verification host was out of disk.',
    );
    render(<RecoveryConsole />);

    const button = await screen.findByRole('button', {
      name: /Acknowledge RESTORE_FAILED/u,
    });
    await userEvent.click(button);

    await waitFor(() => {
      expect(operatorRequest).toHaveBeenCalledWith(
        '/resilience/drills/drill%3A2026-08-01%3A11112222/acknowledge',
        {
          method: 'POST',
          csrf: true,
          body: { reason: 'Reviewed; verification host was out of disk.' },
        },
      );
    });
  });

  it('does not send an acknowledgement when the reason is too short', async () => {
    respondWith({
      drills: {
        drills: [drill({ state: 'FAILED', failureCode: 'BACKUP_FAILED' })],
        nextCursor: null,
      },
    });
    vi.spyOn(window, 'prompt').mockReturnValue('nope');
    render(<RecoveryConsole />);
    await userEvent.click(
      await screen.findByRole('button', { name: /Acknowledge BACKUP_FAILED/u }),
    );
    expect(
      operatorRequest.mock.calls.filter((call) =>
        String(call[0]).includes('acknowledge'),
      ),
    ).toHaveLength(0);
  });

  it('records a planned drill and says where it is actually run', async () => {
    render(<RecoveryConsole />);
    await userEvent.click(
      await screen.findByRole('button', { name: 'Record a planned drill' }),
    );
    await waitFor(() => {
      expect(operatorRequest).toHaveBeenCalledWith('/resilience/drills', {
        method: 'POST',
        csrf: true,
        body: { type: 'MANUAL', note: 'Planned from the recovery console' },
      });
    });
    expect(
      await screen.findByText(/Run it with the operator recovery tooling/u),
    ).toBeInTheDocument();
  });

  it('explains an expired session rather than showing an empty console', async () => {
    operatorRequest.mockRejectedValue(new Error('OPERATOR_UNAUTHORIZED'));
    render(<RecoveryConsole />);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Your operator session has expired',
    );
  });

  it('reports an unavailable service without leaking why', async () => {
    operatorRequest.mockRejectedValue(new Error('OPERATOR_REQUEST_FAILED'));
    render(<RecoveryConsole />);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(
      'Recovery information is temporarily unavailable.',
    );
    expect(alert.textContent).not.toContain('OPERATOR_REQUEST_FAILED');
  });

  it('renders an empty history without an error', async () => {
    respondWith({ drills: { drills: [], nextCursor: null } });
    render(<RecoveryConsole />);
    expect(
      await screen.findByText('No recovery drill has been recorded yet.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('pages through history without repeating the first page', async () => {
    const older = drill({ drillId: 'drill:2026-07-31:33334444' });
    operatorRequest.mockImplementation((path: string) => {
      if (path.startsWith('/resilience/readiness'))
        return Promise.resolve(readiness);
      if (path.includes('cursor='))
        return Promise.resolve({ drills: [older], nextCursor: null });
      return Promise.resolve({
        drills: [drill()],
        nextCursor: 'drill:2026-08-01:11112222',
      });
    });
    render(<RecoveryConsole />);
    await userEvent.click(
      await screen.findByRole('button', { name: 'Load more drills' }),
    );
    await waitFor(() => {
      const historyTable = screen
        .getAllByRole('table')
        .find((table) =>
          table.querySelector('caption')?.textContent?.includes('newest first'),
        );
      // Header plus both pages, with the first page appearing exactly once.
      expect(historyTable?.querySelectorAll('tr')).toHaveLength(3);
    });
    expect(
      screen.queryByRole('button', { name: 'Load more drills' }),
    ).toBeNull();
  });

  it('gives every table a caption and every column a scope', async () => {
    render(<RecoveryConsole />);
    await screen.findByText('Platform state');
    for (const table of screen.getAllByRole('table')) {
      expect(table.querySelector('caption')?.textContent).toBeTruthy();
      for (const header of table.querySelectorAll('th')) {
        expect(header.getAttribute('scope')).toBe('col');
      }
    }
    expect(screen.getAllByRole('heading', { level: 2 }).length).toBeGreaterThan(
      2,
    );
  });
});

describe('recovery console formatting', () => {
  it('abbreviates long values and leaves short ones intact', () => {
    expect(abbreviate('a'.repeat(64))).toBe('aaaaaaaa…aaaaaaaa');
    expect(abbreviate('short')).toBe('short');
  });

  it('formats sizes, ages and durations in units an operator reads', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(5_242_880)).toBe('5.0 MB');
    expect(formatAge(null)).toBe('Not measured');
    expect(formatAge(30)).toBe('30 s');
    expect(formatAge(600)).toBe('10.0 min');
    expect(formatDuration(null)).toBe('Not measured');
    expect(formatDuration(450)).toBe('450 ms');
    expect(formatDuration(45_000)).toBe('45.0 s');
  });
});

describe('the readiness contract', () => {
  it('rejects a payload carrying anything beyond the documented fields', () => {
    for (const extra of [
      { databaseUrl: 'postgresql://user:pass@host/db' },
      { encryptionKey: 'AAAA' },
      { dumpPath: '/var/backups/ledger.dump' },
      { internalToken: 'token' },
      { rows: [{ customerId: 'cus_1' }] },
    ]) {
      expect(
        recoveryReadinessSchema.safeParse({ ...readiness, ...extra }).success,
      ).toBe(false);
    }
  });

  it('accepts the documented shape', () => {
    expect(recoveryReadinessSchema.safeParse(readiness).success).toBe(true);
  });
});
