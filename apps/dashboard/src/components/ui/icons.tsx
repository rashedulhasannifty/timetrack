import type { SVGProps } from 'react';

/**
 * Small inline line-icons for the app chrome (no icon dependency — CLAUDE.md §2).
 * 20×20, 1.6 stroke, currentColor so they inherit text tokens. Match the design's
 * SF-style line weight.
 */
function Base({ children, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

export const IconClock = (p: SVGProps<SVGSVGElement>) => (
  <Base {...p}>
    <circle cx="12" cy="12" r="8.25" />
    <path d="M12 7.2V12l3.2 2" />
  </Base>
);

export const IconTeam = (p: SVGProps<SVGSVGElement>) => (
  <Base {...p}>
    <circle cx="9" cy="8.5" r="3.1" />
    <path d="M3.6 19.5a5.4 5.4 0 0 1 10.8 0" />
    {/* The second figure is a smaller full circle set back, not a half-arc: an open arc
        reads as a stray bracket floating beside the first head at 18-20px. */}
    <circle cx="17" cy="9.8" r="2.2" />
    <path d="M15.6 14.9a4.6 4.6 0 0 1 4.8 4.6" />
  </Base>
);

export const IconReports = (p: SVGProps<SVGSVGElement>) => (
  <Base {...p}>
    <path d="M4 20h16" />
    <rect x="5.5" y="11" width="3.4" height="6" rx="1" />
    <rect x="10.8" y="7" width="3.4" height="10" rx="1" />
    <rect x="16.1" y="13" width="3.4" height="4" rx="1" />
  </Base>
);

export const IconApprovals = (p: SVGProps<SVGSVGElement>) => (
  <Base {...p}>
    <circle cx="12" cy="12" r="8.25" />
    <path d="M8.5 12.2l2.3 2.3 4.7-4.9" />
  </Base>
);

export const IconAdmin = (p: SVGProps<SVGSVGElement>) => (
  <Base {...p}>
    <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
    <circle cx="16" cy="7" r="2" />
    <circle cx="8" cy="17" r="2" />
  </Base>
);

export const IconProjects = (p: SVGProps<SVGSVGElement>) => (
  <Base {...p}>
    <path d="M12 3.8 20.2 8 12 12.2 3.8 8Z" />
    {/* The lower strokes run parallel to the diamond's bottom edges (slope 0.5). The previous
        deeper V's read as two stacked down-arrows rather than as layers under a sheet. */}
    <path d="M4.6 11.4 12 15.1l7.4-3.7" />
    <path d="M4.6 15.2 12 18.9l7.4-3.7" />
  </Base>
);

export const IconMoon = (p: SVGProps<SVGSVGElement>) => (
  <Base {...p}>
    <path d="M20 13.5A8 8 0 1 1 10.5 4a6.2 6.2 0 0 0 9.5 9.5Z" />
  </Base>
);

export const IconSun = (p: SVGProps<SVGSVGElement>) => (
  <Base {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2.5v2M12 19.5v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2.5 12h2M19.5 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" />
  </Base>
);

export const IconPower = (p: SVGProps<SVGSVGElement>) => (
  <Base {...p}>
    <path d="M12 3v8" />
    <path d="M6.4 6.8a8 8 0 1 0 11.2 0" />
  </Base>
);

export const IconInfo = (p: SVGProps<SVGSVGElement>) => (
  <Base strokeWidth={1.8} {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5.5M12 7.6v.6" />
  </Base>
);

export const IconMenu = (p: SVGProps<SVGSVGElement>) => (
  <Base {...p}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </Base>
);
