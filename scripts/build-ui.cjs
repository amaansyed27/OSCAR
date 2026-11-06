const fs = require("node:fs"),
  path = require("node:path");
const root = path.join(__dirname, ".."),
  out = path.join(root, "dist");
// Copy only public assets. Configuration, databases and source credentials never enter the bundle.
for (const dir of ["ui", "assets/brand", "assets/fonts"])
  fs.cpSync(path.join(root, dir), path.join(out, dir), { recursive: true });
for (const file of [
  "marked/lib/marked.umd.js",
  "dompurify/dist/purify.min.js",
]) {
  const to = path.join(out, "vendor", path.basename(file));
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(path.join(root, "node_modules", file), to);
}
