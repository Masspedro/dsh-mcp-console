# Mobile release and contribution plan

This is a time-neutral release/contribution plan, not proof of npm publication, registry installability or PR submission. Verify those statuses externally. Any upstream contribution must remain **Draft** until all registry, installer, user-restart/GUI and contribution-evidence gates below are satisfied.

Target: [Soodok/Deepseek-Harness-Local-Android](https://github.com/Soodok/Deepseek-Harness-Local-Android).
The plugin is an independent Settings alternative, not a replacement of existing MCP products or a claim to be the first MCP solution.

## Proposed catalog entry

Do not enable this entry for users before the registry release can be independently installed through the actual market path. Verify publishing authorization and registry metadata independently.

The root community-plugins JSON bridge is **not** the current market UI catalog. The UI reads the approximately 2 MB `app/src/main/assets/market/catalog.json`. Its first-install path ignores `ver` and requests the canonical bare package name, which resolves `latest`; it has no preview-tag selector. A `preview` release alone therefore does not establish market installability. A maintainer must choose an explicit preview-capable installation path or defer the entry until an appropriate stable release. **Never silently move this preview to `latest` to satisfy the installer.** The illustrative fields below are not proof of the actual market schema; revalidate it against fresh upstream source.

```json
{
  "id": "mcp-console",
  "package": "@masspedro/dsh-mcp-console",
  "desc": "手机友好的 MCP 设置：连接验证、加密凭据、工具筛选（全部/仅选/排除）",
  "repo": "https://github.com/Masspedro/dsh-mcp-console"
}
```

## Gates before an upstream PR leaves Draft

1. Verify the npm publisher controls the selected scope; log in through npm's supported interactive/browser flow, never through chat credentials.
2. Complete the release gates in the compatibility document; publish an immutable tested archive using the explicit `preview` dist-tag. Verify exact registry bytes/integrity and dependency/version metadata.
3. Obtain the maintainer's explicit decision on the actual market's bare-name/`latest` behavior described above. Do not treat a `ver` field or root JSON bridge as a preview selector; do not retag the preview to `latest` without a separate authorized release decision.
4. Confirm an actual clean installation through Mobile's official profile-plugin flow on **DSH 0.2.1-rc.5**, with the user performing the engine restart, followed by live Settings → MCP GUI verification. Isolated SDK imports and successful Ubuntu CI are not substitutes. The user's rc.2 personal console `0.6.2` remains unchanged; no restart is authorized by this plan. Do not silently upgrade an engine or co-install the prototype/community packages.
5. Re-read upstream [collaboration](https://github.com/Soodok/Deepseek-Harness-Local-Android/blob/main/docs/COLLABORATION.md) and [Git workflow](https://github.com/Soodok/Deepseek-Harness-Local-Android/blob/main/docs/git-workflow.md), fetch fresh main and check existing catalog entries/PRs for duplicates.
6. Branch from the current main in the user's fork, preserve original commit identities and use the required commit style. Keep the patch to the catalog entry; do not change app versionCode/versionName, bundled profiles, provisioning or engine runtime.
7. Validate JSON syntax, unique IDs/packages and the actual market catalog schema. Satisfy the full upstream contribution checklist, including full i18n, required probes and Kotlin/APK evidence. Until those checks are documented, retain Draft status and explicitly identify missing evidence; catalog-only validation is not a Kotlin/APK build.

## Suggested PR framing

Title: `feat(plugins): 添加移动端 MCP 设置控制台`

- Independent compact Settings UI with verified Save, encrypted write-only credentials, explicit tool allow/include/exclude policy and three locales.
- Links to published npm release, source license, compatibility limits and validation evidence.
- Motivation: a user could not get a recommended settings plugin working in their own installation. No reproduced general failure or verified cause is asserted.
- `Refs #15`, **not** `Fixes #15` (already-existing discussion/alternatives).
- Catalog discovery only; no forced enabling, automatic reinstalling of user-disabled bundles, startup provisioning change or app version update.

APK bundling is a separate discussion requiring maintainer agreement. A future bundle must preserve user enable/uninstall choices and must not be overlaid back into the profile on every start.
