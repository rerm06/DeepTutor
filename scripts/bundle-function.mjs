// Bundle netlify/server.mts and all of its dependencies into netlify/server-bundle.mjs (single ESM file).
import { build } from "esbuild";

await build({
  entryPoints: ["netlify/server.mts"],
  outfile: "netlify/server-bundle.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  external: ["pg-native"],
  banner: {
    // CommonJS dependencies inside an ESM bundle still call require() for Node built-ins.
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
  logLevel: "warning",
});
console.log("bundled netlify/server-bundle.mjs");
