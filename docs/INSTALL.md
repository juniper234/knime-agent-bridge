# Installing the KNIME extension

The bridge ships as a zipped update site, `knime-agent-bridge-update-site-<version>.zip`. Build it with `mvn -B verify`; it lands in `releng/update-site/target/`. Needs KNIME Analytics Platform 5.12.

## Install

1. In KNIME, open **Preferences** (top right) > **Install/Update** > **Available Software Sites** > **Add...** > **Archive...**, pick the zip, name it "KNIME Agent Bridge", then **Add** and **Apply and Close**.
2. Open **Menu** > **Install Extensions...**. Expand **KNIME Agent Bridge (community)**, tick **KNIME Agent Bridge**, click **Next**, then **Finish**.
3. KNIME warns that the content is unsigned. The extension is not signed; choose **Install Anyway** if you trust the zip you built or received.
4. Restart KNIME when asked.

After the restart the bridge runs by itself. It writes its session to `~/.knime-agent/runtime` (Windows: `%USERPROFILE%\.knime-agent\runtime`). Check with:

```
node src/cli.mjs sessions
```

## Allowing or blocking changes

**Preferences** > **KNIME** > **Agent Bridge** has two options. Both apply immediately, without a restart.

- **Allow AI agents to modify, execute and save workflows** (on by default). Turn it off to make every connected agent read-only: agents can still see open workflows, settings, tables and the canvas, and any change is refused with `WRITES_DISABLED` before it reaches KNIME.
- **Only allow AI agents to use workflows that are open in KNIME** (on by default). Agents work only with the workflows you have open in a tab. They cannot list, open, create, move, rename or delete anything in your spaces (local workspace or Hub), every gateway call must name an open project, `core.port.export` writes only inside the Agent Bridge runtime folder (`~/.knime-agent/runtime` by default), and `dependency.inspect` path checks only compare against the workflow's own folder. Refusals return `SCOPE_RESTRICTED` and nothing reaches KNIME. Turn it off if you want agents to create and open workflows themselves.

The second option limits what the bridge exposes. It does not limit what a node does when it runs: a File Reader or Python Script node an agent configures can still read any file the KNIME process can read. If that matters, run KNIME as a separate OS user, or in a VM, that can only see the data agents may use.

The developer launcher (`scripts/launch.mjs`) starts its test KNIME with both options overridden (`-Dknime.agent.allowWrites=true -Dknime.agent.openWorkflowsOnly=false`), because the live tests create their own workflows.

## Connecting Claude Desktop

Build the bundle with `npm run build:mcpb` (output: `artifacts/knime-agent-bridge-<version>.mcpb`, about 6 MB). Double-click it, or drag it onto Claude Desktop's **Settings > Extensions** page, and click **Install**. Claude Desktop runs it with its own built-in Node.js; nothing else needs installing.

The extension has three settings:

- **Allow changes** (on): turn off to keep Claude read-only. KNIME's own switch (below) must also allow changes.
- **Canvas images** (off): lets Claude render pictures of the workflow. Needs Google Chrome or Microsoft Edge.
- **Browser for canvas images** (empty): a Chrome, Edge or Chromium executable if neither is found automatically.

KNIME must be running with the extension installed; otherwise the tools report that no KNIME session is available.

## Connecting Claude Code or Codex

From a checkout of this repository:

```
node scripts/register-claude-code.mjs
node scripts/register-codex.mjs
```

Add `--read-only` to either to register the server with changes turned off.

## Uninstall

**Menu** > **Help** > **About KNIME Analytics Platform** > **Installation Details**, select **KNIME Agent Bridge**, **Uninstall...**, then restart. KNIME stops loading the bridge at once; p2 removes the JAR from `plugins/` during a later cleanup.

## macOS notes

Installing any extension modifies files inside the KNIME app, so `codesign --verify` reports "a sealed resource is missing or invalid". KNIME's own app already reports this after its first start; it does not stop KNIME from launching.
