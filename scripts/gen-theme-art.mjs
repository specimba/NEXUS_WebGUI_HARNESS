// Process theme art: darken + compress for backdrop use
import sharp from "sharp";
import { mkdirSync } from "fs";

const themes = ["nexus", "matrix", "fallout", "cyber"];
mkdirSync("public/themes", { recursive: true });

for (const t of themes) {
  await sharp(`/tmp/theme-art/${t}.png`)
    .modulate({ brightness: 0.62, saturation: 0.9 })
    .jpeg({ quality: 70, progressive: true })
    .toFile(`public/themes/${t}.jpg`);
  console.log(`✓ ${t}.jpg`);
}
console.log("done");
