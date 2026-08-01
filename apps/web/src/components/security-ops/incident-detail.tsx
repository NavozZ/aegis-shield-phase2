'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { operatorRequest } from '@/lib/security-ops/operator-client';
type Incident = {
  id: string;
  title: string;
  severity: string;
  status: string;
  assignedTo: string | null;
  resolutionReason: string | null;
  createdAt: string;
  assessment: null | {
    score: number;
    band: string;
    decision: string;
    triggeredRules: string[];
    reasonCodes: string[];
    publicExplanation: string;
  };
  controls: Array<{
    id: string;
    type: string;
    status: string;
    reasonCode: string;
    expiresAt: string;
  }>;
  events: Array<{
    id: string;
    eventType: string;
    actorId: string;
    note: string | null;
    occurredAt: string;
  }>;
};
export function IncidentDetail({ incidentId }: { incidentId: string }) {
  const [incident, setIncident] = useState<Incident | null>(null);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [assignee, setAssignee] = useState('');
  const load = useCallback(async () => {
    try {
      setIncident(await operatorRequest<Incident>(`/incidents/${incidentId}`));
    } catch {
      setError('Incident details are unavailable.');
    }
  }, [incidentId]);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  async function update(body: unknown) {
    try {
      await operatorRequest(`/incidents/${incidentId}`, {
        method: 'POST',
        csrf: true,
        body,
      });
      setNote('');
      await load();
    } catch {
      setError('The incident update was rejected. No local state was changed.');
    }
  }
  async function addNote(event: FormEvent) {
    event.preventDefault();
    if (note.trim().length >= 3) await update({ note });
  }
  if (error)
    return (
      <main id="security-ops-main" className="ops-shell">
        <p role="alert">{error}</p>
        <Link href="/security-ops">Return to overview</Link>
      </main>
    );
  if (!incident)
    return (
      <main id="security-ops-main" className="ops-shell">
        <p role="status">Loading incident…</p>
      </main>
    );
  return (
    <>
      <header className="ops-header">
        <Link href="/security-ops">← Security Operations</Link>
        <strong>{incident.severity} incident</strong>
      </header>
      <main id="security-ops-main" className="ops-shell">
        <div className="ops-title">
          <div>
            <p className="eyebrow">Incident {incident.id.slice(0, 8)}</p>
            <h1>{incident.title}</h1>
            <p>
              {incident.status} · opened{' '}
              {new Date(incident.createdAt).toLocaleString()}
            </p>
          </div>
        </div>
        <div className="ops-grid">
          <section className="ops-panel">
            <h2>Assessment explanation</h2>
            {incident.assessment ? (
              <dl className="ops-detail">
                <div>
                  <dt>Score / band</dt>
                  <dd>
                    {incident.assessment.score} · {incident.assessment.band}
                  </dd>
                </div>
                <div>
                  <dt>Decision</dt>
                  <dd>{incident.assessment.decision}</dd>
                </div>
                <div>
                  <dt>Triggered rules</dt>
                  <dd>
                    {incident.assessment.triggeredRules.join(', ') || 'None'}
                  </dd>
                </div>
                <div>
                  <dt>Reason codes</dt>
                  <dd>
                    {incident.assessment.reasonCodes.join(', ') || 'None'}
                  </dd>
                </div>
                <div>
                  <dt>Safe explanation</dt>
                  <dd>{incident.assessment.publicExplanation}</dd>
                </div>
              </dl>
            ) : (
              <p>No linked assessment.</p>
            )}
          </section>
          <section className="ops-panel">
            <h2>Triage actions</h2>
            <label className="field">
              <span>Assign operator identifier</span>
              <input
                value={assignee}
                onChange={(event) => setAssignee(event.target.value)}
                minLength={8}
              />
            </label>
            <button
              className="button"
              disabled={assignee.length < 8}
              onClick={() =>
                void update({
                  assignedTo: assignee,
                  status: 'INVESTIGATING',
                  note: `Assigned to ${assignee}`,
                })
              }
            >
              Assign and investigate
            </button>
            <div className="button-row">
              <button
                className="button"
                onClick={() => {
                  const reason = window.prompt(
                    'Resolution reason (minimum 8 characters)',
                  );
                  if (reason && reason.length >= 8)
                    void update({
                      status: 'RESOLVED',
                      resolutionReason: reason,
                      note: reason,
                    });
                }}
              >
                Resolve
              </button>
              <button
                className="button"
                onClick={() => {
                  const reason = window.prompt(
                    'False-positive reason (minimum 8 characters)',
                  );
                  if (reason && reason.length >= 8)
                    void update({
                      status: 'FALSE_POSITIVE',
                      resolutionReason: reason,
                      note: reason,
                    });
                }}
              >
                Mark false positive
              </button>
              {['RESOLVED', 'FALSE_POSITIVE'].includes(incident.status) ? (
                <button
                  className="button"
                  onClick={() =>
                    void update({
                      status: 'OPEN',
                      note: 'Incident reopened for further investigation.',
                    })
                  }
                >
                  Reopen
                </button>
              ) : null}
            </div>
          </section>
        </div>
        <section className="ops-panel">
          <h2>Linked controls</h2>
          {incident.controls.length ? (
            <ul className="ops-list">
              {incident.controls.map((control) => (
                <li key={control.id}>
                  <strong>{control.type}</strong>
                  <span>
                    {control.status} · {control.reasonCode}
                  </span>
                  <small>
                    Expires {new Date(control.expiresAt).toLocaleString()}
                  </small>
                </li>
              ))}
            </ul>
          ) : (
            <p role="status">No linked controls.</p>
          )}
        </section>
        <section className="ops-panel">
          <h2>Append-only timeline</h2>
          <form className="ops-note" onSubmit={(event) => void addNote(event)}>
            <label className="field">
              <span>Add operator note</span>
              <textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                minLength={3}
                maxLength={1000}
                required
              />
            </label>
            <button className="button" disabled={note.trim().length < 3}>
              Add audited note
            </button>
          </form>
          <ol className="ops-timeline">
            {incident.events.map((item) => (
              <li key={item.id}>
                <strong>{item.eventType}</strong>
                <span>{item.actorId}</span>
                <p>{item.note || 'No note supplied.'}</p>
                <time>{new Date(item.occurredAt).toLocaleString()}</time>
              </li>
            ))}
          </ol>
        </section>
      </main>
    </>
  );
}
