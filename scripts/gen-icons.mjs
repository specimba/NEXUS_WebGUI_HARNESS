import sharp from "sharp";

const base = (pad) => {
  const s = 512, k = pad ? 0.78 : 1, c = s / 2, o = c - (c * k);
  const g = (v) => v * k + o;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#6d28d9"/>
      <stop offset="1" stop-color="#a855f7"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="${pad ? 0 : 112}" fill="url(#g)"/>
  <circle cx="${g(256)}" cy="${g(118)}" r="${g(17)}" fill="#fff"/>
  <rect x="${g(248)}" y="${g(128)}" width="${g(16)}" height="${g(34)}" rx="${g(8)}" fill="#fff"/>
  <rect x="${g(104)}" y="${g(232)}" width="${g(26)}" height="${g(60)}" rx="${g(13)}" fill="#ddd6fe"/>
  <rect x="${g(382)}" y="${g(232)}" width="${g(26)}" height="${g(60)}" rx="${g(13)}" fill="#ddd6fe"/>
  <rect x="${g(136)}" y="${g(164)}" width="${g(240)}" height="${g(196)}" rx="${g(48)}" fill="#fff"/>
  <rect x="${g(168)}" y="${g(204)}" width="${g(176)}" height="${g(96)}" rx="${g(36)}" fill="#1e1b2e"/>
  <circle cx="${g(216)}" cy="${g(252)}" r="${g(16)}" fill="#c4b5fd"/>
  <circle cx="${g(296)}" cy="${g(252)}" r="${g(16)}" fill="#c4b5fd"/>
</svg>`;
};

await sharp(Buffer.from(base(false))).resize(512, 512).png().toFile("public/icon-512.png");
await sharp(Buffer.from(base(false))).resize(192, 192).png().toFile("public/icon-192.png");
await sharp(Buffer.from(base(true))).resize(512, 512).png().toFile("public/icon-maskable-512.png");
// favicon-friendly 32px
await sharp(Buffer.from(base(false))).resize(32, 32).png().toFile("public/icon-32.png");
console.log("icons generated");
