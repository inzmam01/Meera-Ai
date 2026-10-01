// Draws the app icon (a ledger page with a red margin line) as a PNG, with no image library.
import zlib from "node:zlib";

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

const INK = [0x1c, 0x2b, 0x4a], PAPER = [0xee, 0xf3, 0xec], RED = [0xc4, 0x46, 0x3a];
// Shapes on a 96x96 grid: [x, y, width, height, colour]
const SHAPES = [
  [22, 20, 52, 56, PAPER],
  [34, 20, 2.5, 56, RED],
  [44, 32, 22, 2.5, INK],
  [44, 44, 22, 2.5, INK],
  [44, 56, 22, 2.5, INK],
];

export function makeIcon(size) {
  const row = size * 3 + 1;
  const raw = Buffer.alloc(row * size); // each row starts with filter byte 0
  const scale = 96 / size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const gx = (x + 0.5) * scale, gy = (y + 0.5) * scale;
      let colour = INK;
      for (const [sx, sy, w, h, c] of SHAPES) {
        if (gx >= sx && gx < sx + w && gy >= sy && gy < sy + h) colour = c;
      }
      raw.set(colour, y * row + 1 + x * 3);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
