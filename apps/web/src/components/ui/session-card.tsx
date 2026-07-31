import type { SessionResponse } from '@aegis/contracts';
import type { Dictionary } from '@/lib/i18n/dictionaries';

export function SessionCard({
  session,
  dictionary,
}: {
  session: SessionResponse;
  dictionary: Dictionary;
}) {
  return (
    <dl className="session-card">
      <div>
        <dt>{dictionary.phone}</dt>
        <dd>{session.user.phoneMasked}</dd>
      </div>
      <div>
        <dt>{dictionary.language}</dt>
        <dd>{session.user.preferredLanguage}</dd>
      </div>
      <div>
        <dt>{dictionary.tier}</dt>
        <dd>{dictionary.tierZero}</dd>
      </div>
      <div>
        <dt>{dictionary.authMethod}</dt>
        <dd>
          {session.authenticationMethod === 'PASSKEY'
            ? dictionary.methodPasskey
            : dictionary.methodPinOtp}
        </dd>
      </div>
    </dl>
  );
}

export function EmptyFeatureCard({
  title,
  status,
}: {
  title: string;
  status: string;
}) {
  return (
    <article className="feature-card">
      <span aria-hidden="true">◇</span>
      <h2>{title}</h2>
      <p>{status}</p>
    </article>
  );
}
