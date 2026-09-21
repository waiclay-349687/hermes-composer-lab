import path from "node:path";
import fs from "node:fs";
import { build } from "esbuild";
const root = process.cwd();
fs.mkdirSync("desktop", { recursive: true });
const result = await build({
  entryPoints: ["src/plugin.js"],
  bundle: true,
  format: "esm",
  outfile: "desktop/plugin.js",
  external: ["@hermes/plugin-sdk", "react", "react/jsx-runtime"],
  legalComments: "eof",
  metafile: true,
});
const packages = new Set();
for (const input of Object.keys(result.metafile.inputs)) {
  const m = input.match(/(?:^|\/)node_modules\/((?:@[^/]+\/)?[^/]+)/);
  if (m) packages.add(m[1]);
}
const notices = [];
for (const name of [...packages].sort()) {
  const dir = path.join(root, "node_modules", name),
    pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
  const license = fs
    .readdirSync(dir)
    .filter((p) => /^licen[sc]e(?:[.-]|$)/i.test(p))
    .map((p) => path.join(dir, p))
    .find((p) => fs.statSync(p).isFile());
  if (!license) throw new Error(`Missing license for bundled package ${name}`);
  notices.push(`${name} ${pkg.version}\n${fs.readFileSync(license, "utf8")}`);
}
fs.writeFileSync("desktop/THIRD_PARTY_NOTICES.txt", notices.join("\n\n"));
console.log(`Built desktop/plugin.js; bundled licenses: ${packages.size}`);
if (process.env.HERMES_SOURCE) {
  const host = path.resolve(process.env.HERMES_SOURCE),
    hostSrc = path.join(host, "apps/desktop/src");
  fs.mkdirSync("dist", { recursive: true });
  const options = {
    bundle: true,
    format: "iife",
    alias: {
      "@host": hostSrc,
      "@": hostSrc,
      react: path.join(root, "node_modules/react"),
      "react-dom": path.join(root, "node_modules/react-dom"),
    },
    nodePaths: [path.join(host, "node_modules")],
    loader: { ".svg": "dataurl", ".css": "empty" },
    define: {
      "process.env.NODE_ENV": '"test"',
      "import.meta.env.DEV": "false",
      "import.meta.env.VITE_PERF_PROBE": '""',
      "import.meta.hot": "false",
    },
  };
  await build({
    ...options,
    entryPoints: ["tests/fixture.jsx"],
    outfile: "dist/fixture.js",
  });
  await build({
    ...options,
    entryPoints: ["tests/button-risk.jsx"],
    outfile: "dist/button-risk.js",
  });
  await build({
    ...options,
    alias: {
      ...options.alias,
      "@hermes/plugin-sdk": path.join(root, "tests/sdk-shim.jsx"),
    },
    entryPoints: ["tests/settings.jsx"],
    outfile: "dist/settings.js",
  });
  const assetDir = path.join(host, "apps/desktop/dist/assets"),
    hostCss = fs.readdirSync(assetDir).find((p) => /^index-.*\.css$/.test(p));
  if (!hostCss)
    throw new Error(
      "Build the Hermes desktop stylesheet before running UI tests",
    );
  fs.copyFileSync(path.join(assetDir, hostCss), "dist/host.css");
  const css =
    fs
      .readFileSync("src/plugin.js", "utf8")
      .match(/export const CSS\s*=\s*`([\s\S]*?)`;/)?.[1] || "";
  const theme =
    "body{background:#13191c;color:#dce8e7;font:16px/1.6 system-ui;margin:36px;--ui-accent:#8cbeaa;--ui-text-primary:#dce8e7;--ui-text-secondary:#8c9ca0;--ui-stroke-secondary:#42524b}#editor{white-space:pre-wrap;min-height:160px;max-height:220px;overflow:auto;width:420px;border:1px solid var(--ui-stroke-secondary);padding:16px;outline:none}pre{white-space:pre-wrap}";
  for (const name of ["fixture", "button-risk"])
    fs.writeFileSync(
      `dist/${name}.html`,
      `<!doctype html><meta charset="utf-8"><style>${theme}${css}</style><div id="root"></div><script src="${name}.js"></script>`,
    );
  fs.writeFileSync(
    "dist/settings.html",
    `<!doctype html><html class="dark"><meta charset="utf-8"><link rel="stylesheet" href="host.css"><style>:root{--ui-bg-elevated:#171d21;--primary:#8cbeaa;--ui-chat-bubble-background:#171d21;--stroke-nous:#35423e;--z-modal:1000;--z-modal-backdrop:999;--color-primary:var(--ui-accent);--color-background:var(--ui-bg-primary);--dt-background:#171d21;--dt-foreground:#dce8e7;--dt-input:#293337;--background:#171d21;--foreground:#dce8e7;--muted-foreground:#8c9ca0;--popover:#171d21;--popover-foreground:#dce8e7;--border:#35423e;--ring:#8cbeaa;--ui-bg-primary:#171d21;--ui-bg-secondary:#20282b;--ui-bg-tertiary:#293337;--ui-bg-field:#13191c;--ui-text-primary:#dce8e7;--ui-text-secondary:#8c9ca0;--ui-text-tertiary:#788a8e;--ui-stroke-secondary:#35423e;--ui-accent:#8cbeaa;}body{background:var(--ui-bg-field);color:var(--ui-text-primary);font-family:system-ui;padding:32px}</style><div id="root"></div><script src="settings.js"></script></html>`,
  );
  console.log("Built isolated host-contract fixtures from HERMES_SOURCE");
}
