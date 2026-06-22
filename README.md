# pitwall

**Local Forza Horizon 6 telemetry overlay** — an OBS **Browser Source** *and* a transparent,
always-on-top desktop HUD (system tray + settings), with cinematic broadcast-style skins.

```
FH6 (UDP Data Out) ──► Node.js server ──► WebSocket ──► HTML widget (OBS Browser Source)
```

No build step, no framework — vanilla HTML/CSS/JS + a small Node.js server.

## 1. In-game setup

In Forza Horizon 6: **SETTINGS → HUD AND GAMEPLAY → Data Out**

- Data Out: **ON**
- Data Out IP Address: `127.0.0.1`
- Data Out IP Port: `20777` (must match the **UDP port** — set in the overlay app's *Connection*
  settings, or `UDP_PORT` for the standalone server)

## 2. Start the server

**Windows**: double-click `start.bat` (installs dependencies and creates `.env` on first run).

Or manually:

```bash
cp .env.example .env   # optional — defaults work out of the box
npm install
npm start
```

You should see the UDP port, HTTP port, and the Browser Source URL logged.

Dev mode with auto-restart: `npm run dev`.

## 3. OBS Browser Source

Add a **Browser Source**:

- URL: `http://localhost:9000`
- Width: `400`, Height: `200`
- Custom CSS: `body { background-color: rgba(0,0,0,0); margin: 0; }`

The overlay shows "WAITING…" until FH6 starts sending packets (i.e. you're in a race).

## 4. On-screen overlay app (without OBS) — system tray + settings window

A small Electron app shows the widgets **directly on top of the game** (no OBS), driven from
a system-tray icon and a **settings window** with three tabs. It starts the telemetry server
itself (in the background, no console), so you don't need `start.bat`; OBS keeps working in
parallel on `http://localhost:9000`.

### Run (portable — no install)

Double-click **`FH6-Overlay-1.0.0-portable.exe`** (build it with `npm run dist` — see *Build*).
No setup, no shortcuts: it runs straight away and a tray icon appears; **click it to open
Settings**. (To start it with Windows, tick *Launch at Windows startup* in Settings — keep the
.exe in a fixed location, since a portable app is registered by its current path.)

### Settings window

- **In-game tab** — check/uncheck each widget to show it on screen (Speed, Shift light, Lap
  delta, Vehicle, Tires, G-Force, Combined HUD). Plus: *Show only when Forza is active*
  (hide on alt-tab), *Lock overlays* (clicks pass through vs. drag-to-reposition), *Hide
  all*, *Launch at Windows startup*, *Reset positions*, and a **Connection** section — set the
  *Listen IP*, *UDP port* (match FH6 Data Out) and *HTTP/WS port* right in the app, **no
  `.env` needed**. Changing a port restarts the server and reloads the overlays.
- **Appearance tab** — a **Preset** theme (`Classic` · `Cinematic` · `Neon` · `Carbon` · `WEC`,
  via `public/skin.css`), plus accent/alert colour, background opacity, font, speed
  `km/h ↔ mph`, temp `°C ↔ °F`, and *per-widget* size, opacity, field show/hide and **style**:
  - **Speed** — Digital · Analog · **Cinematic** (gradient redline arc + glowing eased needle)
  - **Tires** — Grid · Car-corners · **G-Force** — Circle · Ball · **Shift** — Bar · Arc

  Everything previews live and applies to OBS too. *(A custom font is fetched from Google
  Fonts, so it needs internet; the default Orbitron/monospace work offline.)*
- **OBS tab** — the **customized** Browser-Source URL for each widget (your Appearance
  settings are baked in, so OBS looks identical) with **Copy** / **Open** buttons and the
  recommended size. Add these in OBS as Browser Sources.

Tray menu (right-click): *Settings… · Show/Hide overlays · Quit*.
Shortcuts: `Ctrl+Alt+L` lock/unlock, `Ctrl+Alt+H` hide/show.

> ⚠️ **Borderless required**: a transparent overlay only draws over FH6 if the game runs in
> *Borderless / borderless windowed* mode, not exclusive fullscreen (a Windows limitation;
> OBS is unaffected because it captures the source directly).

Preferences (enabled widgets, positions, appearance, gating, autostart) are saved in
Electron's `userData` folder.

### Run from source (no build)

`setup.bat` once, then double-click `FH6-Overlay.vbs` (silent, no console), or `npm run overlay`.

### Build

```bash
npm install
npm run dist     # → dist/FH6-Overlay-1.0.0-portable.exe (single portable .exe)
npm run pack     # → dist/win-unpacked/ (unpacked folder, runnable without packing)
```

> If `npm run dist` fails with *“Cannot create symbolic link: A required privilege is not
> held”*, electron-builder can't unpack its signing cache without symlink permission. Fix
> once by enabling Windows **Developer Mode** (Settings → Privacy & security → For
> developers), or run the build from an elevated terminal. The build is intentionally
> unsigned (personal tool), so signing is skipped. `npm run pack` doesn't need this.

**Vehicle widget**: shows the car name (from `CarOrdinal`), class, PI and drivetrain. The
`ordinal → name` mapping comes from `public/cars.json` (community
*Forza-Horizon-Discord-Rich-Presence* database, ~1300 entries). If a car is missing, the
widget shows `Car #<ordinal>` — just add it to `cars.json`.

**Foreground detection**: a hidden PowerShell script (`electron/foreground-watch.ps1`) reads
the active window via Win32 (`GetForegroundWindow`) and tells the overlay when Forza gains or
loses focus. The watcher is started first at launch so detection is immediate; if it fails
(PowerShell blocked) the overlay falls back to "always visible" rather than staying hidden.

## Configuration

The **overlay app** configures these in its *Connection* settings (saved in `userData`, no
`.env`). The values below are the env vars for the **standalone server** (`npm start` /
`start.bat`); the app's settings override them.

| Variable    | Default     | Description                                      |
|-------------|-------------|--------------------------------------------------|
| `UDP_HOST`  | `127.0.0.1` | Bind address (`127.0.0.1` = loopback only; set `0.0.0.0` only if the game runs on a separate console/PC — that also exposes the port to the LAN) |
| `HTTP_HOST` | `127.0.0.1` | HTTP/WS bind (loopback; OBS still uses `http://localhost`) |
| `UDP_PORT`  | `20777`     | Must match FH6 `Data Out IP Port` setting        |
| `HTTP_PORT` | `9000`      | Browser Source URL: `http://localhost:9000`      |
| `LOG_LEVEL` | `info`      | Set to `debug` to print every parsed packet      |

Avoid UDP ports `5200–5300` — FH6 binds its own outgoing socket in that range.

## Notes & limitations

- **Firewall**: Windows may block UDP `20777`. Allow Node.js through Windows Defender Firewall if no data arrives.
- **Single binder**: only one app can bind a given UDP port. Close other FH6 telemetry tools first.
- Localhost-only; no authentication by design.

## Verifying the parser

```bash
node src/parser.js
```

Runs an inline offset test against a hand-crafted 324-byte packet.

## License

[MIT](LICENSE) © StealthyLabs. Not affiliated with or endorsed by Playground Games / Microsoft;
*Forza Horizon* is a trademark of Microsoft. Car name data in `public/cars.json` comes from the
community *Forza-Horizon-Discord-Rich-Presence* project.
