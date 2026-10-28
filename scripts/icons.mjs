import sharp from 'sharp';
import { readFile, writeFile } from 'node:fs/promises';
const svg = await readFile('public/icons/star.svg');
for (const size of [192, 512, 180])
  await sharp(svg)
    .resize(size, size)
    .png()
    .toFile(`public/icons/${size === 180 ? 'apple-touch-icon' : `icon-${size}`}.png`);
await sharp(svg)
  .resize(360, 360)
  .extend({ top: 76, bottom: 76, left: 76, right: 76, background: '#172b50' })
  .png()
  .toFile('public/icons/maskable-512.png');
const png = await sharp(svg).resize(32, 32).png().toBuffer();
const header = Buffer.alloc(22);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(1, 4);
header[6] = 32;
header[7] = 32;
header.writeUInt16LE(1, 10);
header.writeUInt16LE(32, 12);
header.writeUInt32LE(png.length, 14);
header.writeUInt32LE(22, 18);
await writeFile('public/favicon.ico', Buffer.concat([header, png]));
