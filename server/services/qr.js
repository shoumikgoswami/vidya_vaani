// Vidya Vaani's QR codes: flowing rounded shapes in school ink, rounded corner squares in the brand
// blue and the logo in the middle. The highest error correction lets the logo sit on the code and still scan,
// and tests/qr.test.js reads every style back.
import QRCode from 'qrcode';

export const INK = '#111735';
export const BLUE = '#2438c8';
const MARIGOLD = '#ffb020';
/** The empty border a scanner needs, in modules. */
const QUIET = 4;
/** The logo covers this share of the code's width: under a tenth of its area. */
const LOGO_SHARE = 0.24;

const round = (n) => Math.round(n * 1000) / 1000;
const rect = (x, y, w, h, rx, fill) =>
  `<rect x="${round(x)}" y="${round(y)}" width="${round(w)}" height="${round(h)}" rx="${round(rx)}" fill="${fill}"/>`;

/** The three large squares a scanner looks for first. */
const finder = (x, y) => [
  rect(x, y, 7, 7, 2.1, BLUE),
  rect(x + 1, y + 1, 5, 5, 1.3, '#fff'),
  rect(x + 2, y + 2, 3, 3, 0.9, INK),
].join('');

/** The mark from client/img/icon.svg, drawn into a square of the given side. */
function logo(x, y, side) {
  const unit = side / 96;
  const bar = (bx, by, height, fill) => rect(x + bx * unit, y + by * unit, 10 * unit, height * unit, 5 * unit, fill);
  return [
    rect(x, y, side, side, 24 * unit, BLUE),
    bar(17, 22, 26, '#fff'), bar(30, 33, 30, '#fff'), bar(43, 46, 30, MARIGOLD), bar(56, 33, 30, '#fff'), bar(69, 22, 26, '#fff'),
  ].join('');
}

export function brandedQr(text) {
  const { modules } = QRCode.create(text, { errorCorrectionLevel: 'H' });
  const { size } = modules;
  const full = size + QUIET * 2;
  // An odd number of modules keeps the logo exactly in the middle.
  let hole = Math.round(size * LOGO_SHARE);
  if (hole % 2 === 0) hole += 1;
  const from = (size - hole) / 2;

  const inFinder = (r, c) => (r < 7 && (c < 7 || c >= size - 7)) || (r >= size - 7 && c < 7);
  const inLogo = (r, c) => r >= from && r < from + hole && c >= from && c < from + hole;
  const dark = (r, c) => r < size && c < size && Boolean(modules.get(r, c)) && !inFinder(r, c) && !inLogo(r, c);
  // Each module is round, and neighbours are joined, so runs read as smooth strokes. Separate dots
  // would leave gaps that some scanners fail on.
  const shapes = [];
  for (let r = 0; r < size; r += 1) {
    for (let c = 0; c < size; c += 1) {
      if (!dark(r, c)) continue;
      const x = c + QUIET;
      const y = r + QUIET;
      shapes.push(rect(x, y, 1, 1, 0.5, INK));
      if (dark(r, c + 1)) shapes.push(rect(x + 0.5, y, 1, 1, 0, INK));
      if (dark(r + 1, c)) shapes.push(rect(x, y + 0.5, 1, 1, 0, INK));
    }
  }
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${full} ${full}" width="${full * 8}" height="${full * 8}">`,
    rect(0, 0, full, full, 0, '#fff'),
    shapes.join(''),
    finder(QUIET, QUIET),
    finder(QUIET + size - 7, QUIET),
    finder(QUIET, QUIET + size - 7),
    logo(QUIET + from + 0.6, QUIET + from + 0.6, hole - 1.2),
    '</svg>',
  ].join('');
}
