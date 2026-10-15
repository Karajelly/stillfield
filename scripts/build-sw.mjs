import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputRoot = join(projectRoot, "dist");
const template = await readFile(join(projectRoot, "public", "sw.js"), "utf8");

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return listFiles(path);
      return entry.isFile() ? [path] : [];
    }),
  );
  return nested.flat();
}

// Precache every deployed file, including Vite bundles, local fonts, and icons.
// Source maps and the service worker itself are not needed to play offline.
const files = (await listFiles(outputRoot))
  .filter(
    (path) => relative(outputRoot, path) !== "sw.js" && !path.endsWith(".map"),
  )
  .sort();
if (!files.includes(join(outputRoot, "index.html"))) {
  throw new Error(
    "dist/index.html is missing. Run vite build before build-sw.mjs.",
  );
}

const hash = createHash("sha256");
hash.update(template);
const urls = [];
for (const path of files) {
  const relativePath = relative(outputRoot, path).split(sep).join("/");
  hash
    .update(relativePath)
    .update("\0")
    .update(await readFile(path))
    .update("\0");
  urls.push("/" + relativePath.split("/").map(encodeURIComponent).join("/"));
}

const version = hash.digest("hex").slice(0, 16);
if (
  !template.includes("__BUILD_HASH__") ||
  !template.includes("/* __PRECACHE_URLS__ */")
) {
  throw new Error("The service-worker template is missing its build markers.");
}
const worker = template
  .replace("__BUILD_HASH__", version)
  .replace(
    "/* __PRECACHE_URLS__ */",
    urls.map((url) => JSON.stringify(url)).join(", "),
  );
await writeFile(join(outputRoot, "sw.js"), worker);
console.log(
  `Offline meadow: precached ${urls.length} files (stillfield-${version}).`,
);
