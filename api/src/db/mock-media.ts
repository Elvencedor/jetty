/**
 * Mock product photography for local testing: small illustrated SVGs, generated rather than stored, so the repository
 * carries no binary files. A wig is drawn from its texture, length and colour; care products and accessories get a
 * simple object. Three angles each: front, side and a close-up of the hair.
 */

export type MockKind = 'straight' | 'wave' | 'curly' | 'bob' | 'care' | 'accessory';
export type MockSpec = { kind: MockKind; /** Hair colour, #rrggbb. */ hair: string; /** 0 (shortest) to 1 (longest) within the wig range. */ length: number; /** Background tint index. */ tone: number; seed: number };
export type MockAngle = 'front' | 'side' | 'detail';

export const MOCK_ANGLES: MockAngle[] = ['front', 'side', 'detail'];
export const MOCK_SIZE = { width: 800, height: 1000 };

const BACKGROUNDS: [string, string][] = [
  ['#fbe3ec', '#f4bfd2'],
  ['#fdeef3', '#e9a9c0'],
  ['#f6dfe9', '#d98aa9'],
  ['#fff1e8', '#f1c3b3'],
  ['#efe1ef', '#c9a3c9'],
];
const SKIN = '#8a5a44';
const SKIN_SHADE = '#6e4533';

/** Small deterministic generator, so a product always gets the same picture. */
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (shift: number) => Math.max(0, Math.min(255, Math.round(((n >> shift) & 255) + amount * 255)));
  return `#${[16, 8, 0].map((s) => ch(s).toString(16).padStart(2, '0')).join('')}`;
}

