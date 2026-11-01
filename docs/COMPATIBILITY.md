# Compatibility and validation evidence

## Release boundary

Community preview: `@masspedro/dsh-mcp-console@0.7.0-preview.1`.
Registry availability, publisher authorization and the explicit `preview` dist-tag must be independently verified. GitHub source sharing does not imply registry availability, a Mobile catalog entry, an APK integration or security certification.

The community metadata targets **DSH `0.2.1-rc.5` exactly**, Node.js major 24, the matching MCP/Tools/Typert peers, Cordis `~4.0.5` and Zod `^4.4.3`. It deliberately rejects the older `0.2.1-rc.2` runtime rather than implying unverified community-edition support. The separately installed personal prototype `0.6.2` was validated on rc.2; it has not been replaced, upgraded or restarted by community preparation.

The development lock captures public registry dependency integrity/version metadata. Ignored lifecycle scripts are mandatory for clean setup. A generated lock alone is not proof of a successful clean install or cross-platform support.

## Isolated evidence so far

Validation uses genuine public SDK packages on Android/bionic with Node `24.22.1`, newly created synthetic homes/profiles, controlled stdio/loopback HTTP fixture servers and no user's real MCP endpoint, credentials, profile configuration or store.

| Check | Evidence and scope |
| --- | --- |
| Unmodified prototype against genuine npm SDK rc.5 | 458 total: 448 passed, 8 failed, 2 intentional standalone-loader skips. Not an all-pass result. |
| Failure classification | Seven tests exercised a removed optional rc.2 native-navigation icon shim with a hardcoded old Web artifact; one golden assertion assumed host Zod 4.4.3 while the rc.5 registry closure selected 4.6.7. Functional backend/security/native transport tests passed. |
| Icon-free candidate focused checks | 147/147 passed; client, contracts and genuine client-module materialization fixtures. Not browser rendering. |
| Genuine native fiber/inventory regression | 2/2 native activation tests passed with readiness state, unmanaged names-only inventory, exclusion of owned fibers and omission after OFF. |
| Final community source suite | **451 total / 449 passed / 0 failed / 2 intentional resolver skips**, approximately 86.096 seconds, against the genuine rc.5 SDK with exact Mobile Android adapter and documented Zod deduplication. |
| Separate hard-gated standalone imports | **2/2 passed / 0 skipped / 0 failed**, without `test/register` or custom resolver: source external linked root plus actual synthetic npm file-link profile using genuine SDK interception. |
| Final source/test freshness | Byte-stable before/after validation. Aggregate SHA-256 of the 36 source/test files: `3ddba8f8b4b2379b2ab202a3246f47a6634b9179622c8467ccefa3763c58354c`. Build/freshness and synthetic installation steps exited zero. |
| Post-suite development harness checks | Added explicit development Zod4.4.3 pin/lock with zero nested Zod entries; physical clean-install reification passed in the documented public Ubuntu CI run. Focused metadata tests **13/13 passed**. The corrected package auditor passed against actual npm12.2.1's name-keyed JSON shape, selecting **18 regular runtime-only files**; freshness passed. Runtime source/test hashes did not change. |
| Public CI | **SUCCESS**: [public Ubuntu SDK checks run](https://github.com/Masspedro/dsh-mcp-console/actions/runs/41277038129), independently confirmed through the GitHub CLI. Clean dependency installation/reification, isolated checks and package audit passed. Ubuntu is a separate target, not an Android APK installation or live GUI test. |

Three Zod facts must not be confused: the pristine npm SDK closure contains root **4.6.7** plus 50 nested **4.4.3** copies; the separately assembled Mobile-equivalent SDK contains root **4.4.3** and no nested validator copies after the published deduplication; the rc.5 **Web shell** embeds **4.4.3**. The same final source suite passed **451 total / 449 passed / 0 failed / 2 intentional skips** against both SDK variants (pristine run approximately 100.525 seconds). The pristine run uses the test-only resolver and is **not** standalone identity proof. Tests verify the selected real package and peer floor, genuine shell seed names, actual SDK release metadata and real client factories; a nonrendering React stand-in is not a pixel/browser test.

## Android npm versus the actual Mobile runtime

The pristine npm SDK's standalone production-interception bootstrap is blocked on Android: `node-addon-require-builtin@0.1.9` has no published usable Android arm64 optional binding in the examined distribution. General tests with a test-only resolver do not prove production import identity.

Mobile's published runtime builder explicitly adapts this dependency for Android. The investigation found the exact recipe in [collect-termux-runtime.sh](https://github.com/Soodok/Deepseek-Harness-Local-Android/blob/4e1e51aacd34700425475b0e567f485e019a6e31/scripts/collect-termux-runtime.sh#L325-L349), invoked by the rc.5 runtime build. Reproducing **that exact version-bound heredoc** in a separate copied SDK is allowed evidence of the Mobile-recipe environment, not proof that pristine npm works. It does not alter this plugin, the live engine or the pristine SDK and does not borrow the installed rc.2 adapter. The extracted adapter SHA-256 is `32919526d6dc9a4fe24ae80ced3546efd33142c4339dd54a73b40985177da3e6`.

The public builder also invokes [dedupe-zod.py](https://github.com/Soodok/Deepseek-Harness-Local-Android/blob/4e1e51aacd34700425475b0e567f485e019a6e31/scripts/dedupe-zod.py), whose inspected SHA-256 is `dbfa26a35299a1a6d2bf3c6ed6ac56742b79b9d72dac01eb55a6f3be976ddea0`. An adapter-only copy still failed the strict standalone oracle: its flat CLI resolution selected root4.6.7 whereas the genuine SDK's interception could select nested4.4.3. That is not proof of a plugin incompatibility. Reproducing the version-bound public deduplication in a third, separately filtered SDK made both resolution paths share genuine Zod4.4.3. No strict identity assertion was weakened and no live SDK was changed. The explicit checkout devDependency/lock now pins that same floor for ordinary clean CI installation, whose physical clean-install reification passed in the documented public Ubuntu CI run. This does not establish Android APK or live GUI compatibility.

The standalone tests run without the unit resolver/custom loader and fail on missing native bootstrap. The final **2/2 pass** applies to the exact adapter-plus-deduplication Mobile-equivalent SDK, not pristine npm. They exercise genuine installation/profile resource interception and verify that console and SDK share the exact Cordis/MCP/Tools/Typert/Zod module identities. A synthetic npm file-link profile is real package/link metadata, **not** Mobile's official installer, bundle composition, backend activation or the user's live profile.

## Version-coupled surfaces

- Host uses public exports of MCP client, ToolRuntime, Cordis Service/Context and Typert. The scoped tool-registration facade uses `Service.extend`, traced child context and `ToolRuntime.prototype.register`; it is tested with real classes, not assumed to work on arbitrary future SDKs.
- The client is a lazy `window.__ModuleLoader__.load` factory, not a standalone app. Its declared externals must be real shell seeds, and injected dependencies must provide actual compatible Web client exports.
- Settings/UI primitive contracts own buttons, checkbox labels/booleans, modal behavior and renderer placement. Theme tokens and module contracts are still version-coupled.
- The community edition removes the entire native-navigation glyph shim, minified artifact fingerprints, native-ledger subscriptions and MutationObserver. It retains the owned MCP heading SVG. The SDK chooses its default Settings navigation icon; no fabricated icon metadata or replacement rc.5 minified hashes are used.
- Preserve full opaque MCP names for policy/dispatch; visible suffixes are not claimed to reconstruct the provider's original raw names.

## Coexistence and storage

The public package identity changed; internal overlay ID, RPC namespace/service, locale/CSS markers, storage path and encrypted AAD did not. This is intentional, not proof of migration support.

Do not co-install the prototype and community packages in the same profile. A deliberate replacement reuses existing profile data **in place**, and saved ON records may restore immediately when the new backend starts. It does not start empty. Turn records OFF beforehand if you do not want reconnection, preserve private backups and use official profile lifecycle operations. No live migration/replacement was performed in this validation.

## Reproduce from source

Use the tracked lock and Node 24:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run check:isolated
npm run audit:package
```

The checker uses the checkout's development SDK, or an explicitly supplied **isolated** `DSH_SDK_ROOT`. It allocates a new home/profile/cache/config for each run, disables package scripts, never starts DSH, and retains synthetic evidence in ignored test-run directories. It preserves public CA trust paths where Android needs them; HTTPS verification is not disabled. Missing native bootstrap fails the standalone gate. For Android, a separately assembled exact Mobile-recipe SDK is required; that adapter is not vendored into the plugin.

An untrusted checkout can execute arbitrary JavaScript even with npm scripts initially disabled. Review its source before running tests/build; `--ignore-scripts` is not a sandbox.

## Unperformed/not claimed

- npm publication, registry installability/dist-tags and catalog PR status must be verified externally; this document does not assert that publication or PR submission has occurred. Any contribution remains Draft until the registry/latest decision, clean official Mobile rc.5 installation with user-controlled restart and GUI verification, and upstream contribution evidence gates are satisfied.
- Community edition installed through Mobile's official CLI in a real user profile; no engine restart or SDK upgrade.
- Browser/WebView rendering, mobile pixel E2E, OAuth/legacy SSE, APK/Kotlin/Gradle build or broad desktop/Windows compatibility.
- Security penetration testing, formal certification, universal SSRF protection, hardware-backed secrets or universal correction of another plugin.

Security boundaries are detailed in [SECURITY.md](SECURITY.md). Mobile contribution preconditions are in [MOBILE_CATALOG_PROPOSAL.md](MOBILE_CATALOG_PROPOSAL.md).
