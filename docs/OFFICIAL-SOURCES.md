# Official-source notes for the ImmerseFree README

Research date: 2026-09-02 (Asia/Taipei). This is an evidence note, not end-user copy. Product, store, model, and pricing details can change; re-check the linked first-party pages before release.

## Repo facts that affect the instructions

- The Chromium build is already a Manifest V3 extension: `Extension/manifest.json`. For Chrome and Edge, the folder to select in **Load unpacked** is `Extension/`, because it contains `manifest.json` at its root.
- Safari conversion has already been done. The repo contains a macOS container app, a Safari Web Extension target, and an Xcode project under `macOS/Safari/`. `macOS/Install or update Safari.command` syncs the shared extension files into that project, builds with `xcodebuild`, signs with the user's selected development team, copies the app into `/Applications` or `~/Applications`, and registers the embedded extension. Do not tell users to run the converter for this checkout; the converter/packager is relevant only if recreating the Safari project from `Extension/`.
- “Antigravity CLI” is not a generic name in this repo. It is Google's official **Antigravity CLI**, whose executable is `agy`. The paths searched by `Bridge/platform-core.mjs` match Google's documented installer locations, and `Bridge/server.mjs` invokes `agy models` plus the CLI's headless JSON modes.
- The repo also genuinely integrates the **OpenCode CLI**. With no `opencodeApiKey`, `Extension/core/provider-core.js` sends the request to the local bridge; the bridge then requires an `opencode` executable and runs `opencode run --pure --model opencode/<model> --format json ...` (`Bridge/opencode-cli-core.mjs`). With an OpenCode key, the extension can instead call the configured OpenCode HTTP endpoint directly.

## Release blockers found while checking the official docs

