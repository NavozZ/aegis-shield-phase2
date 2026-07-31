export function PrototypeWarning({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <aside className="notice notice-warning" aria-label={title}>
      <strong>{title}</strong>
      <p>{children}</p>
    </aside>
  );
}

export function SecurityNotice({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <aside className="notice notice-security">
      <strong>{title}</strong>
      <p>{children}</p>
    </aside>
  );
}

export function StatusBanner({
  tone = 'info',
  children,
}: {
  tone?: 'info' | 'success' | 'error';
  children: React.ReactNode;
}) {
  return (
    <div
      className={`status-banner status-${tone}`}
      role={tone === 'error' ? 'alert' : 'status'}
      aria-live="polite"
    >
      {children}
    </div>
  );
}

export function FormErrorSummary({
  title,
  message,
  focusRef,
}: {
  title: string;
  message?: string;
  focusRef?: React.Ref<HTMLDivElement>;
}) {
  if (!message) return null;
  return (
    <div ref={focusRef} className="error-summary" role="alert" tabIndex={-1}>
      <strong>{title}</strong>
      <p>{message}</p>
    </div>
  );
}

export function LoadingButton({
  loading,
  loadingLabel,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  loading: boolean;
  loadingLabel: string;
}) {
  return (
    <button {...props} disabled={loading || props.disabled} aria-busy={loading}>
      {loading ? (
        <>
          <span className="spinner" aria-hidden="true" /> {loadingLabel}
        </>
      ) : (
        children
      )}
    </button>
  );
}
