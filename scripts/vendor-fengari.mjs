// Bundles the parts of Fengari (Lua 5.3 in JavaScript, MIT) that table scripts use into one ES module,
// src/vendor/fengari.js. Fengari picks Node-only code paths (files, processes, the OS) whenever `process` exists, and
// those `require`s break the SpaceTimeDB module bundler. The bundle drops them, so the browser, tests, the CLI and the
// server all run exactly the same interpreter. Run `npm run vendor:fengari` after updating the fengari package.
import { build } from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pkg = JSON.parse(await readFile(require.resolve('fengari/package.json'), 'utf8'));
const license = await readFile(require.resolve('fengari/LICENSE'), 'utf8');

const entry = `
export { lua, lauxlib, luaconf, to_luastring, to_jsstring, luastring_eq } from 'fengari/src/fengari.js';
export { luaopen_base } from 'fengari/src/lbaselib.js';
export { luaopen_table } from 'fengari/src/ltablib.js';
export { luaopen_string } from 'fengari/src/lstrlib.js';
export { luaopen_math } from 'fengari/src/lmathlib.js';
export { luaopen_utf8 } from 'fengari/src/lutf8lib.js';
export { luaopen_coroutine } from 'fengari/src/lcorolib.js';
`;

// lualib also loads the io, os, package and debug libraries; scripts get none of them, so they are left out.
const stubs = new Set(['./liolib.js', './loslib.js', './loadlib.js', './ldblib.js', './linit.js', 'fs', 'os', 'path', 'tmp', 'child_process', 'crypto', 'readline-sync']);
const result = await build({
  stdin: { contents: entry, resolveDir: process.cwd(), loader: 'js' },
  bundle: true, format: 'esm', platform: 'neutral', mainFields: ['main'], target: 'es2022', minify: true, legalComments: 'none', write: false,
  plugins: [{
    name: 'browser-paths',
    setup(builder) {
      builder.onResolve({ filter: /.*/ }, args => stubs.has(args.path) ? { path: args.path, namespace: 'stub' } : undefined);
      builder.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'module.exports = {};', loader: 'js' }));
      builder.onLoad({ filter: /fengari[\\/]src[\\/].*\.js$/ }, async args => ({
        contents: (await readFile(args.path, 'utf8'))
          .replace(/typeof process\s*===\s*"undefined"/g, 'true')
          .replace(/typeof process\s*!==\s*"undefined"/g, 'false')
          .replace(/process\.env\.FENGARICONF/g, 'undefined'),
        loader: 'js',
      }));
    },
  }],
});
const header = `/* Fengari ${pkg.version}, bundled by scripts/vendor-fengari.mjs without its Node-only paths. Do not edit.\n\n${license.trim()}\n*/\n// @ts-nocheck\n`;
await writeFile('src/vendor/fengari.js', header + result.outputFiles[0].text);
console.log(`src/vendor/fengari.js: ${(result.outputFiles[0].text.length / 1024).toFixed(0)} KiB`);
