// @summary A local command terminal icon; no third-party product logo or bundled branding.
import type { SVGProps } from "react";

export function TerminalCommandIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <rect
        x="2"
        y="3"
        width="20"
        height="18"
        rx="4"
        fill="currentColor"
        fillOpacity="0.08"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path d="M2.5 8h19" stroke="currentColor" strokeOpacity="0.4" />
      <circle cx="6" cy="5.5" r="0.7" fill="currentColor" />
      <circle cx="8.5" cy="5.5" r="0.7" fill="currentColor" opacity="0.5" />
      <path
        d="m6.5 11.5 3 2.5-3 2.5M12 17h5"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
