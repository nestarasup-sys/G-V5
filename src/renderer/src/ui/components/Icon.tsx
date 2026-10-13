export type IconName =
  | 'plus' | 'search' | 'check' | 'expand' | 'frame' | 'zoomIn' | 'zoomOut'
  | 'chevronDown' | 'sliders' | 'chevronLeft' | 'chevronRight' | 'sparkles'
  | 'body' | 'face' | 'shirt' | 'flower' | 'message' | 'paw' | 'box' | 'user'
  | 'bow' | 'camera' | 'gamepad' | 'settings' | 'star' | 'edit' | 'bell'

const paths: Record<IconName, string> = {
  plus: 'M12 5v14M5 12h14',
  search: 'm20 20-4.2-4.2M10.8 18a7.2 7.2 0 1 0 0-14.4 7.2 7.2 0 0 0 0 14.4Z',
  check: 'm5 12 4 4L19 6',
  expand: 'M8 3H5a2 2 0 0 0-2 2v3m13-5h3a2 2 0 0 1 2 2v3M3 16v3a2 2 0 0 0 2 2h3m13-5v3a2 2 0 0 1-2 2h-3',
  frame: 'M4 7V5a1 1 0 0 1 1-1h2m10 0h2a1 1 0 0 1 1 1v2M20 17v2a1 1 0 0 1-1 1h-2m-10 0H5a1 1 0 0 1-1-1v-2M7 7h10v10H7z',
  zoomIn: 'M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16Zm10 2-4.4-4.4M11 7v8m-4-4h8',
  zoomOut: 'M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16Zm10 2-4.4-4.4M7 11h8',
  chevronDown: 'm6 9 6 6 6-6',
  sliders: 'M4 7h9m4 0h3M4 17h3m4 0h9M13 4v6M7 14v6',
  chevronLeft: 'm15 18-6-6 6-6',
  chevronRight: 'm9 18 6-6-6-6',
  sparkles: 'm12 3 1.7 5.3L19 10l-5.3 1.7L12 17l-1.7-5.3L5 10l5.3-1.7L12 3Zm7 11 .9 2.1L22 17l-2.1.9L19 20l-.9-2.1L16 17l2.1-.9L19 14ZM5 3l.8 1.7L7.5 5.5l-1.7.8L5 8l-.8-1.7-1.7-.8 1.7-.8L5 3Z',
  body: 'M12 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6ZM8 11h8l2 10H6l2-10Zm0 0-3 3m11-3 3 3M9 14v4m6-4v4',
  face: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm-3 7h.01M15 10h.01M8.5 15c1 .9 2.2 1.3 3.5 1.3s2.5-.4 3.5-1.3M12 10v3',
  shirt: 'm8 4 4 2 4-2 5 4-3 4-2-1v10H8V11l-2 1-3-4 5-4Z',
  flower: 'M12 8c-3-5-7-2-4 1-5-1-6 4-1 5-4 4 0 7 3 3 0 5 5 5 5 0 4 4 7 0 3-3 5-1 4-6-1-5 3-4-1-7-5-1Z M12 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z',
  message: 'M4 5h16v12H9l-5 4V5Zm4 5h.01M12 10h.01M16 10h.01',
  paw: 'M8 11c-1.5 0-2.5-1.7-2.5-3.5S6.4 4 8 4s2.5 1.7 2.5 3.5S9.5 11 8 11Zm8 0c-1.5 0-2.5-1.7-2.5-3.5S14.4 4 16 4s2.5 1.7 2.5 3.5S17.5 11 16 11ZM4.5 15c-1.3-1.1-3.2-.4-3.2 1.3 0 1.3 1.2 2.1 2.5 2.1 1.2 0 2.1-.8 2.1-1.8 0-.7-.6-1.2-1.4-1.6Zm15 0c1.3-1.1 3.2-.4 3.2 1.3 0 1.3-1.2 2.1-2.5 2.1-1.2 0-2.1-.8-2.1-1.8 0-.7.6-1.2 1.4-1.6ZM12 12c-3 0-6 2.5-6 5 0 2.2 2.5 3 6 3s6-.8 6-3c0-2.5-3-5-6-5Z',
  box: 'M4 7 12 3l8 4v10l-8 4-8-4V7Zm0 0 8 4 8-4M12 11v10M8 5l8 4',
  user: 'M20 21a8 8 0 0 0-16 0m8-10a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z',
  bow: 'M12 12c-2-4-7-6-9-4-2 2 0 7 5 7l4-3Zm0 0c2-4 7-6 9-4 2 2 0 7-5 7l-4-3Zm0 0v7m-2 2 2-2 2 2',
  camera: 'M4 7h3l2-3h6l2 3h3a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Zm8 10a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z',
  gamepad: 'M7 8h10a5 5 0 0 1 4.8 6.4l-1.1 3.4a2 2 0 0 1-3.2 1l-3-2.3h-5l-3 2.3a2 2 0 0 1-3.2-1l-1.1-3.4A5 5 0 0 1 7 8Zm1 3v5m-2.5-2.5h5M16 13h.01M18 15h.01',
  settings: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm0-5v2m0 14v2m9-9h-2M5 12H3m15.4-6.4-1.4 1.4M7 17l-1.4 1.4m12.8 0L17 17M7 7 5.6 5.6',
  star: 'm12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9L12 3Z',
  edit: 'm15 5 4 4m-11 11 4.5-1 9-9a2.8 2.8 0 0 0-4-4l-9 9L7 20ZM4 20h4',
  bell: 'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9Zm-8 12a2 2 0 0 0 4 0'
}

export function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={paths[name]} />
    </svg>
  )
}
