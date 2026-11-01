# Deferred Mobile catalog proposal

This is a proposal, **not a submitted pull request or a published/installable npm package**. The user chose to share the GitHub source first. npm authentication, scope ownership and registry publication are still pending.

Target: [Soodok/Deepseek-Harness-Local-Android](https://github.com/Soodok/Deepseek-Harness-Local-Android).
The plugin is an independent Settings alternative, not a replacement of existing MCP products or a claim to be the first MCP solution.

## Proposed catalog entry

Do not add this to Mobile's catalog before the registry release can be independently installed. The package name remains proposed until publishing authorization is verified.

```json
{
  "id": "mcp-console",
  "package": "@masspedro/dsh-mcp-console",
  "desc": "手机友好的 MCP 设置：连接验证、加密凭据、工具筛选（全部/仅选/排除）",
  "repo": "https://github.com/Masspedro/dsh-mcp-console"
}
```

## Preconditions before any upstream PR

1. Verify the npm publisher controls the selected scope; log in through npm's supported interactive/browser flow, never through chat credentials.
2. Complete the release gates in the compatibility document; publish an immutable tested archive using the explicit `preview` dist-tag. Verify exact registry bytes/integrity and dependency/version metadata.
3. Confirm how Mobile's market resolves preview dist-tags. The catalog above does not encode a version/tag; do not assume an unpublished `latest` works. If required, align with the maintainer or defer the entry until a stable release is appropriate.
4. Confirm an actual clean installation through Mobile's official profile-plugin flow on the supported SDK, with the user performing the engine restart. Do not silently upgrade an engine or co-install the prototype/community packages.
5. Re-read upstream [collaboration](https://github.com/Soodok/Deepseek-Harness-Local-Android/blob/main/docs/COLLABORATION.md) and [Git workflow](https://github.com/Soodok/Deepseek-Harness-Local-Android/blob/main/docs/git-workflow.md), fetch fresh main and check existing catalog entries/PRs for duplicates.
6. Branch from the current main in the user's fork, preserve original commit identities and use the required commit style. Keep the patch to the catalog entry; do not change app versionCode/versionName, bundled profiles, provisioning or engine runtime.
7. Validate JSON syntax, unique IDs/packages and the actual catalog schema. Report catalog-only validation and explicitly state that no Kotlin/APK build was performed if that is the case.

## Suggested PR framing

Title: `feat(plugins): 添加移动端 MCP 设置控制台`

- Independent compact Settings UI with verified Save, encrypted write-only credentials, explicit tool allow/include/exclude policy and three locales.
- Links to published npm release, source license, compatibility limits and validation evidence.
- Motivation: a user could not get a recommended settings plugin working in their own installation. No reproduced general failure or verified cause is asserted.
- `Refs #15`, **not** `Fixes #15` (already-existing discussion/alternatives).
- Catalog discovery only; no forced enabling, automatic reinstalling of user-disabled bundles, startup provisioning change or app version update.

APK bundling is a separate discussion requiring maintainer agreement. A future bundle must preserve user enable/uninstall choices and must not be overlaid back into the profile on every start.
