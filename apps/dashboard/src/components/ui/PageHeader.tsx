export function PageHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <header className="mb-6">
      <h1 className="text-text font-display text-h1 font-extrabold tracking-[-0.035em]">{title}</h1>
      {subtitle ? <p className="text-text-secondary text-label mt-1">{subtitle}</p> : null}
    </header>
  );
}
