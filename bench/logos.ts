// Synthetic test logos with exact known geometry.
export const LOGOS: Record<string, string> = {
  badge: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" width="400" height="400">
    <rect width="400" height="400" fill="#ffffff"/>
    <circle cx="200" cy="150" r="110" fill="#c8102e"/>
    <circle cx="200" cy="150" r="88" fill="none" stroke="#ffffff" stroke-width="6"/>
    <polygon points="200,80 217,130 270,130 227,161 243,212 200,181 157,212 173,161 130,130 183,130" fill="#ffffff"/>
    <rect x="40" y="285" width="320" height="70" rx="14" fill="#1b2a41"/>
    <text x="200" y="335" font-family="Helvetica, Arial" font-weight="bold" font-size="46" fill="#f2b705" text-anchor="middle">WALEX</text>
  </svg>`,
  geometric: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300" width="400" height="300">
    <rect width="400" height="300" fill="#ffffff"/>
    <rect x="30" y="40" width="110" height="110" fill="#0057b8"/>
    <polygon points="210,40 280,150 140,150" fill="#ffb81c" transform="translate(30 0)"/>
    <circle cx="330" cy="95" r="55" fill="none" stroke="#00843d" stroke-width="16"/>
    <rect x="30" y="190" width="340" height="12" fill="#222222"/>
    <path d="M30 240 L120 240 L150 270 L60 270 Z" fill="#7a3e9d"/>
    <rect x="200" y="225" width="170" height="55" rx="27" fill="#e4002b"/>
  </svg>`,
  lineart: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300" width="400" height="300">
    <rect width="400" height="300" fill="#ffffff"/>
    <circle cx="90" cy="100" r="55" fill="none" stroke="#111111" stroke-width="1.6"/>
    <path d="M40 200 L140 200 M40 215 L140 230 M40 245 L140 245" stroke="#111111" stroke-width="2" fill="none"/>
    <rect x="190" y="50" width="170" height="90" rx="10" fill="none" stroke="#d62828" stroke-width="2.5"/>
    <text x="275" y="105" font-family="Helvetica, Arial" font-size="18" fill="#003049" text-anchor="middle">PRO FINISHES</text>
    <text x="275" y="220" font-family="Georgia, serif" font-size="30" font-style="italic" fill="#d62828" text-anchor="middle">The Wall Experts</text>
  </svg>`,
  curves: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300" width="400" height="300">
    <rect width="400" height="300" fill="#ffffff"/>
    <ellipse cx="95" cy="80" rx="75" ry="45" fill="#2a9d8f"/>
    <path d="M200 40 C 260 0, 330 60, 380 30 L 380 60 C 330 90, 260 30, 200 70 Z" fill="#e76f51"/>
    <path d="M40 200 C 40 140, 140 150, 150 190 C 160 230, 110 270, 70 260 C 30 250, 40 230, 40 200 Z" fill="#264653"/>
    <path d="M200 280 C 200 200, 300 260, 300 180 S 380 150, 385 120" fill="none" stroke="#e9c46a" stroke-width="14" stroke-linecap="round"/>
    <circle cx="300" cy="250" r="22" fill="none" stroke="#264653" stroke-width="5"/>
  </svg>`,
};
