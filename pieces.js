// Flat, geometric chess piece silhouettes (viewBox 0 0 45 45), colored via
// the existing .white-piece / .black-piece classes (fill: currentColor).
// Kept as plain path/shape markup so callers can drop it straight into an
// inline <svg>.

const SHARED = {
  P: `
    <circle cx="22.5" cy="11" r="6"/>
    <path d="M15 31 C15 21 30 21 30 31 Z"/>
    <rect x="12" y="31" width="21" height="5" rx="2"/>
  `,
  R: `
    <polygon points="10,18 10,9 15,9 15,12 20,12 20,9 25,9 25,12 30,12 30,9 35,9 35,18"/>
    <path d="M12 18 L33 18 L30 32 L15 32 Z"/>
    <rect x="10" y="32" width="25" height="5" rx="2"/>
  `,
  N: `
    <polygon points="30,32 14,32 14,26 17,22 15,18 17,14 14,11 17,9 19,12
                     22,9 25,10 24,13 27,14 31,18 31,22 29,26"/>
    <circle cx="20" cy="13" r="1.1" class="knight-eye"/>
    <rect x="12" y="32" width="21" height="5" rx="2"/>
  `,
  B: `
    <circle cx="22.5" cy="7.5" r="2.6"/>
    <path d="M15 30 C15 19 18 14 22.5 11 C27 14 30 19 30 30 Z"/>
    <line x1="18.5" y1="17" x2="26.5" y2="21" class="bishop-slit"/>
    <rect x="12" y="31" width="21" height="5" rx="2"/>
  `,
  Q: `
    <circle cx="13" cy="9" r="2.3"/>
    <circle cx="18.5" cy="7" r="2.3"/>
    <circle cx="22.5" cy="9" r="2.3"/>
    <circle cx="26.5" cy="7" r="2.3"/>
    <circle cx="32" cy="9" r="2.3"/>
    <path d="M13 11 L32 11 L33 17 L12 17 Z"/>
    <path d="M14 17 L31 17 L33.5 31 L11.5 31 Z"/>
    <rect x="10" y="31" width="25" height="5" rx="2"/>
  `,
  K: `
    <rect x="21" y="3" width="3" height="9" rx="1"/>
    <rect x="18" y="6.5" width="9" height="3" rx="1"/>
    <path d="M13 14 L32 14 L33 18 L12 18 Z"/>
    <path d="M13 18 L32 18 L34 31 L11 31 Z"/>
    <rect x="10" y="31" width="25" height="5" rx="2"/>
  `,
};

export function pieceShapeMarkup(type) {
  return SHARED[type] || '';
}
