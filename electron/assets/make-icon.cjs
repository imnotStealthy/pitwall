// electron/assets/make-icon.cjs — generates tray.png (32px) and icon.ico (multi-size)
// for the system tray and the packaged app/installer. Pure stdlib (zlib), no deps.
// Run: `node electron/assets/make-icon.cjs`
const fs = require('node:fs');
const zlib = require('node:zlib');
const path = require('node:path');

const amber = [255, 176, 0];

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1));
  }
  return ~c;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])) >>> 0, 0);
  return Buffer.concat([len, t, data, crc]);
}

// Draw the amber gauge (ring + dim center + white needle) at `size` and return a PNG buffer.
function makePng(size) {
  const px = Buffer.alloc(size * size * 4, 0); // RGBA, transparent
  const set = (x, y, r, g, b, a) => { const i = (y * size + x) * 4; px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a; };
  const c = (size - 1) / 2;
  const rOuter = size * 0.46, rInner = size * 0.27;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - c, y - c);
      if (d <= rOuter && d >= rInner) set(x, y, amber[0], amber[1], amber[2], 255);
      else if (d < rInner) set(x, y, amber[0], amber[1], amber[2], 60);
    }
  }
  const steps = Math.max(8, Math.round(rInner * 3));
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * rInner;
    const x = Math.round(c + t * Math.cos(-Math.PI / 4));
    const y = Math.round(c + t * Math.sin(-Math.PI / 4));
    if (x >= 0 && y >= 0 && x < size && y < size) set(x, y, 255, 255, 255, 255);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit, RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter byte
    px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const idat = zlib.deflateSync(raw);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Pack PNGs into a single .ico (PNG-compressed entries; Vista+ / electron-builder compatible).
function makeIco(sizes) {
  const pngs = sizes.map(makePng);
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
  const dir = Buffer.alloc(16 * sizes.length);
  let offset = 6 + 16 * sizes.length;
  sizes.forEach((s, i) => {
    const o = i * 16;
    dir[o] = s >= 256 ? 0 : s;       // width (0 = 256)
    dir[o + 1] = s >= 256 ? 0 : s;   // height
    dir[o + 2] = 0; dir[o + 3] = 0;  // colors, reserved
    dir.writeUInt16LE(1, o + 4);     // planes
    dir.writeUInt16LE(32, o + 6);    // bit depth
    dir.writeUInt32LE(pngs[i].length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += pngs[i].length;
  });
  return Buffer.concat([header, dir, ...pngs]);
}

fs.writeFileSync(path.join(__dirname, 'tray.png'), makePng(32));
fs.writeFileSync(path.join(__dirname, 'icon.ico'), makeIco([256, 128, 64, 48, 32, 24, 16]));
console.log('wrote tray.png and icon.ico');
