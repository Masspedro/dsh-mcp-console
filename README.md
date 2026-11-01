# DSH MCP Console

A compact, mobile-first **Settings → MCP** plugin for **DSH Mobile on Android**.
Independent community project, not an official DeepSeek or DSH Mobile component.

**Community source preview:** `0.7.0-preview.1`, derived from the Android-validated personal prototype `0.6.2`. This is **not yet a published npm release**. Against an isolated genuine DSH `0.2.1-rc.5` SDK assembled with Mobile's versioned Android adaptations, the final suite passed **449/451 tests with zero failures and two intentional standalone-loader skips**; separate genuine production-resolution checks passed **2/2 without that loader**. This is fixture/import evidence, not a community-edition APK installation, live GUI test or broader platform certification. The existing rc.2 personal installation was left unchanged.

## Why this exists

Configuring MCP from a phone should not require editing namespaces or pasting secrets into YAML. This plugin provides a small settings page rather than a connector marketplace.

It originated after a user could not get a maintainer-recommended MCP settings plugin working in their particular DSH Mobile installation. That is a report about that installation, not proof that the recommended plugin is universally broken or a verified diagnosis of its failure. Other MCP plugins remain valid alternatives. See the [Mobile discussion](https://github.com/Soodok/Deepseek-Harness-Local-Android/issues/15#issuecomment-6436044552).

## Features

- Native DSH settings and UI primitives; narrow-screen layout, bounded checkboxes and touch targets.
- **Save validates and activates:** an official MCP initialize/handshake and initial tool synchronization must succeed before a new configuration is committed. HTTP 200 or an enabled switch is not verification.
- Console-owned **stdio** and **Streamable HTTP** servers; simple write-only Token/Headers fields and advanced local credential bindings.
- Persisted on/off intent, explicit reconnect and honest last-verification status. Previously enabled records may restore on plugin startup; opening or refreshing the screen does not connect.
- Encrypted local credentials with masked write-only inputs. This is not Android Keystore or protection against root/same-process access.
- Advanced tool exposure policy: **all**, **only selected**, or **all except selected**. Visible labels omit the MCP identifier prefix; selection, storage and dispatch still use exact full public names.
- Default tool timeout **60 seconds**, with an optional advanced override.
- English, Brazilian Portuguese and Simplified Chinese.
- Existing/native MCP namespaces are names-only, read-only inventory. No automatic takeover, migration or business-tool invocation.

## Installation

The registry installation below becomes available only after the first npm release is published:

```sh
dsh plugin --profile web add @masspedro/dsh-mcp-console@preview
```

Then restart the engine **yourself through the DSH Mobile app** and open Settings → MCP. A page refresh alone does not prove that the backend was reloaded.

For a locally built development archive, pass the archive's absolute path to the same official `dsh plugin --profile web add` command. Do not manually copy files into the engine or edit the native configuration. Do not move/delete an archive while your profile still has a `file:` dependency pointing to it.

Use only trusted servers/commands. Saving a stdio server executes its configured program; saving HTTP contacts its configured endpoint. Installing the plugin alone does not authorize a new server.

**Personal-prototype users:** do not co-install the prototype and community packages in the **same profile**, even if you intend to enable only one. They retain the same overlay ID, RPC namespace/service and storage/AAD identities. Replacing the prototype is therefore **not a clean slate or an import/migration**: the community backend reuses that profile's existing data in place and may restore saved ON records on its first startup. Turn servers OFF in the prototype before a deliberate switch if you do not want reconnection. No automated switch or migration is provided; preserve an appropriate private backup and never downgrade or alter a live encrypted store speculatively.

## Tool selection

Expand the server's advanced tool policy, choose a mode, search the tool names, select entries and explicitly Apply.

- **All:** newly discovered tools are allowed.
- **Only selected:** an empty selection exposes no tools; newly discovered tools are not automatically admitted.
- **All except selected:** excluded exact names remain blocked; unlisted future tools are admitted.

Missing previously selected names remain until you deselect them. Policy enforcement applies to console-owned registration and dispatch, not merely checkbox appearance. Already-dispatched requests cannot be recalled. SDK discovery failures can leave old SDK definitions until a verified reconnect; see the security boundaries below.

## Security and support boundaries

Management RPCs are authenticated owner-only operations, not model-facing tools. Connections are profile-scoped and can be shared across chats in that profile. The host's existing execution/governance still applies.

Credentials and metadata are separate from package files. Losing the file key/passphrase loses access; backups containing both key and ciphertext can reveal secrets. The page's authenticated carrier is not itself encryption: remote access needs an encrypted transport. Delete/OFF does not revoke a provider's token or guarantee remote process shutdown.

Read the [full security model](docs/SECURITY.md) and [compatibility/evidence](docs/COMPATIBILITY.md). No OAuth, legacy SSE, automatic reconnect loop, broad profile import, hardware-backed vault or general SSRF firewall is claimed. Windows/desktop support has not been validated.

## Contributor checkout

The source repository contains `src`, synthetic tests and generic build scripts. The installable runtime archive contains generated `lib`, documentation, license/notice and registration metadata; it does not contain a developer SDK, tests, private logs or user data.

The intended clean-checkout setup uses Node.js 24 and the exact development SDK declared in this package. Dependency scripts must not be run implicitly:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run check:isolated
npm run audit:package
```

The checkout pins development Zod **4.4.3** as well as the exact SDK, avoiding the pristine registry tree's root/nested validator mismatch; runtime peers remain `^4.4.3`. `DSH_SDK_ROOT` may point to an isolated genuine SDK `node_modules`; never point fixture home/profile variables at production profiles or stores. Android requires the exact separate Mobile-recipe adaptations described in the compatibility document; they are not bundled into this plugin. General tests use controlled local fixtures and do not call a user's MCP server. Standalone import tests must run without the general test loader. Nonrendering React fixtures are not browser E2E or cross-platform validation.

## Contributing and reporting

Keep changes focused and include exact validation boundaries. Do not upload profile configuration, stores, file keys, tokens, session exports or full private logs. Use a synthetic server and sanitized screenshots in reports.

For a potential security issue, do not post exploit details or credentials publicly. Use GitHub private vulnerability reporting if enabled; otherwise open a sanitized issue requesting a private contact channel. See [security](docs/SECURITY.md).

## License

MIT. See [LICENSE](LICENSE) and [NOTICE](NOTICE) for the separately licensed MCP heading mark and dependency attribution.