1. **The Bridge origin allowlist must be reconciled with both store IDs before publication.** `Bridge/server.mjs` currently permits only `chrome-extension://dfhcccjgooiemdenlphffkkjlnhfjamc`. That ID is correctly derived from the current `Extension/manifest.json` public `key`, so current unpacked installs share it. However, Microsoft explicitly warns that a published Edge Add-ons ID can differ from the sideloaded ID and says integrations must update their allowed origins; its cross-store guidance requires allowlisting both store IDs. ImmerseFree uses the same origin as an HTTP CORS/security allowlist rather than a native-messaging manifest, but the ID consequence is identical: if Edge Add-ons assigns another ID, every Bridge endpoint except the unauthenticated minimal `/health` check will return 403 until that Edge origin is added. Source: [Microsoft Edge native messaging — published IDs and both-store allowlists](https://learn.microsoft.com/en-us/microsoft-edge/extensions/developer-guide/native-messaging#step-2-create-your-native-messaging-host-manifest-file).
2. **The existing Chrome `key` must be checked against the actual Chrome Web Store Item ID.** Chrome's official sequence is to upload the ZIP without publishing, obtain the store item's public key from Package → View public key, place that public key in the manifest, then compare the unpacked ID with the Dashboard Item ID. There is no evidence in this checkout that the current public key came from the owner's intended store item. Do this check before publishing; if the IDs differ, update both the manifest key and Bridge origin together. Source: [Chrome manifest `key` — keep a consistent extension ID](https://developer.chrome.com/docs/extensions/reference/manifest/key#keep-a-consistent-extension-id).
3. **The direct OpenCode-key endpoint needs a live compatibility test or migration.** `Extension/core/settings-core.js` defaults to `https://opencode.ai/inference/openai/v1`, while current official OpenCode Zen documentation publishes endpoints under `https://opencode.ai/zen/v1` (`/chat/completions` and `/responses`). Do not document the key-based path as verified until the configured endpoint succeeds in a clean-profile test with a current key. Source: [OpenCode Zen endpoints](https://opencode.ai/docs/zen/#endpoints).
4. **Antigravity vision OCR currently auto-approves all agent tool calls.** The ordinary translation path does not pass this flag, but `Bridge/server.mjs` invokes vision OCR with `--sandbox --dangerously-skip-permissions --add-dir <temporary-directory>`. Google's official headless documentation says `--dangerously-skip-permissions` approves all tool calls, including command execution and file writes, and recommends scoped allow rules instead. The sandbox and temporary working directory reduce exposure but do not change the flag's semantics. Treat removal/replacement with a narrow permission rule as a security-review item before claiming the project is “completely safe”; at minimum disclose that vision OCR sends the page image to the selected Antigravity model. Source: [Antigravity headless mode — permissions](https://antigravity.google/docs/cli/headless/#permissions-in-headless-mode).

## Chrome: local install, packaging, and distribution

### Local/development install

Official flow: open `chrome://extensions`, enable **Developer mode**, select **Load unpacked**, then select the directory containing `manifest.json`. For this repo, select `Extension/`.

- Source: [Chrome “Hello World” — Load an unpacked extension](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load-unpacked)

An unpacked install is appropriate for personal use and development, but Chrome explicitly describes unpacked code as trusted development code, not the normal public-distribution path.

- Source: [Distribute your extension](https://developer.chrome.com/docs/extensions/how-to/distribute)

### Public package/store flow

For Chrome Web Store submission, ZIP the **contents** of `Extension/` so that `manifest.json` is at the ZIP root; register a Chrome Web Store developer account; add a new item in the Developer Dashboard; upload the ZIP; complete Store Listing, Privacy, Distribution, and test instructions if needed; then submit for review.

- Source: [Publish in the Chrome Web Store](https://developer.chrome.com/docs/webstore/publish)
- Source: [Chrome Web Store documentation hub](https://developer.chrome.com/docs/webstore)

Important distribution boundary: only extensions hosted and signed by the Chrome Web Store can be directly installed by ordinary Chrome users. Self-hosting is supported only for managed enterprise environments; Windows and macOS self-hosting requires enterprise policy. A locally packed CRX is therefore not a general “one-click installer” for ordinary Windows/macOS users.

- Source: [Distribute your extension](https://developer.chrome.com/docs/extensions/how-to/distribute)
- Source: [Alternative installation methods](https://developer.chrome.com/docs/extensions/how-to/distribute/install-extensions)

Chrome's **Pack extension** function can create a CRX and private key, and verified CRX uploads can sign Web Store updates. Keep that private key out of Git and backups shared with others; it is update-signing material, not an API key and not needed for normal first-time Web Store upload.

- Source: [Update your Chrome Web Store item — verified CRX uploads](https://developer.chrome.com/docs/webstore/update/#protect-package-updates)

## Microsoft Edge: local install, package, and store

### Local/development install

Open `edge://extensions` (or Extensions → Manage extensions), turn on **Developer mode**, click **Load unpacked**, and select the folder containing `manifest.json`; for this repo, select `Extension/`. After code changes, click **Reload**, and refresh affected pages when needed.

- Source: [Sideload an extension to install and test it locally](https://learn.microsoft.com/en-us/microsoft-edge/extensions/getting-started/extension-sideloading)

### Public package/store flow

For Microsoft Edge Add-ons, create a Partner Center developer account and a ZIP package whose root contains the manifest and all required extension files. In Partner Center, create the extension, upload the ZIP, complete availability, properties, privacy, localized store listing, and certification notes, then submit for certification.

- Source: [Publish a Microsoft Edge extension](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension)
- Source: [Register as a Microsoft Edge extension developer](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/create-dev-account)

Do not describe “Load unpacked” as a public-distribution mechanism. Microsoft documents it as local testing; ordinary users install published releases from Microsoft Edge Add-ons.

Before submitting to Edge Add-ons, obtain the final Microsoft Catalog extension ID and add its `chrome-extension://<ID>` origin to the Bridge allowlist while retaining the Chrome origin. Test the actual store-installed build, not only the sideloaded build.

## Safari Web Extension: conversion, build/sign, and distribution

### If starting again from the Chromium extension

Apple's current converter name is `safari-web-extension-packager`; the former name was `safari-web-extension-converter`. On a Mac with Xcode, the basic current command is:

```sh
xcrun safari-web-extension-packager /path/to/Extension
```

The tool creates an Xcode project with a containing macOS and/or iOS app plus a Safari Web Extension target. App Store Connect also offers a web-based packager. Again, ImmerseFree already includes the generated/customized Xcode project, so this is reference material rather than the normal install path.

- Source: [Packaging a web extension for Safari](https://developer.apple.com/documentation/safariservices/packaging-a-web-extension-for-safari)
- Source: [Safari Extensions overview](https://developer.apple.com/safari/extensions/)

### Local build and enablement

Safari Web Extensions are embedded in a containing app. Build and run the containing app, then enable the extension in Safari → Settings → Extensions. Safari 17 and later can additionally control extension access per profile and in Private Browsing.

- Source: [Running your Safari web extension](https://developer.apple.com/documentation/safariservices/running-your-safari-web-extension)
- Source: [Creating a Safari web extension](https://developer.apple.com/documentation/safariservices/creating-a-safari-web-extension)

For this repo, the ordinary local path is the existing `macOS/Install or update Safari.command`, followed by enabling ImmerseFree in Safari Settings if it is not already enabled. Its Apple Team selection is for building/signing the local app; this does **not** turn that copy into a publicly distributable release.

### Distribution requirements

Public distribution requires the Safari extension and its containing app to be signed. Apple documents two macOS release routes:

1. Join the Apple Developer Program, archive and upload through App Store Connect, then pass App Review for Mac App Store distribution.
2. For distribution outside the Mac App Store, sign the containing app and extension with Developer ID and notarize the deliverable. A local Apple Development signature is not a substitute for Developer ID distribution signing/notarization.

- Source: [Distributing your Safari web extension](https://developer.apple.com/documentation/safariservices/distributing-your-safari-web-extension)
- Source: [Developer ID certificates](https://developer.apple.com/help/account/certificates/create-developer-id-certificates/)
- Source: [Notarizing macOS software before distribution](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution)

## API-key safety that the README should state plainly

The repo currently stores user-entered Gemini, OpenCode, and custom-provider keys in `chrome.storage.local`, and its settings export contains those keys in plaintext. This is convenient for a personal, locally installed extension, but it is not a secret vault.

- Chrome says extension storage is **not encrypted** and advises against retaining sensitive data on the client side. Source: [Protect user privacy](https://developer.chrome.com/docs/extensions/develop/security-privacy/user-privacy#limit-secure-user-info)
- Google says to treat a Gemini API key like a password, never commit it to source control, and never expose it client-side in a production app; the preferred production architecture is a backend proxy. Source: [Using Gemini API keys — security and secret management](https://ai.google.dev/gemini-api/docs/api-key#security)
- Google recommends key restrictions, monitoring, per-application isolation, rotation, and deleting unused keys. Source: [Best practices for managing API keys](https://docs.cloud.google.com/docs/authentication/api-keys-best-practices)
- At minimum, restrict a dedicated Google key to the Gemini API (`generativelanguage.googleapis.com`) and set quota/billing alerts. Do not claim that an API restriction makes a client-stored key secret. Source: [Manage API keys — restrictions](https://docs.cloud.google.com/docs/authentication/api-keys#api_key_restrictions)

Recommended README disclosure:

- Use a dedicated, low-quota key, not a broad production key.
- Anyone who can inspect the browser profile/extension storage or an exported settings JSON may obtain the key.
- Never commit settings exports, screenshots containing keys, `.env` files, or provider credentials to GitHub.
- Use HTTPS for every remote custom endpoint. `http://` should be reserved for an explicitly trusted local service. (The current UI accepts arbitrary remote `http://` custom endpoints, so the documentation should warn about this rather than imply all custom API traffic is secure.)
- Delete settings export files after transfer; revoke/rotate a key immediately if exposed.

## Antigravity CLI (`agy`): identity, install, and authentication

Official installation commands:

```sh
# macOS / Linux; installs to ~/.local/bin/agy
curl -fsSL https://antigravity.google/cli/install.sh | bash
```

```powershell
# Windows PowerShell; installs under %LOCALAPPDATA%\agy\bin
irm https://antigravity.google/cli/install.ps1 | iex
```

Google's official authentication flow is: run `agy`; the CLI first checks the OS secure keyring, and if no valid session exists it opens the default browser for Google sign-in. `/logout` removes the saved account session. ImmerseFree's local bridge then reuses that authenticated `agy` installation; the extension itself does not receive the Google login token.

- Source: [Google Antigravity CLI — Installation & Auth](https://www.antigravity.google/docs/cli/install/)
- Source: [Official Antigravity CLI repository](https://github.com/google-antigravity/antigravity-cli)

Antigravity also supports a Gemini API key instead of account sign-in, but Google's steps require **both** `"modelProvider": "gemini"` in `~/.gemini/antigravity-cli/settings.json` and the `GEMINI_API_KEY` environment variable. Setting only the environment variable has no effect. This is a separate configuration from pasting a Gemini key into ImmerseFree's extension options.

- Source: [Using a Gemini API key with Antigravity CLI](https://www.antigravity.google/docs/cli/install/#using-a-gemini-api-key)

README wording should identify this precisely as “Google Antigravity CLI (`agy`)”, not merely “Antigravity,” which is ambiguous.

## OpenCode CLI: what the repo needs and what may not be promised

Official install options relevant here:

```sh
# macOS / Linux quick install
curl -fsSL https://opencode.ai/install | bash

# macOS / Linux Homebrew
brew install anomalyco/tap/opencode

# Any supported platform with Node.js
npm install -g opencode-ai
```

Windows official options include `choco install opencode`, `scoop install opencode`, and `npm install -g opencode-ai`; OpenCode recommends WSL for the best overall Windows CLI experience. ImmerseFree's Windows bridge explicitly searches native Windows npm/Scoop/common executable paths, so the native npm or Scoop method aligns with this repo better than a CLI installed only inside WSL.

- Source: [OpenCode installation](https://opencode.ai/docs/#install)

Current official OpenCode provider documentation tells users to run `/connect`, choose OpenCode Zen, sign in at `opencode.ai/auth`, add billing details, and paste an API key. Credentials are stored by OpenCode under `~/.local/share/opencode/auth.json`.

- Source: [OpenCode providers and authentication](https://opencode.ai/docs/providers/#opencode-zen)

Current OpenCode Zen documentation lists some `*-free` models, but says they are free for a limited time and documents the normal sign-in/API-key workflow. Therefore:

- Do **not** promise “nothing to install”: the repo's no-key OpenCode path still requires the `opencode` executable.
- Do **not** promise that anonymous/no-key use is stable or officially guaranteed. The primary docs currently describe authentication, and the free model roster/availability is changeable.
- Do **not** present a specific free model ID as permanent. The repo already refreshes the catalog; the README should say “currently available free models,” subject to provider limits and retirement.
- If offering the direct HTTP route with an OpenCode API key, explain that it is optional and different from the local CLI route.

- Source: [OpenCode Zen model list and pricing](https://opencode.ai/docs/zen/)

## Minimal, source-backed wording decisions for the main README

- Chrome/Edge local install: “Developer mode → Load unpacked → select `Extension/`.”
- Chrome public release: ZIP `Extension/` contents and submit to Chrome Web Store; ordinary Windows/macOS users cannot directly install an arbitrary self-hosted CRX.
- Edge public release: ZIP `Extension/` contents and submit through Partner Center to Microsoft Edge Add-ons.
- Safari local install: use the repo's existing install/build script, then enable the extension in Safari Settings. Full public distribution additionally requires an Apple Developer Program distribution identity and either App Store review or Developer ID signing plus notarization.
- Antigravity: install Google's `agy`, launch it once, and complete Google sign-in; ImmerseFree uses that local session via its loopback bridge.
- OpenCode: install the `opencode` CLI for the bridge route; avoid guarantees about no-login/free availability that are not supported by current official documentation.
- API keys: they are user-supplied secrets stored locally and exported in plaintext; recommend a dedicated restricted key, warn about exposure, and never include any project-owner key in the repository or extension package.
