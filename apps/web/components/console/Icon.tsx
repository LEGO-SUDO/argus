// Icon — small stroke icons for the console surface (REVIEW-BRIEF Finding 4).
//
// Port of docs/design/project/icons.jsx. Pure inline SVG, inherits color via
// stroke=currentColor. The web app has no icon dependency; this keeps the
// console self-contained and matches the prototype's icon set 1:1.

import type { ReactElement, SVGProps } from 'react';

export type IconName =
  | 'list'
  | 'dollar'
  | 'replay'
  | 'search'
  | 'filter'
  | 'x'
  | 'check'
  | 'plus'
  | 'arrow-right'
  | 'arrow-down-right'
  | 'logout'
  | 'external'
  | 'info'
  | 'warn'
  | 'copy'
  | 'chat'
  | 'sparkles';

// Path data keyed by name. Each entry renders inside a 24×24 stroke viewBox.
const PATHS: Record<IconName, ReactElement> = {
  list: <path d="M4 6h16M4 12h16M4 18h16" />,
  dollar: <path d="M12 3v18M16 7H10a2.5 2.5 0 0 0 0 5h4a2.5 2.5 0 0 1 0 5H8" />,
  replay: (
    <>
      <path d="M4 4v6h6" />
      <path d="M4 10a8 8 0 1 0 2.5-5.8L4 7" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </>
  ),
  filter: <path d="M4 5h16l-6 8v6l-4-2v-4z" />,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  check: <path d="M4 12l5 5L20 6" />,
  plus: <path d="M12 5v14M5 12h14" />,
  'arrow-right': <path d="M5 12h14M13 5l7 7-7 7" />,
  'arrow-down-right': <path d="M7 7l10 10M17 9v8h-8" />,
  logout: (
    <>
      <path d="M9 21H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3" />
      <path d="M16 17l5-5-5-5M21 12H10" />
    </>
  ),
  external: (
    <>
      <path d="M14 4h6v6" />
      <path d="M20 4l-9 9M19 14v6H4V5h6" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8h.01M11 12h1v5h1" />
    </>
  ),
  warn: (
    <>
      <path d="M12 4l10 17H2L12 4z" />
      <path d="M12 10v4M12 18h.01" />
    </>
  ),
  copy: (
    <>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V6a2 2 0 0 1 2-2h9" />
    </>
  ),
  chat: <path d="M21 12a8 8 0 0 1-12 6.9L4 20l1.1-4.6A8 8 0 1 1 21 12z" />,
  sparkles: (
    <>
      <path d="M12 4l1.5 4.5L18 10l-4.5 1.5L12 16l-1.5-4.5L6 10l4.5-1.5z" />
      <path d="M19 16l.7 1.8 1.8.7-1.8.7L19 21l-.7-1.8-1.8-.7 1.8-.7z" />
    </>
  ),
};

export type IconProps = {
  name: IconName;
  size?: number;
} & Omit<SVGProps<SVGSVGElement>, 'name'>;

export function Icon({ name, size = 14, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {PATHS[name]}
    </svg>
  );
}
