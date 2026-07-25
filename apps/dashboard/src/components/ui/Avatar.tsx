import { avatarColors, initialsFor } from '../../lib/avatar';

/** Round initials chip. Deterministic color from the name (see lib/avatar). */
export function Avatar({
  name,
  size = 30,
  initials,
  className = '',
}: {
  name: string;
  size?: number;
  initials?: string;
  className?: string;
}) {
  const { bg, fg } = avatarColors(name);
  return (
    <span
      aria-hidden="true"
      className={`inline-flex flex-none items-center justify-center rounded-full font-semibold ${className}`}
      style={{
        width: size,
        height: size,
        background: bg,
        color: fg,
        fontSize: Math.round(size * 0.4),
      }}
    >
      {initials ?? initialsFor(name)}
    </span>
  );
}