const frame = (inner: string, tone: number, id: string) => {
  const [a, b] = BACKGROUNDS[Math.abs(tone) % BACKGROUNDS.length]!;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${MOCK_SIZE.width} ${MOCK_SIZE.height}" width="${MOCK_SIZE.width}" height="${MOCK_SIZE.height}">
<defs><linearGradient id="bg${id}" x1="0" y1="0" x2="0.4" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>
<rect width="800" height="1000" fill="url(#bg${id})"/>
<ellipse cx="400" cy="960" rx="300" ry="34" fill="#000" opacity="0.08"/>
${inner}
</svg>`;
};

/** Shoulders and neck, drawn first so long hair falls in front of them. */
function body(): string {
  return `<path d="M120 1000 C130 800 230 760 330 740 L470 740 C570 760 670 800 680 1000 Z" fill="#f7f0f3"/>
<rect x="352" y="610" width="96" height="150" rx="40" fill="${SKIN_SHADE}"/>`;
}

/** The face, on top of the hair. `turn` shifts and narrows it for the three-quarter view. */
function face(turn: number): string {
  const cx = 400 + turn;
  const eyes = turn ? [cx - 8, cx + 34] : [cx - 38, cx + 38];
  return `<ellipse cx="${cx}" cy="470" rx="${turn ? 94 : 108}" ry="138" fill="${SKIN}"/>
${eyes.map((x) => `<ellipse cx="${x}" cy="478" rx="8" ry="5" fill="#2a1710" opacity="0.7"/>`).join('')}
<path d="M${cx - 22 + turn * 0.4} 560 Q${cx + turn * 0.4} 576 ${cx + 22 + turn * 0.4} 560" stroke="#4a1f1f" stroke-width="5" fill="none" stroke-linecap="round"/>`;
}

function hairPath(kind: MockKind, length: number, r: () => number, flip = 1) {
  const bottom = kind === 'bob' ? 600 + length * 80 : 640 + length * 330;
  const spread = kind === 'curly' ? 215 : kind === 'wave' ? 190 : 170;
  const x = (dx: number) => 400 + dx * flip;
  const wobble = () => (kind === 'wave' ? (r() - 0.5) * 50 : 0);
  const segs = 7;
  const pts: string[] = [];
  const side = (dir: 1 | -1) => {
    const out: string[] = [];
    for (let i = 1; i <= segs; i++) {
      const y = 330 + ((bottom - 330) * i) / segs;
      const w = (kind === 'curly' ? spread + 25 * Math.sin(i * 1.7) : spread + (i % 2 ? 14 : -4) * (kind === 'wave' ? 1.6 : 0.4)) + wobble();
      out.push(`L${x(dir * w)} ${y}`);
    }
    return out;
  };
  pts.push(`M${x(-110)} 330 C${x(-150)} 230 ${x(-60)} 190 ${x(0)} 190 C${x(60)} 190 ${x(150)} 230 ${x(110)} 330`);
  pts.push(...side(1));
  pts.push(`L${x(-spread)} ${bottom}`);
  pts.push(...side(-1).reverse());
  return { d: `${pts.join(' ')} Z`, bottom };
}

function hair(spec: MockSpec, angle: MockAngle): string {
  const r = rng(spec.seed + (angle === 'side' ? 7 : 0));
  const base = spec.hair;
  const dark = shade(base, -0.12);
  const light = shade(base, 0.18);
  const flip = angle === 'side' ? -1 : 1;
  const { d, bottom } = hairPath(spec.kind, spec.length, r, flip);
  let strands = '';
  for (let i = 0; i < 9; i++) {
    const sx = 400 + (i - 4) * 38 * flip;
    const wave = spec.kind === 'wave' ? 26 : spec.kind === 'curly' ? 34 : 4;
    strands += `<path d="M${sx} 230 C${sx + wave} ${400} ${sx - wave} ${bottom - 200} ${sx + (r() - 0.5) * 16} ${bottom - 20}" stroke="${i % 2 ? light : dark}" stroke-width="${spec.kind === 'curly' ? 5 : 3}" fill="none" opacity="0.45" stroke-linecap="round"/>`;
  }
  let curls = '';
  if (spec.kind === 'curly') {
    for (let i = 0; i < 70; i++) {
      const cy = 230 + r() * (bottom - 230);
      const reach = 150 + 70 * Math.sin(((cy - 230) / (bottom - 230)) * 3.1);
      const cx = 400 + (r() * 2 - 1) * reach;
      curls += `<circle cx="${cx.toFixed(0)}" cy="${cy.toFixed(0)}" r="${(16 + r() * 16).toFixed(0)}" fill="${i % 3 ? base : dark}" stroke="${light}" stroke-opacity="0.35" stroke-width="3"/>`;
    }
  }
  // The face sits in front of the hair; the hairline and parting go on top.
  const turn = angle === 'side' ? 44 : 0;
  const hairline = `<path d="M${296 + turn} 400 C${320 + turn} 320 ${480 + turn} 320 ${504 + turn} 400 C${470 + turn} 360 ${330 + turn} 360 ${296 + turn} 400 Z" fill="${base}"/>`;
  const parting = `<path d="M${400 + turn} 328 L${400 + turn} 190" stroke="${dark}" stroke-width="4" opacity="0.6"/>`;
  const scene = `${body()}<g transform="translate(${turn * 0.7} 0)"><path d="${d}" fill="${base}"/>${curls}${strands}</g>${face(turn)}${hairline}${parting}`;
  return `<g transform="translate(400 560) scale(1.12) translate(-400 -560)">${scene}</g>`;
}

function detail(spec: MockSpec): string {
  const r = rng(spec.seed + 31);
  const base = spec.hair;
  const dark = shade(base, -0.14);
  const light = shade(base, 0.2);
  let body = `<rect x="60" y="120" width="680" height="760" rx="48" fill="${base}"/>`;
  if (spec.kind === 'curly') {
    for (let i = 0; i < 110; i++) body += `<circle cx="${(100 + r() * 600).toFixed(0)}" cy="${(160 + r() * 680).toFixed(0)}" r="${(24 + r() * 22).toFixed(0)}" fill="${i % 3 ? base : dark}" stroke="${light}" stroke-opacity="0.45" stroke-width="4"/>`;
  } else {
    const amp = spec.kind === 'wave' ? 46 : spec.kind === 'bob' ? 8 : 6;
    for (let i = 0; i < 26; i++) {
      const x = 80 + i * 26;
      body += `<path d="M${x} 130 C${x + amp} 330 ${x - amp} 560 ${x + amp * 0.6} 870" stroke="${i % 2 ? light : dark}" stroke-width="${6 + (i % 3) * 2}" fill="none" opacity="0.55" stroke-linecap="round"/>`;
    }
  }
  body += `<path d="M60 150 Q400 60 740 150 L740 250 Q400 170 60 250 Z" fill="#f3e3d8" opacity="0.9"/><path d="M60 190 Q400 105 740 190" stroke="#fff" stroke-width="3" fill="none" opacity="0.6"/>`;
  return body;
}

function care(spec: MockSpec, angle: MockAngle): string {
  const base = spec.hair;
  const bottle = (x: number, h: number, label: string) => `<g transform="translate(${x} ${940 - h})"><rect width="170" height="${h}" rx="34" fill="${base}"/><rect x="48" y="-44" width="74" height="52" rx="12" fill="#2a1a22"/><rect x="22" y="${h * 0.34}" width="126" height="${h * 0.38}" rx="14" fill="#fff" opacity="0.92"/><rect x="40" y="${h * 0.34 + 22}" width="90" height="10" rx="5" fill="${shade(base, -0.1)}"/><rect x="54" y="${h * 0.34 + 44}" width="62" height="8" rx="4" fill="${shade(base, -0.1)}" opacity="0.5"/><text x="85" y="${h * 0.34 + 90}" font-family="sans-serif" font-size="22" font-weight="700" text-anchor="middle" fill="${shade(base, -0.2)}">${label}</text></g>`;
  const zoom = angle === 'detail' ? 'transform="translate(-160 -120) scale(1.4)"' : '';
  return `<g ${zoom}>${bottle(230, 380, 'CARE')}${bottle(430, 300, 'SET')}</g>`;
}

function accessory(spec: MockSpec, angle: MockAngle): string {
  const base = spec.hair;
  const dark = shade(base, -0.15);
  const scale = angle === 'detail' ? 1.35 : 1;
  return `<g transform="translate(${400 - 400 * scale} ${520 - 440 * scale}) scale(${scale})"><ellipse cx="400" cy="560" rx="250" ry="210" fill="${base}"/><ellipse cx="400" cy="590" rx="190" ry="150" fill="${dark}" opacity="0.5"/><path d="M170 560 Q400 700 630 560" stroke="${shade(base, 0.2)}" stroke-width="10" fill="none" opacity="0.6"/><ellipse cx="400" cy="400" rx="64" ry="30" fill="${shade(base, 0.12)}"/></g>`;
}

/** The SVG document for one angle of a mock product photo. */
export function mockSvg(spec: MockSpec, angle: MockAngle): string {
  const id = `${spec.seed}${angle[0]}`;
  if (spec.kind === 'care') return frame(care(spec, angle), spec.tone, id);
  if (spec.kind === 'accessory') return frame(accessory(spec, angle), spec.tone, id);
  return frame(angle === 'detail' ? detail(spec) : hair(spec, angle), spec.tone, id);
}

/** A banner-shaped (4:5) illustration for home content, from a name and a tint. */
export function mockBannerSvg(spec: MockSpec): string {
  return frame(hair({ ...spec, kind: spec.kind === 'care' || spec.kind === 'accessory' ? 'straight' : spec.kind }, 'front'), spec.tone, `b${spec.seed}`);
}

/** Edge-to-edge hair texture with no frame, for backgrounds that are cropped to any shape (home tiles). */
export function mockTextureSvg(spec: MockSpec): string {
  const r = rng(spec.seed + 53);
  const base = spec.hair;
  const dark = shade(base, -0.14);
  const light = shade(base, 0.2);
  let body = `<rect width="800" height="1000" fill="${base}"/>`;
  if (spec.kind === 'curly') {
    for (let i = 0; i < 130; i++) body += `<circle cx="${(r() * 800).toFixed(0)}" cy="${(r() * 1000).toFixed(0)}" r="${(24 + r() * 24).toFixed(0)}" fill="${i % 3 ? base : dark}" stroke="${light}" stroke-opacity="0.45" stroke-width="4"/>`;
  } else {
    const amp = spec.kind === 'wave' ? 46 : 8;
    for (let i = 0; i < 32; i++) {
      const x = i * 26;
      body += `<path d="M${x} -20 C${x + amp} 330 ${x - amp} 660 ${x + amp * 0.6} 1020" stroke="${i % 2 ? light : dark}" stroke-width="${6 + (i % 3) * 2}" fill="none" opacity="0.55" stroke-linecap="round"/>`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 1000" width="800" height="1000" preserveAspectRatio="xMidYMid slice">${body}</svg>`;
}
