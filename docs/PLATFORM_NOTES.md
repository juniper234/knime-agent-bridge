# Platform notes

Platform findings for building and running the bridge. Update this file when a KNIME version or OS is checked.

## macOS (Apple Silicon), KNIME 5.12.0

Checked 2026-10-31 on the developer Mac.

| Item | Value |
|---|---|
| App | `/Applications/KNIME 5.12.0.app` (bundle ID `org.knime.product`, version 5.12.0) |
| Eclipse home (`KNIME_HOME` equivalent) | `/Applications/KNIME 5.12.0.app/Contents/Eclipse` |
| Executable | `Contents/MacOS/knime` |
| `knime.ini` | `Contents/Eclipse/knime.ini` (relative paths resolve from `Contents/MacOS`, e.g. `../Eclipse/plugins/...`) |
| Plugins | `Contents/Eclipse/plugins` (636 entries) |
| Dropins | `Contents/Eclipse/dropins` (exists, empty) |
| p2 profile | `Contents/Eclipse/p2/org.eclipse.equinox.p2.engine/profileRegistry/KNIMEProfile.profile` |
| Bundled JRE | `org.knime.binary.jre.macosx.aarch64_21.0.9.20260430` (Java 21) |
| Default heap | `-Xmx2048m` |
| Code signature | Signed by KNIME (`TeamIdentifier=V7WZJX2HS9`), app has `com.apple.quarantine` attribute |
| Ownership | App folder owned by the user (`jan:admin`), so p2 can install into it without sudo |

Notes:

- p2 installs extensions inside the `.app`. That changes files covered by the code signature. Whether Gatekeeper complains on the next launch is checked in M3.
- `knime.ini` sets `-Dp2.trustedAuthorities=https://update.knime.com`. Content from any other site (our GitHub Pages site or a zipped archive) will get p2's trust prompt for unsigned or untrusted content. Relevant to D8.
- `-XstartOnFirstThread` is required for SWT on macOS; the launcher must keep it when copying vmargs.

### Update sites configured by default

```
https://update.knime.com/analytics-platform/lts/5.12
https://update.knime.com/analytics-platform/lts/5.12/5.12.0
https://update.knime.com/community-contributions/5.12
https://update.knime.com/community-contributions/trusted/5.12
https://update.knime.com/partner/5.12
```

`analytics-platform/lts/5.12` is the candidate p2 source for the Tycho target platform (M1). 5.12 is an LTS line, which suits the D3 version policy.

### Required bundles present

All `Require-Bundle` and `Import-Package` dependencies from `java/META-INF/MANIFEST.MF` resolve to bundles in this install:

| Bundle | Version on macOS |
|---|---|
| org.eclipse.core.runtime | 3.33.100.v20250516-0931 |
| org.eclipse.ui.workbench | 3.135.100.v20250517-0909 |
| org.eclipse.swt | 3.130.0.v20250528-1759 (+ `org.eclipse.swt.cocoa.macosx.aarch64`) |
| org.knime.core | 5.12.0.v202606180846 |
| org.knime.core.util | 6.12.0.v202606131335 |
| org.knime.gateway.api | 5.12.0.v202606171435 |
| org.knime.gateway.impl | 5.12.0.v202606171738 |
| org.knime.gateway.impl.jsonrpc | 5.12.0.v202606010651 |
| org.knime.gateway.json | 5.12.0.v202606010651 |
| org.knime.ui.java | 5.12.0.v202606150722 |
| com.github.briandilley.jsonrpc4j | 1.5.2 |
| Jackson core / databind / annotations | 2.19.0 |
| org.apache.commons.lang3 | 3.18.0 |
| com.sun.jna | 5.17.0.v20250316-1700 |
| com.sun.jna.platform | 5.17.0 |
| com.equo.chromium | 128.0.30 |

The KNIME bundle qualifiers match the Windows build recorded in `VERIFICATION-0.5.md` (`org.knime.core v202606180846`, `org.knime.base v202606261225`, `org.knime.gateway.api v202606171435`, `org.knime.ui.java v202606150722`). Same KNIME build on both OSes.

### JNA

`com.sun.jna.platform_5.17.0.jar` has no `Eclipse-PlatformFilter` and exports `com.sun.jna.platform.win32;version="5.17.0"` on macOS. It contains `win32/Kernel32` classes. So the current mandatory `Import-Package: com.sun.jna.platform.win32` **resolves on macOS**. The plan still makes it optional (cheap, protects against a future KNIME dropping JNA) and isolates the Kernel32 call in its own class.

### Internal package visibility

The internal packages the bridge uses (`org.knime.gateway.impl.project`, `org.knime.gateway.impl.webui.jsonrpc`, `org.knime.gateway.impl.webui.jsonrpc.service.util`, `org.knime.ui.java.api`) are exported without `x-internal` or `x-friends`. Tycho compiles them without access errors.

### Launching for development

`node scripts/launch.mjs` resolves `KNIME_HOME` to `<KNIME app>/Contents/Eclipse` and starts `<KNIME app>/Contents/MacOS/knime` directly (not through `open`), so each launch is a separate process even when another KNIME from the same app is running. The launcher copies every `-vmargs` line from `knime.ini`, which keeps `-XstartOnFirstThread` and the relative `-Xdock:icon`; the working directory is `Contents/Eclipse`, so relative paths resolve. Results are in `VERIFICATION-mac.md`.

## Windows 11, KNIME 5.12.0

Verified for v0.5 (see `VERIFICATION-0.5.md`). Install-path checks for the extension are pending (M3, M6).
