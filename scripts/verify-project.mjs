import assert from "node:assert/strict";
import crypto from "node:crypto";
import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const chromiumRoot = path.join(root, "Extension");
const safariRoot = path.join(root, "macOS", "Safari", "ImmerseFree Extension", "Resources");

const readJson = async (file) => JSON.parse(await readFile(file, "utf8"));
const chromiumManifest = await readJson(path.join(chromiumRoot, "manifest.json"));
const safariManifest = await readJson(path.join(safariRoot, "manifest.json"));
const packageMetadata = await readJson(path.join(root, "package.json"));
const chromiumOptionsHtml = await readFile(path.join(chromiumRoot, "ui", "options.html"), "utf8");
const readme = await readFile(path.join(root, "README.md"), "utf8");
const windowsInstaller = await readFile(path.join(root, "Windows", "Install.ps1"), "utf8");
const safariProject = await readFile(path.join(root, "macOS", "Safari", "ImmerseFree.xcodeproj", "project.pbxproj"), "utf8");

assert.match(chromiumOptionsHtml, /https:\/\/opencode\.ai\/zen\/v1/, "Options UI must use the current OpenCode Zen endpoint");
assert.equal(chromiumOptionsHtml.includes("opencode.ai/inference/openai/v1"), false, "Options UI must not expose the retired OpenCode endpoint");
assert.equal(
  /\*\*[^*\n]*[：:]\*\*(?=[\p{Script=Han}])/u.test(readme),
  false,
  "README bold text must not run directly into CJK text after its closing delimiter"
);
assert.match(
  readme,
  /Command \+ Shift \+ G/,
  "README must explain how to paste the hidden macOS extension path into Chrome's folder picker"
);
assert.match(readme, /built-in English interface/i, "README must clearly introduce the built-in English interface");
assert.match(readme, /users worldwide/i, "README must state that ImmerseFree is intended for worldwide use");

