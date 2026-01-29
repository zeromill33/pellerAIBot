import { copyFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = dirname(__dirname);

const assets = [
  {
    src: join(projectRoot, "src", "renderer", "templates", "telegram.md.txt"),
    dest: join(projectRoot, "dist", "renderer", "templates", "telegram.md.txt")
  }
];

for (const asset of assets) {
  if (!existsSync(asset.src)) {
    continue;
  }
  mkdirSync(dirname(asset.dest), { recursive: true });
  copyFileSync(asset.src, asset.dest);
}
