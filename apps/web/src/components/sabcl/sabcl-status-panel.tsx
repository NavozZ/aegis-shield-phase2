import type { SabclStatusResponse } from '@aegis/contracts';
import type { Dictionary } from '@/lib/i18n/dictionaries';

/**
 * Operator status panel.
 *
 * Renders only what the gateway's status contract permits: mode, protocol
 * version, abbreviated key fingerprints, rotation state, capability names,
 * reachability and counters. There is no code path here that could render a
 * key, a route token or a payload, because none of those exist in
 * {@link SabclStatusResponse}.
 *
 * Presentation notes: every group is a section with a heading so screen-reader
 * users can navigate by landmark, and status is conveyed by text rather than by
 * colour alone.
 */
export function SabclStatusPanel({
  status,
  dictionary,
}: {
  status: SabclStatusResponse;
  dictionary: Dictionary;
}) {
  const router = status.router;
  return (
    <div className="sabcl-panel">
      <section aria-labelledby="sabcl-mode-heading">
        <h2 id="sabcl-mode-heading">{dictionary.sabclMode}</h2>
        <dl className="sabcl-facts">
          <div>
            <dt>{dictionary.sabclMode}</dt>
            <dd>
              <span
                className={`status-pill ${status.strict ? 'status-pill-strong' : 'status-pill-warn'}`}
              >
                {status.mode}
              </span>{' '}
              {status.strict
                ? dictionary.sabclStrictOn
                : dictionary.sabclStrictOff}
            </dd>
          </div>
          <div>
            <dt>{dictionary.sabclProtocol}</dt>
            <dd>{status.protocolVersion}</dd>
          </div>
          <div>
            <dt>{dictionary.sabclGatewayKey}</dt>
            <dd>
              <code>{status.gatewayKey ?? '—'}</code>
            </dd>
          </div>
          {router ? (
            <div>
              <dt>{dictionary.sabclRouterKey}</dt>
              <dd>
                <code>{router.routerKey}</code>
              </dd>
            </div>
          ) : null}
          {router ? (
            <div>
              <dt>{dictionary.sabclReplayState}</dt>
              <dd>{router.replayState}</dd>
            </div>
          ) : null}
          {router ? (
            <div>
              <dt>{dictionary.sabclPadding}</dt>
              <dd>
                {router.padding.policy} ({router.padding.unit})
              </dd>
            </div>
          ) : null}
        </dl>
      </section>

      {router ? (
        <section aria-labelledby="sabcl-rotation-heading">
          <h2 id="sabcl-rotation-heading">{dictionary.sabclRotation}</h2>
          <div className="table-scroll">
            <table>
              <caption className="sr-only">{dictionary.sabclRotation}</caption>
              <thead>
                <tr>
                  <th scope="col">{dictionary.sabclRoutes}</th>
                  <th scope="col">{dictionary.sabclActiveKey}</th>
                  <th scope="col">{dictionary.sabclAcceptedKeys}</th>
                  <th scope="col">{dictionary.sabclRevokedKeys}</th>
                </tr>
              </thead>
              <tbody>
                {router.rotation.map((entry) => (
                  <tr key={entry.service}>
                    <th scope="row">{entry.service}</th>
                    <td>
                      <code>{entry.active ?? '—'}</code>
                    </td>
                    <td>{entry.accepted.join(', ') || '—'}</td>
                    <td>{entry.revoked.join(', ') || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {router ? (
        <section aria-labelledby="sabcl-routes-heading">
          <h2 id="sabcl-routes-heading">{dictionary.sabclReachability}</h2>
          <ul className="sabcl-routes">
            {router.reachability.map((entry) => (
              <li key={entry.routeId}>
                {/* Capability name, never a destination URL. */}
                <code>{entry.routeId}</code>
                <span
                  className={`status-pill ${entry.reachable ? 'status-pill-strong' : 'status-pill-warn'}`}
                >
                  {entry.reachable
                    ? dictionary.sabclReachable
                    : dictionary.sabclUnreachable}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {router ? (
        <section aria-labelledby="sabcl-counters-heading">
          <h2 id="sabcl-counters-heading">{dictionary.sabclCounters}</h2>
          <div className="table-scroll">
            <table>
              <caption className="sr-only">{dictionary.sabclCounters}</caption>
              <thead>
                <tr>
                  <th scope="col">{dictionary.sabclCounters}</th>
                  <th scope="col">#</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(router.counters).map(([event, count]) => (
                  <tr key={event}>
                    <th scope="row">{event}</th>
                    <td>{count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}
