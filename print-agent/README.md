> ## ⚠️ RETIRED — the app no longer uses this
>
> Mountain Bakes prints **directly from the browser** now: `frontend/src/lib/print/pos/transport/`
> opens the printer over WebUSB, Web Serial or a raw socket, with nothing running
> on the till. Nothing in the app starts, contacts, health-checks or requires this
> service, and the "POS printing service is not running" message it produced no
> longer exists in the codebase.
>
> It is kept as a reference implementation of raw spooling per platform (Windows
> spooler, CUPS, raw TCP, device node). **Do not reintroduce it as a dependency** —
> requiring a second program on every till, started at boot and kept reachable, is
> the problem this was removed to solve. See `frontend/PRINTING.md`.

# Mountain Bakes Print Agent

The local service that puts a receipt on the thermal printer without Chrome's
print dialog.

```
Mountain Bakes web app  ──HTTP──▶  print agent (127.0.0.1:9110)  ──▶  80mm thermal printer
```

## Why this exists

*(Historical — this was the reasoning at the time.)*

The web app is a static export served over HTTPS. A browser could not open a USB
port, enumerate installed printers or spool a job — `window.print()` was the only
printing a page got, and it always showed the preview. **WebUSB and Web Serial
changed the first of those**, which is what made this service unnecessary; the
other two are still true, and the app no longer needs them. Worse, asking a
roll printer to lay out the app's A4 `@page` box is what produced **"Print preview
failed"** in the first place.

So the printing happens outside the browser. The app builds the ESC/POS byte
stream itself (`frontend/src/lib/print/pos/`), base64s it, and POSTs it here. This
agent hands those bytes to the printer as a **raw** job — no rendering, no page
box, no dialog.

## Running it

Node 18+ on the till. No dependencies, nothing to compile.

```bash
cd print-agent
cp print-agent.config.example.json print-agent.config.json   # optional
node src/index.mjs
```

Check what it can see:

```bash
node src/index.mjs --list-printers
```

Then open **Printer Settings** in Mountain Bakes and pick the printer from the list.

### Keeping it running

- **Windows** — [NSSM](https://nssm.cc): `nssm install MountainBakesPrintAgent "C:\Program Files\nodejs\node.exe" "C:\mb\print-agent\src\index.mjs"`.
  Or a shortcut to `node src\index.mjs` in `shell:startup`.
- **Linux** — a `systemd --user` unit running `node /opt/mb/print-agent/src/index.mjs`.
- **macOS** — a `launchd` plist with `RunAtLoad`.

## Configuration

`print-agent.config.json`, beside the agent (or wherever `MB_PRINT_AGENT_CONFIG`
points). Every field is optional.

| field | default | meaning |
| --- | --- | --- |
| `port` | `9110` | Loopback port. `MB_PRINT_AGENT_PORT` overrides it. |
| `allowedOrigins` | localhost + the Firebase hosts | Web origins allowed to print. Not a wildcard list. |
| `token` | `""` | Optional `Authorization: Bearer` secret. Set it on a shared machine. |
| `printers` | `[]` | Printers the OS spooler does not know about — a LAN box, a device node. |
| `defaultPrinter` | first found | `id` used when a request names no printer. |
| `verbose` | `true` | Log each job to stdout. |

**The config file is gitignored and must stay that way** — it names this till's
hardware and may hold the token. Nothing in the web app's source contains a token;
if you set one, it is entered once in Printer Settings and kept in that browser.

### Printers it can drive

USB and other locally-installed printers are discovered from the OS spooler and
need no config at all. Declare an entry only for the cases discovery cannot cover:

```jsonc
// A network printer on its raw port
{ "id": "counter-lan", "name": "Counter LAN", "transport": "tcp", "host": "192.168.1.50", "port": 9100 }

// A Linux device node, bypassing CUPS entirely
{ "id": "usb-lp0", "name": "Counter USB", "transport": "device", "device": "/dev/usb/lp0" }

// A shared Windows printer, for machines where the spooler P/Invoke is blocked
{ "id": "shared", "name": "Counter", "transport": "windows-share", "share": "\\\\localhost\\POS80" }
```

`transport` values: `windows-spooler` (Windows default), `cups` (macOS/Linux
default), `tcp`, `device`, `windows-share`.

## API

Loopback only. Three endpoints, and no way to enumerate or print from off the
machine — the socket binds `127.0.0.1` and that is not configurable.

```
GET  /v1/health    → { ok, agent, version, platform, requiresToken }
GET  /v1/printers  → { ok, printers: [{ id, name, transport, source, isDefault }] }
POST /v1/print     → { printJobId, printerId, documentType, documentId, dataBase64 }
                   → { ok, printJobId, printerName, bytes, durationMs }
```

`POST /v1/print` is **idempotent for one minute**: replaying a `printJobId` the
agent has already handled returns that job's original result with
`duplicate: true` instead of printing a second copy. A deliberate reprint mints a
new id, so it is never suppressed.

## Failure codes

Returned as `code`, alongside a `message` written for a cashier. The app maps
these to what to do next; `detail` is developer-only and surfaces in the app's
debug panel.

`no-printer` · `printer-not-found` · `printer-offline` · `timeout` ·
`permission-denied` · `invalid-config` · `invalid-payload` · `unsupported-printer` ·
`write-failed` · `origin-not-allowed`
