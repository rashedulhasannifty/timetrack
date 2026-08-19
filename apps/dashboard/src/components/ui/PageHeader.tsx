export function PageHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <header>
      <h1 className="text-text font-display text-h2 font-semibold tracking-[-0.01em]">{title}</h1>
      {subtitle ? <p className="text-text-secondary text-label mt-1">{subtitle}</p> : null}
    </header>
  );
}
