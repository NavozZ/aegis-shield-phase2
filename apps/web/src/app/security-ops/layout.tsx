import type { ReactNode } from 'react';
export default function SecurityOpsLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div className="security-ops-page">
      <a className="skip-link" href="#security-ops-main">
        Skip to security operations content
      </a>
      {children}
    </div>
  );
}
