/* Minimal inline icon set for the shell + kit (16px stroke icons, currentColor). */

const I = ({ children, size = 16 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {children}
  </svg>
);

export const IconPlus = (p) => (
  <I {...p}>
    <path d="M8 3v10M3 8h10" />
  </I>
);
export const IconBolt = (p) => (
  <I {...p}>
    <path d="M9 1.5 3.5 9H7.5L7 14.5 12.5 7H8.5L9 1.5Z" />
  </I>
);
export const IconArchive = (p) => (
  <I {...p}>
    <path d="M2 5h12v9H2z" />
    <path d="M1.5 2.5h13V5h-13z" />
    <path d="M6.5 8h3" />
  </I>
);
export const IconEye = (p) => (
  <I {...p}>
    <path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8Z" />
    <circle cx="8" cy="8" r="2" />
  </I>
);
export const IconLayers = (p) => (
  <I {...p}>
    <path d="M8 1.8 14.5 5 8 8.2 1.5 5 8 1.8Z" />
    <path d="M1.5 8.5 8 11.7l6.5-3.2" />
    <path d="M1.5 11.5 8 14.7l6.5-3.2" />
  </I>
);
export const IconCalendar = (p) => (
  <I {...p}>
    <rect x="2" y="3" width="12" height="11" rx="1.5" />
    <path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3" />
  </I>
);
export const IconLink = (p) => (
  <I {...p}>
    <path d="M6.5 9.5 9.5 6.5" />
    <path d="M7.5 4.5 9 3a2.8 2.8 0 0 1 4 4l-1.5 1.5" />
    <path d="M8.5 11.5 7 13a2.8 2.8 0 0 1-4-4l1.5-1.5" />
  </I>
);
export const IconClips = (p) => (
  <I {...p}>
    <rect x="2" y="2.5" width="12" height="11" rx="1.5" />
    <path d="M6.5 6l3.5 2-3.5 2V6Z" />
  </I>
);
export const IconAnvil = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
    <path d="M2 4h12v2.2c0 1.6-1.6 2.6-3.6 2.8v1.2h1.1c.3 0 .5.2.5.5v1.8c0 .3-.2.5-.5.5H4.5c-.3 0-.5-.2-.5-.5v-1.8c0-.3.2-.5.5-.5h1.1V9C3.3 8.8 2 7.5 2 5.7V4Z" />
  </svg>
);
