import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
const source = path.resolve("desktop/plugin.js");
if (!fs.existsSync(source)) throw new Error("Run npm run build first");
const home = path.resolve(
  process.env.HERMES_HOME || path.join(os.homedir(), ".hermes"),
);
const dir = path.join(home, "desktop-plugins", "composer-lab"),
  target = path.join(dir, "plugin.js");
if (fs.existsSync(target) && !process.argv.includes("--replace"))
  throw new Error(
    "Already installed. Use --replace to replace only composer-lab/plugin.js; settings are preserved.",
  );
if (fs.existsSync(dir) && fs.lstatSync(dir).isSymbolicLink())
  throw new Error("Refusing symlink plugin directory");
if (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink())
  throw new Error("Refusing symlink target");
fs.mkdirSync(dir, { recursive: true });
fs.mkdirSync(".local", { recursive: true });
if (fs.existsSync(target)) fs.copyFileSync(target, ".local/previous-plugin.js");
const data = fs.readFileSync(source),
  hash = (b) => crypto.createHash("sha256").update(b).digest("hex");
const temp = path.join(dir, `.composer-lab-${process.pid}.tmp`);
try {
  fs.writeFileSync(temp, data, { flag: "wx" });
  fs.renameSync(temp, target);
} finally {
  if (fs.existsSync(temp)) fs.unlinkSync(temp);
}
fs.copyFileSync(
  "desktop/THIRD_PARTY_NOTICES.txt",
  path.join(dir, "THIRD_PARTY_NOTICES.txt"),
);
const actual = fs.readFileSync(target);
if (hash(data) !== hash(actual))
  throw new Error("Installed file hash mismatch");
const receipt = {
  version: JSON.parse(fs.readFileSync("package.json", "utf8")).version,
  target,
  sha256: hash(actual),
};
fs.writeFileSync(".local/install.json", JSON.stringify(receipt, null, 2));
console.log(JSON.stringify(receipt, null, 2));
