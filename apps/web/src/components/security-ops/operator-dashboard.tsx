'use client';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { operatorRequest } from '@/lib/security-ops/operator-client';
type Overview = {
  eventsLast24Hours: number;
  activeControls: number;
  openIncidents: number;
  highCriticalAssessments: number;
  riskDistribution: Record<'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL', number>;
  sourceHealth: Array<{
    source: string;
    lastReceivedAt: string;
    stale: boolean;
  }>;
};
type EventRow = {
  id: string;
  source: string;
  eventType: string;
  severity: string;
  subjectId: string | null;
  receivedAt: string;
};
type Assessment = {
  id: string;
  band: string;
  decision: string;
  score: number;
  triggeredRules: string[];
  reasonCodes: string[];
  publicExplanation: string;
  createdAt: string;
};
type Control = {
  id: string;
  type: string;
  scopeType: string;
  scopeId: string;
  status: string;
  reasonCode: string;
  expiresAt: string;
  createdAt: string;
};
type Incident = {
  id: string;
  severity: string;
  status: string;
  title: string;
  assignedTo: string | null;
  createdAt: string;
};
function masked(value: string | null) {
  if (!value) return '—';
  return value.length > 12 ? `${value.slice(0, 4)}…${value.slice(-6)}` : value;
}
function pageCursor(timestamp: string, id: string) {
  return btoa(JSON.stringify({ timestamp, id }))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '');
}
export function OperatorDashboard() {
  const router = useRouter();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [controls, setControls] = useState<Control[]>([]);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [source, setSource] = useState('ALL');
  const [severity, setSeverity] = useState('ALL');
  const [hasMore, setHasMore] = useState({
    events: false,
    assessments: false,
    controls: false,
    incidents: false,
  });
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [
        resultOverview,
        resultEvents,
        resultAssessments,
        resultControls,
        resultIncidents,
      ] = await Promise.all([
        operatorRequest<Overview>('/overview'),
        operatorRequest<EventRow[]>('/events'),
        operatorRequest<Assessment[]>('/assessments'),
        operatorRequest<Control[]>('/controls'),
        operatorRequest<Incident[]>('/incidents'),
      ]);
      setOverview(resultOverview);
      setEvents(resultEvents.slice(0, 50));
      setAssessments(resultAssessments.slice(0, 50));
      setControls(resultControls.slice(0, 50));
      setIncidents(resultIncidents.slice(0, 50));
      setHasMore({
        events: resultEvents.length > 50,
        assessments: resultAssessments.length > 50,
        controls: resultControls.length > 50,
        incidents: resultIncidents.length > 50,
      });
    } catch (error) {
      setError(
        error instanceof Error && error.message === 'OPERATOR_UNAUTHORIZED'
          ? 'Your operator session has expired. Sign in again.'
          : 'Security operations data is temporarily unavailable.',
      );
    } finally {
      setLoading(false);
    }
  }, []);
  async function loadMore(kind: keyof typeof hasMore) {
    try {
      if (kind === 'events') {
        const tail = events.at(-1);
        if (!tail) return;
        const rows = await operatorRequest<EventRow[]>(
          `/events?cursor=${encodeURIComponent(pageCursor(tail.receivedAt, tail.id))}`,
        );
        setEvents((current) => [...current, ...rows.slice(0, 50)]);
        setHasMore((current) => ({ ...current, events: rows.length > 50 }));
      } else if (kind === 'assessments') {
        const tail = assessments.at(-1);
        if (!tail) return;
        const rows = await operatorRequest<Assessment[]>(
          `/assessments?cursor=${encodeURIComponent(pageCursor(tail.createdAt, tail.id))}`,
        );
        setAssessments((current) => [...current, ...rows.slice(0, 50)]);
        setHasMore((current) => ({
          ...current,
          assessments: rows.length > 50,
        }));
      } else if (kind === 'controls') {
        const tail = controls.at(-1);
        if (!tail) return;
        const rows = await operatorRequest<Control[]>(
          `/controls?cursor=${encodeURIComponent(pageCursor(tail.createdAt, tail.id))}`,
        );
        setControls((current) => [...current, ...rows.slice(0, 50)]);
        setHasMore((current) => ({ ...current, controls: rows.length > 50 }));
      } else {
        const tail = incidents.at(-1);
        if (!tail) return;
        const rows = await operatorRequest<Incident[]>(
          `/incidents?cursor=${encodeURIComponent(pageCursor(tail.createdAt, tail.id))}`,
        );
        setIncidents((current) => [...current, ...rows.slice(0, 50)]);
        setHasMore((current) => ({ ...current, incidents: rows.length > 50 }));
      }
    } catch {
      setError('The next page could not be loaded.');
    }
  }
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  const visibleEvents = useMemo(
    () =>
      events.filter(
        (event) =>
          (source === 'ALL' || event.source === source) &&
          (severity === 'ALL' || event.severity === severity),
      ),
    [events, source, severity],
  );
  async function release(id: string) {
    const reason = window.prompt(
      'Enter the audited release reason (minimum 8 characters).',
    );
    if (!reason || reason.trim().length < 8) return;
    try {
      await operatorRequest(`/controls/${id}/release`, {
        method: 'POST',
        csrf: true,
        body: { reason },
      });
      await load();
    } catch {
      setError(
        'The control could not be released. No local state was changed.',
      );
    }
  }
  async function logout() {
    try {
      await operatorRequest('/logout', { method: 'POST', csrf: true });
    } finally {
      router.replace('/security-ops/sign-in');
      router.refresh();
    }
  }
  if (loading)
    return (
      <main id="security-ops-main" className="ops-shell">
        <p role="status">Loading security operations…</p>
      </main>
    );
  return (
    <>
      <header className="ops-header">
        <div>
          <p className="eyebrow">AEGIS Shield</p>
          <strong>Security Operations</strong>
        </div>
        <button className="button button-quiet" onClick={() => void logout()}>
          Sign out
        </button>
      </header>
      <main id="security-ops-main" className="ops-shell">
        <div className="ops-title">
          <div>
            <p className="eyebrow">Threat detection and controls</p>
            <h1>Risk operations overview</h1>
            <p>
              Deterministic rule decisions, incidents and scoped controls.
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
        {overview ? (
          <section aria-labelledby="metrics-title">
            <h2 id="metrics-title" className="sr-only">
              Overview metrics
            </h2>
            <dl className="ops-metrics">
              <div>
                <dt>Events · 24h</dt>
                <dd>{overview.eventsLast24Hours}</dd>
              </div>
              <div>
                <dt>High / critical</dt>
                <dd>{overview.highCriticalAssessments}</dd>
              </div>
              <div>
                <dt>Active controls</dt>
                <dd>{overview.activeControls}</dd>
              </div>
              <div>
                <dt>Open incidents</dt>
                <dd>{overview.openIncidents}</dd>
              </div>
            </dl>
            <div className="ops-grid">
              <article className="ops-panel">
                <h2>Risk distribution</h2>
                <ul className="risk-bars">
                  {Object.entries(overview.riskDistribution).map(
                    ([band, count]) => (
                      <li key={band}>
                        <span>{band}</span>
                        <strong>{count}</strong>
                      </li>
                    ),
                  )}
                </ul>
              </article>
              <article className="ops-panel">
                <h2>Ingestion health</h2>
                {overview.sourceHealth.length ? (
                  <ul className="ops-list">
                    {overview.sourceHealth.map((item) => (
                      <li key={item.source}>
                        <strong>{item.source}</strong>
                        <span
                          className={
                            item.stale ? 'badge badge-danger' : 'badge'
                          }
                        >
                          {item.stale ? 'Stale' : 'Healthy'}
                        </span>
                        <small>
                          {new Date(item.lastReceivedAt).toLocaleString()}
                        </small>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p role="status">No source has ingested events yet.</p>
                )}
              </article>
            </div>
          </section>
        ) : null}
        <section className="ops-panel">
          <div className="ops-section-title">
            <h2>Recent security events</h2>
            <div className="ops-filters">
              <label>
                Source
                <select
                  value={source}
                  onChange={(event) => setSource(event.target.value)}
                >
                  <option>ALL</option>
                  {[
                    'GATEWAY',
                    'IDENTITY',
                    'PAYMENTS',
                    'LEDGER',
                    'INFRASTRUCTURE',
                    'CHANNEL_ADAPTER',
                  ].map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
              </label>
              <label>
                Severity
                <select
                  value={severity}
                  onChange={(event) => setSeverity(event.target.value)}
                >
                  <option>ALL</option>
                  {['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map(
                    (value) => (
                      <option key={value}>{value}</option>
                    ),
                  )}
                </select>
              </label>
            </div>
          </div>
          {visibleEvents.length ? (
            <div className="ops-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Received</th>
                    <th>Source</th>
                    <th>Event</th>
                    <th>Severity</th>
                    <th>Subject</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleEvents.map((event) => (
                    <tr key={event.id}>
                      <td>{new Date(event.receivedAt).toLocaleString()}</td>
                      <td>{event.source}</td>
                      <td>{event.eventType}</td>
                      <td>
                        <span
                          className={`badge badge-${event.severity.toLowerCase()}`}
                        >
                          {event.severity}
                        </span>
                      </td>
                      <td>
                        <code>{masked(event.subjectId)}</code>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p role="status">No events match these filters.</p>
          )}
          {hasMore.events ? (
            <button
              className="text-button"
              onClick={() => void loadMore('events')}
            >
              Load more events
            </button>
          ) : null}
        </section>
        <div className="ops-grid">
          <section className="ops-panel">
            <h2>High / critical assessments</h2>
            {assessments.filter((item) =>
              ['HIGH', 'CRITICAL'].includes(item.band),
            ).length ? (
              <ul className="ops-list">
                {assessments
                  .filter((item) => ['HIGH', 'CRITICAL'].includes(item.band))
                  .map((item) => (
                    <li key={item.id}>
                      <strong>
                        {item.band} · score {item.score}
                      </strong>
                      <span>{item.decision}</span>
                      <small>
                        {item.triggeredRules.join(', ') || 'No rules'}
                      </small>
                      <p>{item.publicExplanation}</p>
                    </li>
                  ))}
              </ul>
            ) : (
              <p role="status">No high or critical assessments.</p>
            )}
            {hasMore.assessments ? (
              <button
                className="text-button"
                onClick={() => void loadMore('assessments')}
              >
                Load more assessments
              </button>
            ) : null}
          </section>
          <section className="ops-panel">
            <h2>Open incidents</h2>
            {incidents.filter(
              (item) => !['RESOLVED', 'FALSE_POSITIVE'].includes(item.status),
            ).length ? (
              <ul className="ops-list">
                {incidents
                  .filter(
                    (item) =>
                      !['RESOLVED', 'FALSE_POSITIVE'].includes(item.status),
                  )
                  .map((item) => (
                    <li key={item.id}>
                      <Link href={`/security-ops/incidents/${item.id}`}>
                        <strong>{item.title}</strong>
                      </Link>
                      <span>
                        {item.severity} · {item.status}
                      </span>
                      <small>{item.assignedTo || 'Unassigned'}</small>
                    </li>
                  ))}
              </ul>
            ) : (
              <p role="status">No open incidents.</p>
            )}
            {hasMore.incidents ? (
              <button
                className="text-button"
                onClick={() => void loadMore('incidents')}
              >
                Load more incidents
              </button>
            ) : null}
          </section>
        </div>
        <section className="ops-panel">
          <h2>Active controls</h2>
          {controls.filter(
            (item) =>
              item.status === 'ACTIVE' && new Date(item.expiresAt) > new Date(),
          ).length ? (
            <div className="ops-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Scope</th>
                    <th>Reason</th>
                    <th>Expiry</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {controls
                    .filter(
                      (item) =>
                        item.status === 'ACTIVE' &&
                        new Date(item.expiresAt) > new Date(),
                    )
                    .map((item) => (
                      <tr key={item.id}>
                        <td>{item.type}</td>
                        <td>
                          {item.scopeType} · <code>{masked(item.scopeId)}</code>
                        </td>
                        <td>{item.reasonCode}</td>
                        <td>{new Date(item.expiresAt).toLocaleString()}</td>
                        <td>
                          <button
                            className="text-button ops-release"
                            onClick={() => void release(item.id)}
                          >
                            Release
                          </button>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p role="status">No active controls.</p>
          )}
          {hasMore.controls ? (
            <button
              className="text-button"
              onClick={() => void loadMore('controls')}
            >
              Load more controls
            </button>
          ) : null}
        </section>
      </main>
    </>
  );
}