assert.equal(chromiumManifest.version, packageMetadata.version, "Chromium and package versions must match");
assert.equal(safariManifest.version, packageMetadata.version, "Safari extension and package versions must match");
assert.equal(
  /\$ProductVersion\s*=\s*['\"]\d+\.\d+\.\d+['\"]/i.test(windowsInstaller),
  false,
  "Windows installer must derive its version from the package manifest instead of hardcoding it"
);
assert.match(windowsInstaller, /\$script:ProductVersion\s*=\s*\$manifestVersion/i, "Windows installer must use the validated manifest version");
assert.match(windowsInstaller, /Set-Clipboard/, "Windows installer must copy the installed extension path to the clipboard");
assert.match(readme, /Ctrl \+ L/, "README must explain where Windows users paste the installed extension path");
const safariMarketingVersions = [...safariProject.matchAll(/MARKETING_VERSION = ([^;]+);/g)].map((match) => match[1]);
assert.ok(safariMarketingVersions.length > 0, "Safari project must declare MARKETING_VERSION");
assert.deepEqual(
  [...new Set(safariMarketingVersions)],
  [packageMetadata.version],
  "Every Safari target must use the release package version"
);

for (const file of ["Install ImmerseFree.command", "Enable in another Chrome profile.command"]) {
  const command = await readFile(path.join(root, "macOS", file), "utf8");
  assert.match(command, /\/usr\/bin\/pbcopy/, `${file} must copy the installed extension path to the clipboard`);
  assert.match(command, /Command \+ Shift \+ G/, `${file} must explain where to paste the copied path`);
}

for (const file of (await readdir(path.join(root, "macOS"))).filter((name) => name.endsWith(".command"))) {
  const command = await readFile(path.join(root, "macOS", file), "utf8");
  assert.equal(
    /^\s*read -r\b(?!.*\|\| true)/m.test(command),
    false,
    `${file} must not fail solely because its terminal prompt receives EOF`
  );
}

assert.equal(chromiumManifest.manifest_version, 3, "Chromium manifest must use MV3");
assert.equal(safariManifest.manifest_version, 3, "Safari manifest must use MV3");
assert.equal(chromiumManifest.version, safariManifest.version, "Browser package versions must match");
assert.deepEqual(
  chromiumManifest.content_scripts.map((entry) => entry.js),
  safariManifest.content_scripts.map((entry) => entry.js),
  "Chromium and Safari content-script order must match"
);

for (const [manifest, base] of [[chromiumManifest, chromiumRoot], [safariManifest, safariRoot]]) {
  const referenced = new Set([
    manifest.background?.service_worker,
    manifest.action?.default_popup,
    manifest.options_page,
    ...Object.values(manifest.action?.default_icon || {}),
    ...Object.values(manifest.icons || {}),
    ...manifest.content_scripts.flatMap((entry) => [...(entry.js || []), ...(entry.css || [])])
  ].filter(Boolean));
  for (const relative of referenced) await access(path.join(base, relative));
}

const idAlphabet = "abcdefghijklmnop";
const keyDigest = crypto.createHash("sha256").update(Buffer.from(chromiumManifest.key, "base64")).digest();
const extensionId = [...keyDigest.subarray(0, 16)]
  .flatMap((byte) => [idAlphabet[byte >> 4], idAlphabet[byte & 15]])
  .join("");
const serverSource = await readFile(path.join(root, "Bridge", "server.mjs"), "utf8");
assert.equal(
  serverSource.includes("--dangerously-skip-permissions"),
  false,
  "Bridge must not auto-approve every Antigravity tool call"
);
assert.match(
  serverSource,
  new RegExp(`chrome-extension:\\/\\/${extensionId}`),
  "Bridge origin must match the manifest key-derived Chromium extension ID"
);

async function collectFiles(directory, prefix = "") {
  const result = new Map();
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = path.posix.join(prefix, entry.name);
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      for (const [name, value] of await collectFiles(absolute, relative)) result.set(name, value);
    } else {
      result.set(relative, crypto.createHash("sha256").update(await readFile(absolute)).digest("hex"));
    }
  }
  return result;
}

const chromiumFiles = await collectFiles(chromiumRoot);
const safariFiles = await collectFiles(safariRoot);
for (const [relative, digest] of chromiumFiles) {
  if (relative === "manifest.json" || relative.startsWith("icons/")) continue;
  assert.equal(safariFiles.get(relative), digest, `Safari shared copy is stale: ${relative}`);
}

for (const htmlRoot of [chromiumRoot, safariRoot]) {
  const files = await collectFiles(htmlRoot);
  for (const relative of files.keys()) {
    if (!relative.endsWith(".html")) continue;
    const html = await readFile(path.join(htmlRoot, relative), "utf8");
    for (const match of html.matchAll(/(?:src|href)=["']([^"']+)["']/gi)) {
      const reference = match[1];
      if (/^(?:[a-z]+:|#)/i.test(reference)) continue;
      const target = path.resolve(path.dirname(path.join(htmlRoot, relative)), reference.split(/[?#]/)[0]);
      await access(target);
    }
  }
}

const sourceFiles = await collectFiles(root);
const secretPatterns = [
  /\bAIza[0-9A-Za-z_-]{30,}\b/g,
  /\bsk-[A-Za-z0-9_-]{20,}\b/g,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g
];
for (const relative of sourceFiles.keys()) {
  if (/\.(?:png|woff2|mjs)$/i.test(relative) && relative.includes("vendor/")) continue;
  const file = path.join(root, relative);
  const data = await readFile(file);
  if (data.includes(0)) continue;
  const text = data.toString("utf8");
  for (const pattern of secretPatterns) {
    pattern.lastIndex = 0;
    assert.equal(pattern.test(text), false, `Possible committed secret in ${relative}`);
  }
}

console.log(`Project integrity checks passed (extension ID: ${extensionId}).`);
