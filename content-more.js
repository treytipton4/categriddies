// More content for Categriddies Online: extra icons and the player characters.
// The topics themselves live in topics.js.

Object.assign(ICONS, {
  cake:'<path d="M4 21h16v-8H4zM4 16.5c2 1.3 4 1.3 6 0s4-1.3 6 0 4 1.3 4 0M12 13v-3M12 7.5a1.5 1.5 0 0 0 1.5-1.5C13.5 4.5 12 3 12 3s-1.5 1.5-1.5 3A1.5 1.5 0 0 0 12 7.5z"/>',
  bowl:'<path d="M3 11h18a9 9 0 0 1-18 0zM8 21h8M7 8c1-2 3-2 4 0M13 7c1-2 3-2 4 0"/>',
  icecream:'<path d="M7 10a5 5 0 0 1 10 0zM7 10l5 12 5-12"/>',
  camera:'<rect x="2" y="7" width="13" height="10" rx="2"/><path d="m15 11 7-4v10l-7-4"/>',
  ferris:'<circle cx="12" cy="10" r="7"/><path d="M12 3v14M5 10h14M7 5l10 10M17 5 7 15M8 21l4-4 4 4"/>',
  blocks:'<rect x="3" y="12" width="8" height="8" rx="1"/><rect x="13" y="12" width="8" height="8" rx="1"/><rect x="8" y="3" width="8" height="8" rx="1"/>',
  heart:'<path d="M12 20s-8-4.6-8-10.5A4.5 4.5 0 0 1 12 6a4.5 4.5 0 0 1 8 3.5C20 15.4 12 20 12 20z"/>',
  rings:'<circle cx="9" cy="14" r="6"/><circle cx="15" cy="14" r="6"/><path d="m10 4 2-2 2 2-2 2z"/>',
  flame:'<path d="M12 22c4 0 7-3 7-7 0-5-5-7-5-12-3 2-5 5-5 8-1-1-2-2-2-3-2 2-2 4-2 7 0 4 3 7 7 7z"/>',
  rocket:'<path d="M12 2c3.5 2.5 5 6 5 10l-2 5H9l-2-5c0-4 1.5-7.5 5-10z"/><circle cx="12" cy="10" r="2"/><path d="m9 17-2 4M15 17l2 4"/>',
  shirt:'<path d="M8 3 3 6l2 5 3-1v11h8V10l3 1 2-5-5-3a4 4 0 0 1-8 0z"/>',
  chat:'<path d="M21 12a8 8 0 0 1-11.5 7.2L4 21l1.8-5.3A8 8 0 1 1 21 12z"/>',
  pencil:'<path d="M17 3l4 4L8 20H4v-4zM14 6l4 4"/>',
  star2:'<path d="m12 2.5 2.9 6 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.2 1.3-6.6-4.9-4.6 6.6-.8z"/>',
  award:'<circle cx="12" cy="9" r="6"/><path d="M8.5 14 7 22l5-3 5 3-1.5-8"/>',
  menu:'<path d="M4 7h16M4 12h16M4 17h16"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
});

