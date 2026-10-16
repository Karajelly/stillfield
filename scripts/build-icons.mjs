import sharp from "sharp";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const source = fileURLToPath(new URL("../assets/branding/meadow-loop.png", import.meta.url));
const output = (name) => fileURLToPath(new URL(`../public/${name}`, import.meta.url));
const faviconSizes = [16, 32, 48];
const faviconImages = [];

for (const [name, size] of [
  ...faviconSizes.map((size) => [`favicon-${size}`, size]),
  ["apple-touch-icon", 180],
  ["icon-192", 192],
  ["icon-512", 512],
]) {
  const isFavicon = faviconSizes.includes(size);
  const icon = sharp(source)
    .resize(size, size, { kernel: "lanczos3" })
    .flatten({ background: "#e8ecda" });
  if (isFavicon) {
    const mask = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${size * 0.22}" fill="white"/></svg>`,
    );
    icon.composite([{ input: mask, blend: "dest-in" }]);
  } else {
    icon.removeAlpha();
  }
  const image = await icon
    .png({ compressionLevel: 9 })
    .toBuffer();
  await writeFile(output(`${name}.png`), image);
  if (isFavicon) faviconImages.push({ size, image });
}

// ICO stores the three PNG sizes in one file for browsers requesting /favicon.ico.
const directory = Buffer.alloc(6 + 16 * faviconImages.length);
directory.writeUInt16LE(1, 2);
directory.writeUInt16LE(faviconImages.length, 4);
let imageOffset = directory.length;
faviconImages.forEach(({ size, image }, index) => {
  const entry = 6 + 16 * index;
  directory.writeUInt8(size, entry);
  directory.writeUInt8(size, entry + 1);
  directory.writeUInt16LE(1, entry + 4);
  directory.writeUInt16LE(32, entry + 6);
  directory.writeUInt32LE(image.length, entry + 8);
  directory.writeUInt32LE(imageOffset, entry + 12);
  imageOffset += image.length;
});
await writeFile(output("favicon.ico"), Buffer.concat([
  directory,
  ...faviconImages.map(({ image }) => image),
]));

// Pull the tree and tractor into the central safe circle; extend only the scenery.
await sharp(source)
  .resize(432, 432, { kernel: "lanczos3" })
  .extend({ top: 40, bottom: 40, left: 40, right: 40, extendWith: "mirror" })
  .flatten({ background: "#e8ecda" })
  .removeAlpha()
  .png({ compressionLevel: 9 })
  .toFile(output("icon-maskable-512.png"));

console.log("Meadow Loop favicons, Apple touch icon, and PWA icons ready.");
