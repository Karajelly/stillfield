const paths: Record<string, string> = {
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42m0-14.14-1.42 1.42M6.35 17.65l-1.42 1.42"/>',
  sound:
    '<path d="m11 5-6 4H2v6h3l6 4V5Zm4 3a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
  muted: '<path d="m11 5-6 4H2v6h3l6 4V5Zm5 4 6 6m0-6-6 6"/>',
  settings:
    '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3" fill="currentColor"/><circle cx="15" cy="17" r="3" fill="currentColor"/>',
  pause: '<path d="M9 5v14M15 5v14" stroke-width="3"/>',
  play: '<path d="m8 5 11 7-11 7V5Z"/>',
  leaf: '<path d="M20 4c-1 10-3 15-10 15-4 0-6-3-5-6C6 7 12 6 20 4Z"/><path d="M4 21 15 10"/>',
  mow: '<path d="M3 19h18M6 16l-2-5m7 5V6m5 10 4-9M7 9 5 6m10 5 2-7"/>',
  cultivate:
    '<path d="m8 3 5 12M3 19c3-4 5 4 9 0s6 3 9 0M8 14l9-4m-10 4 2 4m3-6 2 4m3-6 2 4"/>',
  harvest: '<path d="M4 12h16l-2 8H6l-2-8Zm4 0 4-8 4 8M8 16h8"/>',
  restore:
    '<path d="M4 19h16M7 16l-2-5m7 5V8m5 8 2-5M6 5a8 8 0 0 1 13 3M19 3v5h-5"/>',
  sow: '<path d="M12 20v-8M12 15C5 15 4 11 4 8c5 0 8 3 8 7Zm0-3c0-6 3-8 8-8 0 5-3 8-8 8ZM5 21h14"/>',
  wheat:
    '<path d="M12 22V3"/>' +
    [4, 9, 14]
      .map((y) =>
        [-1, 1]
          .map(
            (side) =>
              `<path d="M12 ${y + 4}Q${12 + side * 5} ${y + 3} ${12 + side * 5} ${y}Q12 ${y} 12 ${y + 4}Z"/>`,
          )
          .join(""),
      )
      .join(""),
  sunflowers:
    '<path d="M12 16v6M12 20Q8 17 7 17Q7 21 12 20"/><circle cx="12" cy="9" r="2.4"/>' +
    Array.from(
      { length: 8 },
      (_, i) =>
        `<circle cx="${12 + Math.sin((i * Math.PI) / 4) * 4.4}" cy="${9 + Math.cos((i * Math.PI) / 4) * 4.4}" r="1.6"/>`,
    ).join(""),
  pumpkins:
    '<ellipse cx="12" cy="14.5" rx="8" ry="6.5"/><ellipse cx="12" cy="14.5" rx="4" ry="6.5"/><path d="M12 8Q10 4 14 3M13 6Q18 2 20 5Q17 8 13 6"/>',
  wander:
    '<path d="M5 19c-9-7 12-7 7-14m0 0-3 3m3-3 3 3m3 11h.01"/><circle cx="18" cy="18" r="3"/>',
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  reset: '<path d="M3 11a9 9 0 1 1 2 7M3 4v7h7"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 2-2.5 2-2.5 4m0 3h.01"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  guide: '<path d="M6 4v16M12 4v16M18 4v16" stroke-dasharray="2 4"/>',
  feather: '<path d="M20 4c-5-4-14 5-11 10 5 3 14-6 11-10ZM4 20 16 8M9 14h6"/>',
  expand: '<path d="M9 3H3v6m12-6h6v6M3 15v6h6m12-6v6h-6"/>',
  down: '<path d="m7 10 5 5 5-5"/>',
  right: '<path d="m10 7 5 5-5 5"/>',
  signpost: '<path d="M11 21V3m-5 18h10M5 6h10l3 2.5-3 2.5H5V6Zm14 7H9v5h10l2-2.5-2-2.5Z"/>',
  menu: '<path d="M5 6h14M5 12h14M5 18h14"/>',
  camera:
    '<path d="M8 5h8l2 3h3v12H3V8h3l2-3Z"/><circle cx="12" cy="13" r="4"/>',
};
export const icon = (name: string, cls = "") =>
  `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.leaf}</svg>`;
export const brandMark = `<svg viewBox="0 0 42 42" fill="none" aria-hidden="true"><path d="M5 31c10-8 22-8 32 0M5 36c10-8 22-8 32 0M8 25c8-6 18-6 26 0" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M14 17a7 7 0 0 1 14 0" stroke="currentColor" stroke-width="2"/><path d="M21 4v3M9 9l2 2M31 11l2-2M4 18h3m28 0h3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`;
