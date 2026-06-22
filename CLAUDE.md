# fh6-obs-widget — CLAUDE.md

## Overview

Local telemetry overlay for Forza Horizon 6, designed as an OBS **Browser Source**.

Architecture:
```
FH6 (UDP Data Out) ──► Node.js server ──► WebSocket ──► HTML widget (OBS Browser Source)
                         port: UDP_PORT      port: HTTP_PORT     http://localhost:HTTP_PORT
```

No build step. No framework. Ship static HTML/CSS/JS + a Node.js server.

---

## Stack

- **Runtime**: Node.js 20+
- **UDP**: built-in `dgram`
- **WebSocket**: `ws` (npm)
- **HTTP static**: built-in `http` + `fs` (serve `public/` directory)
- **Frontend**: vanilla HTML/CSS/JS (single-file widget, no bundler)
- **Config**: `.env` via `dotenv`

---

## File Structure

```
fh6-obs-widget/
├── CLAUDE.md
├── .gitignore
├── .env.example
├── .env                   ← gitignored
├── package.json
├── src/
│   ├── server.js          ← entry point: UDP + WebSocket + HTTP
│   ├── parser.js          ← FH6 324-byte packet parser
│   └── config.js          ← env loading + validation
└── public/
    ├── index.html         ← OBS Browser Source URL
    ├── widget.css         ← dark transparent overlay
    └── widget.js          ← WebSocket client + DOM rendering
```

---

## Environment Variables

Defined in `.env` (never committed). See `.env.example` for all keys.

| Variable    | Default | Description                                      |
|-------------|---------|--------------------------------------------------|
| `UDP_PORT`  | `20777` | Must match FH6 `Data Out IP Port` setting        |
| `HTTP_PORT` | `9000`  | Browser Source URL: `http://localhost:9000`      |
| `LOG_LEVEL` | `info`  | `debug` to print every parsed packet             |

**Avoid ports 5200–5300** — FH6 binds its own outgoing socket in this range.

---

## FH6 Packet Format — 324 bytes, little-endian

Implement `src/parser.js` with this exact struct order.
All `F32` → `Buffer.readFloatLE(offset)`, `S32` → `Buffer.readInt32LE(offset)`,
`U32` → `Buffer.readUInt32LE(offset)`, `U16` → `Buffer.readUInt16LE(offset)`,
`U8` → `Buffer.readUInt8(offset)`, `S8` → `Buffer.readInt8(offset)`.

