/**
 * Drawn icon set — one consistent family, 24px grid, 1.75 stroke, round caps.
 *
 * Deliberately authored SVG rather than Unicode glyphs (▾, ×, ✓): glyph
 * "icons" inherit font metrics, sit off the optical baseline, and vary by
 * platform. They also can't share a stroke weight with anything else.
 */

type IconProps = {
  size?: number;
  className?: string;
};

function Svg({
  size = 16,
  className,
  children,
}: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export const ChevronDown = (p: IconProps) => (
  <Svg {...p}>
    <path d="m6 9 6 6 6-6" />
  </Svg>
);

export const Close = (p: IconProps) => (
  <Svg {...p}>
    <path d="M18 6 6 18M6 6l12 12" />
  </Svg>
);

export const Plus = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);

export const Search = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </Svg>
);

export const Download = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3v12" />
    <path d="m7 11 5 5 5-5" />
    <path d="M4 20h16" />
  </Svg>
);

export const Upload = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 15V3" />
    <path d="m7 8 5-5 5 5" />
    <path d="M4 20h16" />
  </Svg>
);

export const Save = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h10L20 8.5v10a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5Z" />
    <path d="M8 4v5h7" />
    <path d="M8 20v-5h8v5" />
  </Svg>
);

export const Settings = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 14.5a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1v.3a2 2 0 0 1-4 0v-.2a1.6 1.6 0 0 0-2.8-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7H3.3a2 2 0 0 1 0-4h.2a1.6 1.6 0 0 0 1.1-2.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 2.7-1.1V3.3a2 2 0 0 1 4 0v.2a1.6 1.6 0 0 0 2.8 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7h.3a2 2 0 0 1 0 4h-.2a1.6 1.6 0 0 0-1.5 1Z" />
  </Svg>
);

export const AlertTriangle = (p: IconProps) => (
  <Svg {...p}>
    <path d="M10.3 4.3 2.8 17a2 2 0 0 0 1.7 3h15a2 2 0 0 0 1.7-3l-7.5-12.7a2 2 0 0 0-3.4 0Z" />
    <path d="M12 9v4" />
    <path d="M12 17h.01" />
  </Svg>
);

export const AlertCircle = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 8v5" />
    <path d="M12 16h.01" />
  </Svg>
);

export const Info = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5" />
    <path d="M12 8h.01" />
  </Svg>
);

export const Check = (p: IconProps) => (
  <Svg {...p}>
    <path d="m4.5 12.5 5 5 10-11" />
  </Svg>
);

export const Mail = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="m3.5 6.5 8.5 6 8.5-6" />
  </Svg>
);

export const MailOff = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 8v11h15" />
    <path d="M21 16V5H6" />
    <path d="m3 3 18 18" />
  </Svg>
);

export const Users = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
    <path d="M16 5.2a3.5 3.5 0 0 1 0 5.6" />
    <path d="M18 14.4a6.5 6.5 0 0 1 3.5 5.6" />
  </Svg>
);

export const Building = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 20V5a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v15" />
    <path d="M14 10h5a1 1 0 0 1 1 1v9" />
    <path d="M3 20h18" />
    <path d="M7.5 8h3M7.5 12h3M7.5 16h3M17 14h.01M17 17h.01" />
  </Svg>
);

export const Sparkle = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3.5 13.9 9 19.5 11 13.9 13 12 18.5 10.1 13 4.5 11 10.1 9Z" />
    <path d="M18.5 4v3M20 5.5h-3" />
  </Svg>
);

export const Trash = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 7h16" />
    <path d="M10 4h4" />
    <path d="M6 7v12a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7" />
    <path d="M10 11v5M14 11v5" />
  </Svg>
);

export const Sliders = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 7h10M18 7h2" />
    <path d="M4 17h4M12 17h8" />
    <circle cx="16" cy="7" r="2" />
    <circle cx="10" cy="17" r="2" />
  </Svg>
);

export const Reset = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1" />
    <path d="M3 4v5h5" />
  </Svg>
);
