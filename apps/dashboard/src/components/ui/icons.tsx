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
    <circle cx="9" cy="8" r="3" />
    <path d="M3.5 19a5.5 5.5 0 0 1 11 0" />
    <path d="M16 5.2a3 3 0 0 1 0 5.6M17.5 19a5.5 5.5 0 0 0-2.7-4.7" />
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
