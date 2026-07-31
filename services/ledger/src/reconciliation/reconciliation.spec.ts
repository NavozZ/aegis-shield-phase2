import type { PrismaService } from '../database/prisma.service';
import { ReconciliationService } from './reconciliation.service';

const correlationId = '88888888-8888-4888-8888-888888888888';
const runId = '99999999-9999-4999-8999-999999999999';

/**
 * The service issues one `$queryRaw` per invariant, in declaration order,
 * followed by the system-account count. Supplying rows for a chosen index lets
 * a single failing invariant be simulated without a database.
 */
function buildService(options: {
  issueRowsByIndex?: Record<number, Array<{ identifier: string | null }>>;
  systemAccountTypes?: number;
}) {
  const issueRows = options.issueRowsByIndex ?? {};
  let queryIndex = 0;
  const created: Array<Record<string, unknown>> = [];

  const queryRaw = jest.fn(() => {
    const index = queryIndex;
    queryIndex += 1;
    // The final query counts distinct system account types.
    if (index === 8) {
      return Promise.resolve([
        { total: BigInt(options.systemAccountTypes ?? 2) },
      ]);
    }
    return Promise.resolve(issueRows[index] ?? []);
  });

  const prisma = {
    client: {
      $queryRaw: queryRaw,
      journalEntry: { count: jest.fn(() => Promise.resolve(4)) },
      journalPosting: { count: jest.fn(() => Promise.resolve(8)) },
      ledgerAccount: { count: jest.fn(() => Promise.resolve(3)) },
      customerAccount: { count: jest.fn(() => Promise.resolve(1)) },
      reconciliationRun: {
        create: jest.fn((args: { data: Record<string, unknown> }) => {
          created.push(args.data);
          return Promise.resolve({ id: runId });
        }),
        findFirst: jest.fn(() => Promise.resolve(null)),
      },
    },
  } as unknown as PrismaService;

  return { service: new ReconciliationService(prisma), created, queryRaw };
}

describe('ReconciliationService', () => {
  it('passes and records counts when every invariant holds', async () => {
    const { service, created } = buildService({});

    const result = await service.run(correlationId);

    expect(result.status).toBe('PASS');
    expect(result.issueCount).toBe(0);
    expect(result.issues).toEqual([]);
    expect(result).toMatchObject({
      id: runId,
      checkedJournalEntries: 4,
      checkedPostings: 8,
      checkedLedgerAccounts: 3,
      checkedCustomerAccounts: 1,
    });
    expect(created[0]).toMatchObject({ status: 'PASS', correlationId });
  });

  it('fails when a journal does not balance', async () => {
    const { service } = buildService({
      issueRowsByIndex: { 0: [{ identifier: 'JRN-TEST-0001' }] },
    });

    const result = await service.run(correlationId);

    expect(result.status).toBe('FAIL');
    expect(result.issues).toEqual([
      {
        code: 'UNBALANCED_JOURNAL',
        severity: 'ERROR',
        safeIdentifier: 'JRN-TEST-0001',
      },
    ]);
  });

  it('detects a balance projection that drifted from the postings', async () => {
    const { service } = buildService({
      issueRowsByIndex: { 3: [{ identifier: 'CUST-AEGIS-4K7P-2R9M-8T3W' }] },
    });

    const result = await service.run(correlationId);

    expect(result.status).toBe('FAIL');
    expect(result.issues[0]?.code).toBe('BALANCE_PROJECTION_DRIFT');
  });

  it('detects a negative customer balance', async () => {
    const { service } = buildService({
      issueRowsByIndex: { 7: [{ identifier: 'AEGIS-****-****-8T3W' }] },
    });

    const result = await service.run(correlationId);

    expect(result.status).toBe('FAIL');
    expect(result.issues[0]?.code).toBe('NEGATIVE_CUSTOMER_BALANCE');
  });

  it('fails when the system chart of accounts is incomplete', async () => {
    const { service } = buildService({ systemAccountTypes: 1 });

    const result = await service.run(correlationId);

    expect(result.status).toBe('FAIL');
    expect(result.issues.map((issue) => issue.code)).toContain(
      'MISSING_SYSTEM_ACCOUNT',
    );
  });

  it('reports masked references and never a customer identifier', async () => {
    const { service } = buildService({
      issueRowsByIndex: { 7: [{ identifier: 'AEGIS-****-****-8T3W' }] },
    });

    const result = await service.run(correlationId);

    // The run's own id is a UUID by design; no issue may carry one, because
    // issue identifiers are journal references, account codes or masked
    // account references — never a customer or ledger account UUID.
    expect(JSON.stringify(result.issues)).not.toMatch(
      /[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/iu,
    );
    expect(result.issues[0]?.safeIdentifier).toBe('AEGIS-****-****-8T3W');
  });

  it('bounds the reported issue list', async () => {
    const { service } = buildService({
      issueRowsByIndex: {
        0: Array.from({ length: 40 }, (_, index) => ({
          identifier: `JRN-${index}`,
        })),
        1: Array.from({ length: 40 }, (_, index) => ({
          identifier: `JRN-B-${index}`,
        })),
      },
    });

    const result = await service.run(correlationId);

    expect(result.issues.length).toBeLessThanOrEqual(50);
    expect(result.status).toBe('FAIL');
  });
});
