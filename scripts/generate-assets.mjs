import { PNG } from 'pngjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Original code-generated artwork. No remote images or unlicensed assets.
const root = resolve('apps/web/public');
mkdirSync(`${root}/icons`, { recursive: true });
mkdirSync(`${root}/artwork`, { recursive: true });
const palettes = [
  [
    [210, 229, 161],
    [114, 140, 79],
    [31, 57, 39],
  ],
  [
    [218, 185, 159],
    [153, 105, 83],
    [72, 49, 44],
  ],
  [
    [161, 197, 210],
    [83, 128, 149],
    [27, 60, 81],
  ],
];
function png(size, pixel) {
  const output = new PNG({ width: size, height: size });
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const color = pixel(x / size, y / size);
      const offset = (y * size + x) * 4;
      color.forEach((channel, i) => {
        output.data[offset + i] = Math.round(
          Math.max(0, Math.min(255, channel)),
        );
      });
      output.data[offset + 3] = 255;
    }
  return PNG.sync.write(output);
}
palettes.forEach(([light, mid, dark], i) => {
  writeFileSync(
    `${root}/artwork/session-${i + 1}.png`,
    png(512, (x, y) => {
      const rotatedX = (x - 0.59) * 0.88 + (y - 0.4) * 0.48;
      const rotatedY = -(x - 0.59) * 0.48 + (y - 0.4) * 0.88;
      const radius = Math.hypot(rotatedX * 0.86, rotatedY * 1.24);
      const rings = Math.sin(radius * 78 + 0.5) * 0.5 + 0.5;
      const inSculpture = radius < 0.36 && radius > 0.085;
      const shade = Math.max(0, Math.min(1, (x + y) * 0.22));
      const noise =
        Math.sin(x * 1821 + y * 1728) * Math.cos(y * 2167 - x * 938) * 2;
      if (!inSculpture)
        return light.map((v, c) => v - shade * (v - mid[c]) * 0.5 + noise);
      const amount = rings * 0.63 + Math.max(0, rotatedY) * 0.7;
      return mid.map((v, c) => v * (1 - amount) + dark[c] * amount + noise);
    }),
  );
});
for (const [name, size, maskable] of [
  ['icon-192', 192, false],
  ['icon-512', 512, false],
  ['maskable-512', 512, true],
  ['apple-touch-icon', 180, false],
]) {
  const result = png(size, (x, y) => {
    const scale = maskable ? 0.72 : 0.83;
    x = (x - 0.5) / scale + 0.5;
    y = (y - 0.5) / scale + 0.5;
    const stems =
      (x > 0.36 && x < 0.415 && y > 0.3 && y < 0.66) ||
      (x > 0.66 && x < 0.715 && y > 0.22 && y < 0.58);
    const beam =
      x > 0.36 && x < 0.715 && Math.abs(y - (0.38 - (x - 0.36) * 0.23)) < 0.045;
    const notes =
      Math.hypot((x - 0.315) / 1.25, y - 0.67) < 0.085 ||
      Math.hypot((x - 0.615) / 1.25, y - 0.59) < 0.085;
    return stems || beam || notes ? [25, 35, 18] : [214, 246, 138];
  });
  writeFileSync(
    name === 'apple-touch-icon'
      ? `${root}/${name}.png`
      : `${root}/icons/${name}.png`,
    result,
  );
}
writeFileSync(
  `${root}/favicon.svg`,
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="17" fill="#d6f68a"/><path d="M25 45V22l25-5v23M25 22l25-5" fill="none" stroke="#192312" stroke-width="5"/><ellipse cx="19" cy="45" rx="8" ry="6" fill="#192312"/><ellipse cx="44" cy="40" rx="8" ry="6" fill="#192312"/></svg>',
);
console.log(
  'Generated 3 original covers, PWA icons, Apple touch icon and favicon.',
);
