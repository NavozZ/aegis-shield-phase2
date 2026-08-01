'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { operatorRequest } from '@/lib/security-ops/operator-client';

/*
 * Recovery operations console.
 *
 * Read-mostly by design. An operator can see how recovery-ready the platform
 * is, read the drill history, plan a drill and acknowledge a failed one. There
 * is deliberately no control here that runs a backup or a restore: those are
 * operator CLI tooling, because a button that shells out is remote command
 * execution wearing a nicer label.
 *
 * The numbers shown are measurements from a prototype drill against local
 * disposable infrastructure. They are labelled as such everywhere they appear,
 * so nobody reads them as a production recovery guarantee.
 */

export interface DependencyHealth {
  name: string;
  kind: 'POSTGRES' | 'REDIS' | 'HTTP_SERVICE';
  state: string;
  checkedAt: string;
}
export interface ServiceHealth {
  service: string;
  state: string;
  failureCode: string | null;
  checkedAt: string;
}
export interface BackupSetSummary {
  backupSetId: string;
  createdAt: string;
  services: string[];
  manifestChecksum: string;
  encryptionAlgorithm: string;
  sizeBytes: number;
  verified: boolean;
}
export interface ReconciliationSummary {
  service: string;
  status: 'PASS' | 'FAIL';
  issueCount: number;
  checkedAt: string;
}
export interface RecoveryDrill {
  drillId: string;
  type: string;
  state: string;
  startedAt: string;
  completedAt: string | null;
  requestedBy: string;
  backupSetId: string | null;
  measuredRecoveryPointAgeSeconds: number | null;
  measuredRecoveryDurationMs: number | null;
  reconciliations: ReconciliationSummary[];
  failureCode: string | null;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
}
export interface RecoveryReadiness {
  platformState: string;
  services: ServiceHealth[];
  dependencies: DependencyHealth[];
  latestBackup: BackupSetSummary | null;
  latestDrill: RecoveryDrill | null;
  generatedAt: string;
}
interface DrillHistory {
  drills: RecoveryDrill[];
  nextCursor: string | null;
}