```
Offset  Size  Type  Field
------  ----  ----  -----
0       4     S32   IsRaceOn              // 1 = racing, 0 = menu/stopped
4       4     U32   TimestampMS
8       4     F32   EngineMaxRpm
12      4     F32   EngineIdleRpm
16      4     F32   CurrentEngineRpm
20      4     F32   AccelerationX         // local space (right)
24      4     F32   AccelerationY         // local space (up)
28      4     F32   AccelerationZ         // local space (forward)
32      4     F32   VelocityX
36      4     F32   VelocityY
40      4     F32   VelocityZ
44      4     F32   AngularVelocityX      // pitch rad/s
48      4     F32   AngularVelocityY      // yaw rad/s
52      4     F32   AngularVelocityZ      // roll rad/s
56      4     F32   Yaw                   // radians
60      4     F32   Pitch
64      4     F32   Roll
68      4     F32   NormalizedSuspensionTravelFrontLeft   // 0=stretched, 1=compressed
72      4     F32   NormalizedSuspensionTravelFrontRight
76      4     F32   NormalizedSuspensionTravelRearLeft
80      4     F32   NormalizedSuspensionTravelRearRight
84      4     F32   TireSlipRatioFrontLeft   // 0=grip, |>1|=loss
88      4     F32   TireSlipRatioFrontRight
92      4     F32   TireSlipRatioRearLeft
96      4     F32   TireSlipRatioRearRight
100     4     F32   WheelRotationSpeedFrontLeft   // rad/s
104     4     F32   WheelRotationSpeedFrontRight
108     4     F32   WheelRotationSpeedRearLeft
112     4     F32   WheelRotationSpeedRearRight
116     4     S32   WheelOnRumbleStripFrontLeft   // 0 or 1
120     4     S32   WheelOnRumbleStripFrontRight
124     4     S32   WheelOnRumbleStripRearLeft
128     4     S32   WheelOnRumbleStripRearRight
132     4     S32   WheelInPuddleFrontLeft        // 0 or 1
136     4     S32   WheelInPuddleFrontRight
140     4     S32   WheelInPuddleRearLeft
144     4     S32   WheelInPuddleRearRight
148     4     F32   SurfaceRumbleFrontLeft
152     4     F32   SurfaceRumbleFrontRight
156     4     F32   SurfaceRumbleRearLeft
160     4     F32   SurfaceRumbleRearRight
164     4     F32   TireSlipAngleFrontLeft        // 0=grip, |>1|=loss
168     4     F32   TireSlipAngleFrontRight
172     4     F32   TireSlipAngleRearLeft
176     4     F32   TireSlipAngleRearRight
180     4     F32   TireCombinedSlipFrontLeft     // 0=grip, |>1|=loss
184     4     F32   TireCombinedSlipFrontRight
188     4     F32   TireCombinedSlipRearLeft
192     4     F32   TireCombinedSlipRearRight
196     4     F32   SuspensionTravelMetersFrontLeft  // actual meters
200     4     F32   SuspensionTravelMetersFrontRight
204     4     F32   SuspensionTravelMetersRearLeft
208     4     F32   SuspensionTravelMetersRearRight
212     4     S32   CarOrdinal               // unique car ID
216     4     S32   CarClass                 // 0=D … 7=X
220     4     S32   CarPerformanceIndex      // 100–999
224     4     S32   DrivetrainType           // 0=FWD 1=RWD 2=AWD
228     4     S32   NumCylinders
232     4     U32   CarGroup                 // FH6-only field
236     4     F32   SmashableVelDiff         // FH6-only: velocity loss (m/s)
240     4     F32   SmashableMass            // FH6-only: hit object mass (kg)
244     4     F32   PositionX                // world space meters
248     4     F32   PositionY
252     4     F32   PositionZ
256     4     F32   Speed                    // m/s — convert to km/h: × 3.6
260     4     F32   Power                    // watts — convert to hp: × 0.00134102
264     4     F32   Torque                   // Nm
268     4     F32   TireTempFrontLeft        // degrees (unit not specified by Playground; assume Celsius)
272     4     F32   TireTempFrontRight
276     4     F32   TireTempRearLeft
280     4     F32   TireTempRearRight
284     4     F32   Boost                    // PSI above atmospheric
288     4     F32   Fuel                     // 0.0=empty, 1.0=full
292     4     F32   DistanceTraveled         // meters
296     4     F32   BestLap                  // seconds; 0.0 if N/A
300     4     F32   LastLap                  // seconds; 0.0 if N/A
304     4     F32   CurrentLap               // seconds
308     4     F32   CurrentRaceTime          // seconds since start
312     2     U16   LapNumber                // laps completed
314     1     U8    RacePosition             // 1-based
315     1     U8    Accel                    // 0–255
316     1     U8    Brake                    // 0–255
317     1     U8    Clutch                   // 0–255
318     1     U8    HandBrake                // 0–255
319     1     U8    Gear                     // current gear (0=R)
320     1     S8    Steer                    // -127=full left, 0=center, 127=full right
321     1     S8    NormalizedDrivingLine    // -127 to 127
322     1     S8    NormalizedAIBrakeDifference
// Total: 324 bytes
```

**Parser function signature:**
```js
// src/parser.js
export function parsePacket(buf) {
  if (buf.length < 324) return null;
  // return a plain object with all fields as JS numbers
  // use exactly the field names above
  return { IsRaceOn, TimestampMS, ... };
}
```

---

## src/server.js — Responsibilities

1. Load config from `src/config.js`.
2. Bind UDP socket on `0.0.0.0:UDP_PORT` via `dgram`.
3. On each UDP message:
   - Validate length === 324, discard otherwise.
   - Call `parsePacket(msg)`.
   - If `IsRaceOn === 0` and last broadcast was also `IsRaceOn === 0`, skip broadcast (avoid flooding clients with idle packets).
   - Broadcast JSON to all connected WebSocket clients: `ws.send(JSON.stringify(telemetry))`.
4. Create an `http.Server` that serves `public/` as static files.
5. Attach `ws.Server` to the same HTTP server (`{ server: httpServer }`).
6. Log startup: UDP port, HTTP port, Browser Source URL.

**Rate limiting**: if the game runs at 60 fps, the server receives ~60 packets/s. Do not throttle — pass all packets through. The frontend handles its own render rate.

**WebSocket message format** sent to clients:
```json
{
  "isRaceOn": 1,
  "speedKmh": 142.3,
  "speedMph": 88.4,
  "rpm": 6240,
  "rpmMax": 8500,
  "rpmIdle": 900,
  "gear": 4,
  "accel": 220,
  "brake": 0,
  "steer": -12,
  "handbrake": 0,
  "boost": 3.2,
  "fuel": 0.87,
  "power": 298,
  "powerHp": 399,
  "torqueNm": 540,
  "lapNumber": 2,
  "racePosition": 1,
  "bestLap": 87.4,
  "lastLap": 89.1,
  "currentLap": 23.6,
  "currentRaceTime": 200.4,
  "tireTemp": { "FL": 82.1, "FR": 83.4, "RL": 91.2, "RR": 89.7 },
  "tireSlip": { "FL": 0.02, "FR": 0.01, "RL": 0.15, "RR": 0.12 },
  "suspension": { "FL": 0.5, "FR": 0.51, "RL": 0.48, "RR": 0.49 },
  "carClass": 5,
  "carPerformanceIndex": 800,
  "drivetrainType": 1,
  "smashableVelDiff": 0.0,
  "positionX": 1234.5,
  "positionY": 0.2,
  "positionZ": -567.8
}
```