// Player characters: original line drawings, shown on your squares and in the standings.
const AVATARS = {
  fox:'<path d="M4 5l4 4h8l4-4v8a8 7 0 0 1-16 0z"/><circle cx="9.5" cy="13" r=".9"/><circle cx="14.5" cy="13" r=".9"/><path d="M11 16.5h2l-1 1z"/>',
  owl:'<path d="M5 8a7 7 0 0 1 14 0v7a7 7 0 0 1-14 0zM6 3.5l2 3.5M18 3.5l-2 3.5"/><circle cx="9" cy="11" r="2.2"/><circle cx="15" cy="11" r="2.2"/><path d="m11 14.5 1 1.5 1-1.5"/>',
  cat:'<path d="M4 9.5 5 4l4 3h6l4-3 1 5.5V13a8 7 0 0 1-16 0zM2.5 14H7M17 14h4.5"/><circle cx="9" cy="12" r=".9"/><circle cx="15" cy="12" r=".9"/><path d="M11 15h2l-1 1z"/>',
  robot:'<rect x="5" y="7" width="14" height="12" rx="2.5"/><path d="M12 7V4M9.5 16h5M2.5 12h2.5M19 12h2.5"/><circle cx="12" cy="3" r="1"/><circle cx="9.5" cy="12" r="1.2"/><circle cx="14.5" cy="12" r="1.2"/>',
  ghost:'<path d="M5 21V10a7 7 0 0 1 14 0v11l-2.3-1.8-2.4 1.8-2.3-1.8-2.3 1.8-2.4-1.8z"/><circle cx="9.5" cy="10" r="1"/><circle cx="14.5" cy="10" r="1"/>',
  cactus:'<path d="M10 21V6a2 2 0 0 1 4 0v15M10 14H8a2 2 0 0 1-2-2V9M14 12h2a2 2 0 0 0 2-2V7M7 21h10"/>',
  octopus:'<path d="M5 12a7 7 0 0 1 14 0v2H5zM6 14c0 3-2 4-2 6M9.5 14c0 3-1 4-1 6M14.5 14c0 3 1 4 1 6M18 14c0 3 2 4 2 6"/><circle cx="9.5" cy="10.5" r=".9"/><circle cx="14.5" cy="10.5" r=".9"/>',
  frog:'<path d="M3 15a9 6 0 0 0 18 0c0-3-2-5-4-5.5a2.6 2.6 0 1 0-4.6-1.5h-.8A2.6 2.6 0 1 0 7 9.5C5 10 3 12 3 15zM8 15.5q4 3 8 0"/><circle cx="8.5" cy="7.8" r=".9"/><circle cx="15.5" cy="7.8" r=".9"/>',
  whale:'<path d="M2 13c0 4 4 6 9 6 6 0 10-3 11-8-2 1-3 1-4 0 1-2 2-3 2-4-2 0-4 2-5 4-3-1-13-2-13 2zM8 8c0-2 1-3 2-3M8 8c0-2-1-3-2-3"/><circle cx="6.5" cy="13" r=".9"/>',
  toast:'<path d="M5 21V10a4 4 0 0 1 1-7h12a4 4 0 0 1 1 7v11zM10 16q2 1.5 4 0"/><circle cx="9.5" cy="12.5" r=".9"/><circle cx="14.5" cy="12.5" r=".9"/>',
  alien:'<path d="M12 3c5 0 8 3 8 7 0 5-4 11-8 11S4 15 4 10c0-4 3-7 8-7zM7 11c1-2 3-2 4 0-1 1.5-3 1.5-4 0zM13 11c1-2 3-2 4 0-1 1.5-3 1.5-4 0z"/>',
  bear:'<circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="12" cy="13" r="7.5"/><circle cx="12" cy="15.5" r="2.5"/><circle cx="9" cy="11" r=".9"/><circle cx="15" cy="11" r=".9"/>',
  penguin:'<path d="M12 3a6 6 0 0 0-6 6v7a6 5 0 0 0 12 0V9a6 6 0 0 0-6-6zM9 10a3 3 0 0 1 6 0v6a3 3 0 0 1-6 0zM11 11l1 1 1-1M9 21h2M13 21h2"/>',
  dino:'<path d="M4 20v-6a6 6 0 0 1 6-6h3V5a3 3 0 0 1 3-3h1a3 3 0 0 1 3 3v2a2 2 0 0 1-2 2h-2v5l3 3v3M8 20v-3M13 20v-3"/><circle cx="17" cy="4.6" r=".7"/>',
  mushroom:'<path d="M3 11a9 7 0 0 1 18 0zM9 11v7a3 3 0 0 0 6 0v-7"/><circle cx="8" cy="7.5" r="1"/><circle cx="15" cy="6.5" r="1.2"/><circle cx="12" cy="9" r=".8"/>',
  bee:'<path d="M6 13a6 5 0 0 1 12 0 6 5 0 0 1-12 0zM10 8.3v9.4M14 8.3v9.4M9 8c-2-4 1-6 3-3M15 8c2-4-1-6-3-3M18 13h2.5"/>',
};
const AV_KEYS = Object.keys(AVATARS);
const avSvg = (k, cls="av") => `<svg class="${cls}" viewBox="0 0 24 24">${AVATARS[k]||AVATARS.fox}</svg>`;