/** A checksum is shown abbreviated: enough to compare, too little to retype. */
export function abbreviate(value: string): string {
  return value.length > 16 ? `${value.slice(0, 8)}…${value.slice(-8)}` : value;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

export function formatDuration(milliseconds: number | null): string {
  if (milliseconds === null) return 'Not measured';
  if (milliseconds < 1000) return `${String(milliseconds)} ms`;
  const seconds = milliseconds / 1000;
  return seconds < 90
    ? `${seconds.toFixed(1)} s`
    : `${(seconds / 60).toFixed(1)} min`;
}

export function formatAge(seconds: number | null): string {
  if (seconds === null) return 'Not measured';
  if (seconds < 90) return `${String(seconds)} s`;
  const minutes = seconds / 60;
  return minutes < 90
    ? `${minutes.toFixed(1)} min`
    : `${(minutes / 60).toFixed(1)} h`;
}

/** Words as well as colour, so state is never conveyed by hue alone. */
function stateBadgeClass(state: string): string {
  if (['FAILED', 'UNAVAILABLE'].includes(state)) return 'badge badge-danger';
  if (['DEGRADED', 'RECOVERING', 'RECONCILING'].includes(state)) {
    return 'badge badge-medium';
  }
  return 'badge';
}

export function RecoveryConsole() {
  const [readiness, setReadiness] = useState<RecoveryReadiness | null>(null);
  const [history, setHistory] = useState<RecoveryDrill[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [readinessResult, historyResult] = await Promise.all([
        operatorRequest<RecoveryReadiness>('/resilience/readiness'),
        operatorRequest<DrillHistory>('/resilience/drills?limit=20'),
      ]);
      setReadiness(readinessResult);
      setHistory(historyResult.drills);
      setCursor(historyResult.nextCursor);
    } catch (cause) {
      setError(
        cause instanceof Error && cause.message === 'OPERATOR_UNAUTHORIZED'
          ? 'Your operator session has expired. Sign in again.'
          : 'Recovery information is temporarily unavailable.',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function loadMore() {
    if (!cursor) return;
    try {
      const next = await operatorRequest<DrillHistory>(
        `/resilience/drills?limit=20&cursor=${encodeURIComponent(cursor)}`,
      );
      setHistory((current) => [...current, ...next.drills]);
      setCursor(next.nextCursor);
    } catch {
      setError('The next page of drill history could not be loaded.');
    }
  }

  async function planDrill() {
    setBusy(true);
    setNotice('');
    try {
      await operatorRequest('/resilience/drills', {
        method: 'POST',
        csrf: true,
        body: { type: 'MANUAL', note: 'Planned from the recovery console' },
      });
      setNotice(
        'A drill was recorded as planned. Run it with the operator recovery tooling.',
      );
      await load();
    } catch {
      setError('The drill could not be recorded. Nothing was changed.');
    } finally {
      setBusy(false);
    }
  }

  async function acknowledge(drillId: string) {
    const reason = window.prompt(
      'Enter the audited acknowledgement reason (minimum 8 characters).',
    );
    if (!reason || reason.trim().length < 8) return;
    setBusy(true);
    setNotice('');
    try {
      await operatorRequest(
        `/resilience/drills/${encodeURIComponent(drillId)}/acknowledge`,
        { method: 'POST', csrf: true, body: { reason: reason.trim() } },
      );
      setNotice('The failed drill was acknowledged.');
      await load();
    } catch {
      setError(
        'The acknowledgement could not be recorded. Nothing was changed.',
      );
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <main id="security-ops-main" className="ops-shell">
        <p role="status">Loading recovery readiness…</p>
      </main>
    );
  }

  return (
    <main id="security-ops-main" className="ops-shell">
      <div className="ops-title">
        <div>
          <p className="eyebrow">Operational resilience</p>
          <h1>Recovery operations</h1>
          <p>
            Backup evidence, isolated restore verification and recovery drill
            history. Backups and restores are run with operator command-line
            tooling; this console records and displays what they reported.
            Operator interface language: English.
          </p>
        </div>
        <button className="button" onClick={() => void load()}>
          Refresh
        </button>
      </div>

      {error ? (
        <p className="status-banner status-error" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="status-banner" role="status">
          {notice}
        </p>
      ) : null}

      {readiness ? (
        <>
          <section aria-labelledby="readiness-title">
            <h2 id="readiness-title">Platform recovery readiness</h2>
            <dl className="ops-metrics">
              <div>
                <dt>Platform state</dt>
                <dd>
                  <span className={stateBadgeClass(readiness.platformState)}>
                    {readiness.platformState}
                  </span>
                </dd>
              </div>
              <div>
                <dt>Latest backup set</dt>
                <dd>
                  {readiness.latestBackup
                    ? readiness.latestBackup.verified
                      ? 'Verified'
                      : 'Not yet verified'
                    : 'None recorded'}
                </dd>
              </div>
              <div>
                <dt>Measured prototype recovery-point age</dt>
                <dd>
                  {formatAge(
                    readiness.latestDrill?.measuredRecoveryPointAgeSeconds ??
                      null,
                  )}
                </dd>
              </div>
              <div>
                <dt>Measured prototype recovery duration</dt>
                <dd>
                  {formatDuration(
                    readiness.latestDrill?.measuredRecoveryDurationMs ?? null,
                  )}
                </dd>
              </div>
            </dl>
            <p className="ops-footnote">
              These figures are measurements from the most recent drill against
              local disposable infrastructure. They are not a production
              recovery-point or recovery-time objective, and this prototype does
              not provide multi-region disaster recovery, continuous replication
              or zero data loss.
            </p>
          </section>

          <section className="ops-panel">
            <h2>Service and dependency state</h2>
            <div className="ops-table-wrap">
              <table>
                <caption>
                  Health of each service dependency at the time this page was
                  generated.
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Dependency</th>
                    <th scope="col">Kind</th>
                    <th scope="col">State</th>
                    <th scope="col">Checked</th>
                  </tr>
                </thead>
                <tbody>
                  {readiness.dependencies.map((dependency) => (
                    <tr key={`${dependency.kind}:${dependency.name}`}>
                      <td>{dependency.name}</td>
                      <td>{dependency.kind}</td>
                      <td>
                        <span className={stateBadgeClass(dependency.state)}>
                          {dependency.state}
                        </span>
                      </td>
                      <td>{new Date(dependency.checkedAt).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="ops-panel">
            <h2>Latest encrypted backup set</h2>
            {readiness.latestBackup ? (
              <dl className="ops-definition">
                <div>
                  <dt>Backup set</dt>
                  <dd>
                    <code>{readiness.latestBackup.backupSetId}</code>
                  </dd>
                </div>
                <div>
                  <dt>Created</dt>
                  <dd>
                    {new Date(
                      readiness.latestBackup.createdAt,
                    ).toLocaleString()}
                  </dd>
                </div>
                <div>
                  <dt>Databases covered</dt>
                  <dd>{readiness.latestBackup.services.join(', ')}</dd>
                </div>
                <div>
                  <dt>Encryption</dt>
                  <dd>{readiness.latestBackup.encryptionAlgorithm}</dd>
                </div>
                <div>
                  <dt>Manifest checksum</dt>
                  <dd>
                    <code>
                      {abbreviate(readiness.latestBackup.manifestChecksum)}
                    </code>
                  </dd>
                </div>
                <div>
                  <dt>Encrypted size</dt>
                  <dd>{formatBytes(readiness.latestBackup.sizeBytes)}</dd>
                </div>
                <div>
                  <dt>Restore verified</dt>
                  <dd>
                    <span
                      className={
                        readiness.latestBackup.verified
                          ? 'badge'
                          : 'badge badge-medium'
                      }
                    >
                      {readiness.latestBackup.verified ? 'Yes' : 'No'}
                    </span>
                  </dd>
                </div>
              </dl>
            ) : (
              <p role="status">
                No backup set has been recorded yet. Run the operator backup
                tooling to create one.
              </p>
            )}
          </section>
        </>
      ) : null}

      <section className="ops-panel">
        <div className="ops-section-title">
          <h2>Recovery drill history</h2>
          <button
            className="button button-quiet"
            disabled={busy}
            onClick={() => void planDrill()}
          >
            Record a planned drill
          </button>
        </div>
        {history.length > 0 ? (
          <div className="ops-table-wrap">
            <table>
              <caption>
                Every recorded drill, newest first. Drill history is
                append-only.
              </caption>
              <thead>
                <tr>
                  <th scope="col">Started</th>
                  <th scope="col">Type</th>
                  <th scope="col">State</th>
                  <th scope="col">Recovery-point age</th>
                  <th scope="col">Recovery duration</th>
                  <th scope="col">Outcome</th>
                </tr>
              </thead>
              <tbody>
                {history.map((drill) => (
                  <tr key={drill.drillId}>
                    <td>{new Date(drill.startedAt).toLocaleString()}</td>
                    <td>{drill.type}</td>
                    <td>
                      <span className={stateBadgeClass(drill.state)}>
                        {drill.state}
                      </span>
                    </td>
                    <td>{formatAge(drill.measuredRecoveryPointAgeSeconds)}</td>
                    <td>{formatDuration(drill.measuredRecoveryDurationMs)}</td>
                    <td>
                      {drill.state === 'FAILED' ? (
                        drill.acknowledgedAt ? (
                          <span>
                            Acknowledged · {drill.failureCode ?? 'UNKNOWN'}
                          </span>
                        ) : (
                          <button
                            className="text-button ops-acknowledge"
                            disabled={busy}
                            onClick={() => void acknowledge(drill.drillId)}
                          >
                            Acknowledge {drill.failureCode ?? 'failure'}
                          </button>
                        )
                      ) : (
                        <span>
                          {drill.reconciliations.length > 0
                            ? `${String(
                                drill.reconciliations.filter(
                                  (item) => item.status === 'PASS',
                                ).length,
                              )}/${String(drill.reconciliations.length)} reconciliations passed`
                            : '—'}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p role="status">No recovery drill has been recorded yet.</p>
        )}
        {cursor ? (
          <button className="text-button" onClick={() => void loadMore()}>
            Load more drills
          </button>
        ) : null}
      </section>

      <p className="ops-footnote">
        <Link href="/security-ops">Back to security operations</Link>
      </p>
    </main>
  );
}