Compute derived values server-side:
- `speedKmh = Speed * 3.6`
- `speedMph = Speed * 2.23694`
- `powerHp = Power * 0.00134102`

---

## public/index.html — Widget Layout

Single HTML file. Import `widget.css` and `widget.js`.

**Layout (bottom-left overlay, ~400×200px by default):**

```
┌────────────────────────────────────┐
│  [GEAR]  [SPEED km/h]  [RPM bar]  │
│  [Throttle ▓▓▓░░░] [Brake ▓▓░░░] │
│  Tire temps: FL FR RL RR (colored) │
│  Lap: 1:27.4  Best: 1:26.8  P1   │
└────────────────────────────────────┘
```

**Design constraints:**
- Background: `rgba(0, 0, 0, 0.65)` — semi-transparent for OBS chroma key OR transparent overlay.
- Set `body { background: transparent; }` so OBS composites cleanly.
- Font: `'Orbitron'` from Google Fonts (or fallback to `monospace`) — racing aesthetic.
- Primary color: `#00e5ff` (cyan) for values, `#ff4444` for alerts.
- RPM bar: horizontal bar, color shifts green → yellow → red as RPM approaches `rpmMax`.
- Tire temps: color-coded badges — blue (<60°C) → green (60–90°C) → yellow (90–110°C) → red (>110°C). Temperature scale may need tuning once tested against real data.
- Throttle/Brake: normalize `Accel/255` and `Brake/255` for bar width.
- If `IsRaceOn === 0`: show "WAITING…" and dim the widget.
- Gear `0` → display `"R"` (reverse).

**OBS Browser Source settings to document in README:**
- URL: `http://localhost:9000`
- Width: 400, Height: 200
- Custom CSS: `body { background-color: rgba(0,0,0,0); margin: 0; }`

---

## public/widget.js — WebSocket Client

```js
// Reconnect loop — OBS Browser Source may load before the server is up
function connect() {
  const ws = new WebSocket(`ws://localhost:${HTTP_PORT}`);
  ws.onmessage = (e) => render(JSON.parse(e.data));
  ws.onclose = () => setTimeout(connect, 2000);
}
```

`HTTP_PORT` is injected by the server into the HTML via a `<script>` tag or a `data-` attribute on `<body>`:
```html
<body data-ws-port="9000">
```

`render(data)` updates DOM elements by `id`. Never rebuild the DOM — only update `.textContent` and CSS properties.

---

## package.json

```json
{
  "name": "fh6-obs-widget",
  "version": "1.0.0",
  "type": "module",
  "main": "src/server.js",
  "scripts": {
    "start": "node src/server.js",
    "dev": "node --watch src/server.js"
  },
  "dependencies": {
    "dotenv": "^16.0.0",
    "ws": "^8.0.0"
  }
}
```

---

## .env.example

```
UDP_PORT=20777
HTTP_PORT=9000
LOG_LEVEL=info
```

---

## .gitignore

```
.env
node_modules/
*.log
```

---

## README.md — must include

1. **In-game setup**: SETTINGS → HUD AND GAMEPLAY → Data Out: ON, IP: 127.0.0.1, Port: `UDP_PORT`.
2. **Start server**: `npm install && npm start`.
3. **OBS Browser Source**: URL `http://localhost:9000`, 400×200, transparent background CSS.
4. **Firewall note**: Windows may block UDP 20777; allow Node.js through Windows Defender Firewall.
5. Limitation: only one app can bind a given UDP port — close other FH6 telemetry tools first.

---

## Implementation Order for Claude Code

1. `src/config.js` — load + validate env vars with defaults
2. `src/parser.js` — `parsePacket(buf)` with exact offsets above
3. `src/server.js` — UDP bind → parse → WS broadcast + HTTP static server
4. `public/index.html` + `public/widget.css` — static widget shell
5. `public/widget.js` — WS client + `render()` function
6. `.gitignore`, `.env.example`, `package.json`, `README.md`

Write a brief parser unit test inline at the bottom of `src/parser.js` (run with `node src/parser.js`) using a hand-crafted 324-byte `Buffer` to verify offset correctness.

---

## Constraints

- Do NOT use TypeScript, bundlers, or frontend frameworks. Vanilla JS only.
- Do NOT install `express` — use `http` + `fs` from stdlib for static serving.
- Do NOT add authentication — this is localhost-only.
- Do NOT throttle UDP packets server-side — pass all frames to WS clients.
- MIME type for `.js` files served by the HTTP server must be `application/javascript` (required by ES module `<script type="module">`).
- The `public/widget.js` must work as a classic `<script>` (not ES module) to avoid CORS issues when OBS loads `file://` instead of `http://`.
