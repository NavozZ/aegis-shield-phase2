const pillars = [
  {
    number: '01',
    title: 'Inclusive access',
    description:
      'One secure foundation for web, QR, USSD, and assisted channels.',
  },
  {
    number: '02',
    title: 'Protected transactions',
    description:
      'Explicit trust decisions and accountable financial workflows by design.',
  },
  {
    number: '03',
    title: 'Bounded failures',
    description:
      'Independent service boundaries prevent one incident from becoming systemic.',
  },
  {
    number: '04',
    title: 'Recoverable by design',
    description:
      'Auditability, reconciliation, and recovery are planned as core capabilities.',
  },
] as const;

const statuses = [
  {
    label: 'Current foundation',
    value: 'Monorepo ready',
    detail: 'Shared tooling and application boundaries',
  },
  {
    label: 'Web application',
    value: 'Foundation online',
    detail: 'Next.js customer experience shell',
  },
  {
    label: 'API gateway',
    value: 'Scaffold ready',
    detail: 'Static status placeholder · port 4000',
  },
] as const;

export default function Home() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-[#061225] text-slate-50">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_14%_8%,rgba(14,165,233,0.16),transparent_32%),radial-gradient(circle_at_86%_24%,rgba(20,184,166,0.13),transparent_28%),linear-gradient(rgba(148,163,184,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.035)_1px,transparent_1px)] bg-[size:auto,auto,52px_52px,52px_52px]"
      />

      <a
        href="#main-content"
        className="absolute left-4 top-4 z-50 -translate-y-24 rounded-md bg-teal-300 px-4 py-2 font-semibold text-slate-950 transition-transform focus:translate-y-0"
      >
        Skip to content
      </a>

      <header className="relative z-10 border-b border-white/10">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-5 sm:px-8 lg:px-12">
          <a
            href="#main-content"
            className="flex items-center gap-3"
            aria-label="AEGIS Shield home"
          >
            <span className="grid size-11 place-items-center rounded-[14px] border border-teal-300/40 bg-teal-300/10 text-sm font-black tracking-[0.14em] text-teal-200 shadow-[0_0_32px_rgba(45,212,191,0.12)]">
              AS
            </span>
            <span>
              <span className="block text-sm font-bold tracking-[0.2em] text-white">
                AEGIS SHIELD
              </span>
              <span className="block text-[0.65rem] tracking-[0.16em] text-slate-400">
                DUOTHAN 6.0
              </span>
            </span>
          </a>

          <nav
            aria-label="Foundation navigation"
            className="hidden items-center gap-7 text-sm text-slate-300 sm:flex"
          >
            <a
              className="transition-colors hover:text-teal-200"
              href="#platform"
            >
              Platform
            </a>
            <a className="transition-colors hover:text-teal-200" href="#status">
              Status
            </a>
          </nav>
        </div>
      </header>

      <main id="main-content" className="relative z-10">
        <section className="mx-auto grid max-w-7xl gap-14 px-5 pb-20 pt-16 sm:px-8 sm:pt-24 lg:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)] lg:px-12 lg:pb-28 lg:pt-32">
          <div>
            <div className="mb-7 inline-flex items-center gap-3 rounded-full border border-sky-300/20 bg-sky-300/5 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-sky-200">
              <span className="size-2 rounded-full bg-teal-300 shadow-[0_0_14px_rgba(94,234,212,0.9)]" />
              Phase 2 REBUILD
            </div>

            <p className="mb-4 text-sm font-semibold uppercase tracking-[0.22em] text-teal-300">
              Autonomous Encrypted Grid for Inclusive Services
            </p>
            <h1 className="max-w-4xl text-5xl font-semibold leading-[1.02] tracking-[-0.045em] text-white sm:text-6xl lg:text-7xl">
              Banking infrastructure built to remain trusted.
            </h1>
            <p className="mt-7 max-w-2xl text-lg leading-8 text-slate-300 sm:text-xl">
              A zero-trust banking platform designed to keep access inclusive,
              transactions protected, failures contained, and recovery
              verifiable.
            </p>

            <div className="mt-10 flex flex-col gap-4 sm:flex-row">
              <a
                className="inline-flex min-h-12 items-center justify-center rounded-lg bg-teal-300 px-6 py-3 text-sm font-bold text-slate-950 transition-colors hover:bg-teal-200"
                href="#platform"
              >
                Explore the foundation
              </a>
              <a
                className="inline-flex min-h-12 items-center justify-center rounded-lg border border-white/15 bg-white/5 px-6 py-3 text-sm font-semibold text-white transition-colors hover:border-sky-300/40 hover:bg-sky-300/10"
                href="http://localhost:4000/health"
              >
                API health endpoint
              </a>
            </div>
          </div>

          <aside
            id="status"
            aria-labelledby="status-title"
            className="self-end rounded-2xl border border-white/10 bg-slate-950/55 p-5 shadow-2xl shadow-sky-950/30 backdrop-blur sm:p-7"
          >
            <div className="mb-6 flex items-center justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                  System overview
                </p>
                <h2
                  id="status-title"
                  className="mt-2 text-xl font-semibold text-white"
                >
                  Foundation status
                </h2>
              </div>
              <span className="rounded-full border border-teal-300/20 bg-teal-300/10 px-3 py-1 text-xs font-semibold text-teal-200">
                P01
              </span>
            </div>

            <dl className="space-y-3">
              {statuses.map((item) => (
                <div
                  key={item.label}
                  className="rounded-xl border border-white/8 bg-white/[0.035] p-4"
                >
                  <div className="flex items-start justify-between gap-4">
                    <dt className="text-sm text-slate-400">{item.label}</dt>
                    <span
                      aria-hidden="true"
                      className="mt-1.5 size-2 rounded-full bg-teal-300"
                    />
                  </div>
                  <dd className="mt-2 font-semibold text-white">
                    {item.value}
                  </dd>
                  <dd className="mt-1 text-xs leading-5 text-slate-400">
                    {item.detail}
                  </dd>
                </div>
              ))}
            </dl>
          </aside>
        </section>

        <section
          id="platform"
          aria-labelledby="platform-title"
          className="border-y border-white/10 bg-slate-950/35"
        >
          <div className="mx-auto max-w-7xl px-5 py-16 sm:px-8 lg:px-12 lg:py-20">
            <div className="max-w-2xl">
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-sky-300">
                Platform principles
              </p>
              <h2
                id="platform-title"
                className="mt-3 text-3xl font-semibold tracking-tight text-white sm:text-4xl"
              >
                Four pillars for resilient digital banking
              </h2>
            </div>

            <div className="mt-10 grid gap-px overflow-hidden rounded-2xl border border-white/10 bg-white/10 sm:grid-cols-2 lg:grid-cols-4">
              {pillars.map((pillar) => (
                <article key={pillar.title} className="bg-[#09182d] p-6 sm:p-7">
                  <p className="font-mono text-xs font-bold tracking-[0.18em] text-teal-300">
                    {pillar.number}
                  </p>
                  <h3 className="mt-8 text-xl font-semibold text-white">
                    {pillar.title}
                  </h3>
                  <p className="mt-3 text-sm leading-6 text-slate-400">
                    {pillar.description}
                  </p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section
          aria-labelledby="prototype-title"
          className="mx-auto max-w-7xl px-5 py-14 sm:px-8 lg:px-12"
        >
          <div className="flex flex-col justify-between gap-5 rounded-2xl border border-amber-200/20 bg-amber-100/[0.04] p-6 sm:flex-row sm:items-center sm:p-8">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-amber-200">
                Prototype boundary
              </p>
              <h2
                id="prototype-title"
                className="mt-2 text-xl font-semibold text-white"
              >
                Synthetic data only
              </h2>
            </div>
            <p className="max-w-2xl text-sm leading-6 text-slate-300">
              This is a hackathon prototype. It does not provide live banking
              services and must never contain real customer data, account
              credentials, or financial transactions.
            </p>
          </div>
        </section>
      </main>

      <footer className="relative z-10 border-t border-white/10">
        <div className="mx-auto flex max-w-7xl flex-col gap-2 px-5 py-7 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between sm:px-8 lg:px-12">
          <p>AEGIS Shield · Duothan 6.0 Phase 2</p>
          <p>Foundation milestone · no banking operations enabled</p>
        </div>
      </footer>
    </div>
  );
}
