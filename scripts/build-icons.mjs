import sharp from "sharp";
for (const [name, size] of [
  ["apple-touch-icon", 180],
  ["icon-192", 192],
  ["icon-512", 512],
]) {
  await sharp("public/icon.svg")
    .resize(size, size)
    .png()
    .toFile(`public/${name}.png`);
}
console.log("Stillfield home screen icons ready.");
