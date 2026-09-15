# SOMA Local Demo: Installation and Run

The distribution includes the built whole-body/wrist simulators and guides. Running it does not require the source project, Blender, Python or a hosting account.

## Supported systems

- macOS 13.5 or later: Apple Silicon or Intel.
- Windows 11 or later: x64. ARM64 uses x64 execution and requires separate device validation.
- Linux: glibc 2.35 or later, x64 or ARM64. Ubuntu 22.04 or later is recommended. Alpine/musl is unsupported.

Node.js 24.21.0 and Wrangler 4.92.0 are pinned. Official Node binaries are verified by SHA-256 and installed in the demo's `.runtime` directory. Global Node and system PATH are unchanged. Initial installation requires internet access; no external account is required afterward.

## macOS

1. Fully extract the ZIP to a writable folder.
2. Run `Install-macOS.command`.
3. Run `Start-macOS.command` and open the printed local URL.
4. Optionally run `Verify-macOS.command` to start a separate verification server and check pages, scripts and model assets.

Terminal equivalents are `bash Install-macOS.command`, `bash Start-macOS.command --port 3000` and `bash Verify-macOS.command --port 3001`. If macOS blocks a downloaded launcher, review its contents and use these terminal commands.

## Windows

Use `Install-Windows.cmd`, `Start-Windows.cmd` and `Verify-Windows.cmd`. Set another port with `Start-Windows.cmd -Port 3001`.

The launchers use PowerShell 5.1 or later. The execution-policy exception affects that process only, not system policy. Node is extracted locally without an administrator-level MSI installation.

## Linux

Run `bash Install-Linux.sh`, `bash Start-Linux.sh` and `bash Verify-Linux.sh --port 3001`. Bash is required. Missing curl, tar or gzip are installed using apt/dnf/zypper/pacman; only that step requires root or sudo.

## Address, stop and restart

The default URL is `http://127.0.0.1:3000`. Wait for the server-ready message. Stop with Ctrl+C. Subsequent runs need only Start. Reinstallation reuses packages when versions and lockfiles match.

For access from another device, use `--host 0.0.0.0` on macOS/Linux or `-BindHost 0.0.0.0` on Windows, then use the computer's LAN IP and port. Defaults allow local access only. Configure the OS firewall as needed.

## Verification and troubleshooting

Verify starts a server, checks the home/body/wrist/research/guide/original experiment pages, scripts and GLB assets, then stops it. Results are in `.runtime/verification.json` and `.runtime/verification-server.log`. It does not test browser WebGL rendering or FPS.

- Port occupied: choose another port. Existing servers are not terminated.
- Integrity failure: extract a fresh ZIP into a new folder.
- Installation failure: check connectivity, disk space and write access, then rerun Install.
- Missing models: check WebGL and hardware acceleration in a current browser.
- Moving between operating systems: use the original ZIP; do not copy installed `node_modules` or `.runtime` across systems.

## Attribution

Model sources and terms are preserved in `dist/client/models/ATTRIBUTION.md` and the motion attribution document. This research demo does not establish clinical accuracy or guarantee commercial-use rights for every asset.

## Environment references

Based on the [official Node.js 24 distribution](https://nodejs.org/download/release/v24.21.0/) and [Wrangler supported environments](https://developers.cloudflare.com/workers/wrangler/install-and-update/).

## Sleep sensor socket demo

After installation, run npm run sleep:demo from the demo folder in a separate terminal. In Sleep apnea, choose WebSocket / IP and enter ws://localhost:8765/stream. For device input, run npm run sleep:gateway and send v1 JSON packets to /input. See the Sleep apnea chapter in the web manual for units and channel formats. The default gateway is accessible only on this computer and is not an authenticated Internet service.
