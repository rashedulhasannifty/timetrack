export function PageHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <header className="mb-6">
      <h1 className="text-text font-display text-h1 font-semibold tracking-tight">{title}</h1>
      {subtitle ? <p className="text-text-secondary text-body mt-1">{subtitle}</p> : null}
    </header>
  );
}
