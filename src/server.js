// src/server.js — UDP intake → parse → WebSocket broadcast + HTTP static server
import dgram from 'node:dgram';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { config } from './config.js';
import { parsePacket } from './parser.js';

const { UDP_HOST, HTTP_HOST, UDP_PORT, HTTP_PORT, LOG_LEVEL } = config;
const DEBUG = LOG_LEVEL === 'debug';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
};

// --- HTTP static server ---
const httpServer = http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';

  // resolve under public/ and reject anything that escapes it. Prefixing with '.'
  // keeps absolute/drive-letter URLs from escaping the join, and the trailing-sep
  // compare blocks the sibling-prefix bypass (e.g. a "public-backup" next to public/).
  const filePath = path.resolve(PUBLIC_DIR, '.' + urlPath);
  if (filePath !== PUBLIC_DIR && !filePath.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404).end('Not Found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    let body = data;
    // inject WS port into index.html
    if (ext === '.html') {
      body = Buffer.from(data.toString('utf8').replaceAll('__WS_PORT__', String(HTTP_PORT)), 'utf8');
    }
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      // localhost only: never cache, so edits to skin.css / widgets show on the next
      // overlay reload or OBS "Refresh cache of current page" without a stale copy.
      'Cache-Control': 'no-store',
    });
    res.end(body);
  });
});

// --- WebSocket server on the same HTTP server ---
// Origin allowlist: legitimate clients are the local overlay / OBS (loaded from
// http://localhost:PORT) or Electron/file:// (null origin). Blocks cross-site
// WebSocket hijacking from any other web page the user happens to have open.
function originAllowed(origin) {
  if (!origin) return true; // Electron, file://, and non-browser clients send no Origin
  try {
    const h = new URL(origin).hostname;
    return h === 'localhost' || h === '127.0.0.1' || h === '::1';
  } catch { return false; }
}
const wss = new WebSocketServer({ server: httpServer, verifyClient: ({ origin }) => originAllowed(origin) });
wss.on('connection', (ws) => {
  if (DEBUG) console.log('[ws] client connected');
  ws.on('close', () => DEBUG && console.log('[ws] client disconnected'));
});
// ws forwards the HTTP server's bind error here, so handle it on the wss too →
// a port-in-use failure exits cleanly instead of throwing uncaught.
wss.on('error', (err) => {
  console.error('[ws] server error:', err.message);
  process.exit(1);
});

const MAX_WS_BUFFER = 1 << 20; // 1 MB: drop frames for a backed-up client (stale telemetry is worthless)
function broadcast(json) {
  for (const client of wss.clients) {
    if (client.readyState === 1 /* OPEN */ && client.bufferedAmount < MAX_WS_BUFFER) client.send(json);
  }
}

// --- Live lap delta vs best lap ---
// Build a distance->time trace for the best lap, then compare the current lap
// at the same distance-into-lap to get a live +/- delta.
const lapState = {
  bestTime: Infinity,
  bestTrace: [],    // [{ d, t }] samples, distance increasing
  curTrace: [],
  lapStartDist: null,
  prevLapNumber: null,
  lastSampleDist: -Infinity,
};

function refTimeAtDistance(trace, d) {
  if (trace.length < 2) return null;
  if (d <= trace[0].d) return trace[0].t;
  if (d >= trace[trace.length - 1].d) return trace[trace.length - 1].t;
  // binary search for the bracketing samples
  let lo = 0, hi = trace.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (trace[mid].d <= d) lo = mid; else hi = mid;
  }
  const a = trace[lo], b = trace[hi];
  const f = (d - a.d) / (b.d - a.d || 1);
  return a.t + f * (b.t - a.t);
}

const MAX_TRACE = 12000; // cap samples (~36 km lap @3 m) so spoofed/looping packets can't grow memory unbounded

// clear the in-progress lap run but keep the session best as the delta reference
function resetLapRun() {
  lapState.curTrace = [];
  lapState.lapStartDist = null;
  lapState.prevLapNumber = null;
  lapState.lastSampleDist = -Infinity;
}

function lapIdleResult() {
  return { lapDelta: null, lapHasReference: lapState.bestTrace.length > 1, lapBest: lapState.bestTime === Infinity ? 0 : lapState.bestTime };
}

function updateLap(t) {
  if (t.IsRaceOn === 0) {
    resetLapRun(); // back to menu → drop stale run so the next race re-anchors cleanly
    return lapIdleResult();
  }

  const dist = t.DistanceTraveled;
  const lapNum = t.LapNumber;
  const curLapTime = t.CurrentLap;

  if (!Number.isFinite(dist)) return lapIdleResult(); // bad/spoofed packet: don't poison the anchor

  // first valid packet: anchor lap start
  if (lapState.lapStartDist === null) {
    lapState.lapStartDist = dist;
    lapState.prevLapNumber = lapNum;
  }

  // session/lap restart without an idle packet: distance or lap number went backwards → re-anchor
  if (lapNum < lapState.prevLapNumber || dist < lapState.lapStartDist) {
    lapState.curTrace = [];
    lapState.lapStartDist = dist;
    lapState.lastSampleDist = -Infinity;
  }

  // lap completed (LapNumber incremented) -> finalize previous lap
  if (lapState.prevLapNumber !== null && lapNum > lapState.prevLapNumber) {
    const finishedTime = t.LastLap; // time of the lap that just ended
    if (finishedTime > 0 && finishedTime < lapState.bestTime && lapState.curTrace.length > 5) {
      lapState.bestTime = finishedTime;
      lapState.bestTrace = lapState.curTrace;
    }
    lapState.curTrace = [];
    lapState.lapStartDist = dist;
    lapState.lastSampleDist = -Infinity;
  }
  lapState.prevLapNumber = lapNum;

  const d = dist - lapState.lapStartDist;

  // sample current lap every ~3 m (keeps the trace compact); capped so it can't grow without bound
  if (d >= 0 && d - lapState.lastSampleDist >= 3 && lapState.curTrace.length < MAX_TRACE) {
    lapState.curTrace.push({ d, t: curLapTime });
    lapState.lastSampleDist = d;
  }

  const ref = refTimeAtDistance(lapState.bestTrace, d);
  const lapDelta = ref === null ? null : curLapTime - ref;

  return {
    lapDelta,                                   // seconds; <0 = ahead (green), >0 = behind (red)
    lapHasReference: lapState.bestTrace.length > 1,
    lapBest: lapState.bestTime === Infinity ? 0 : lapState.bestTime,
  };
}

// --- Drift scoring (custom; no native FH6 score field) ---
const DRIFT = {
  MIN_ANGLE: 12,   // deg — below this, not drifting
  SPIN_ANGLE: 90,  // deg — at/above this, spun out (lose current run)
  MIN_SPEED: 30,   // km/h — too slow to count
  IMPACT: 6,       // m/s — SmashableVelDiff above this = crash (lose current run)
  K: 0.5,          // points scaling: pts ≈ K · angle · speedKmh · dt
  MULT_RATE: 0.4,  // multiplier grows by this per sustained second
  MULT_MAX: 5,
};

const driftState = {
  total: 0,      // banked points this session
  current: 0,    // raw points of the in-progress drift run (pre-multiplier)
  seconds: 0,    // duration of current run
  mult: 1,       // current multiplier
  active: false,
  event: 'none', // 'drift' | 'banked' | 'spin' | 'crash' | 'none'
  lastTs: null,
};

function updateDrift(t) {
  if (t.IsRaceOn === 0) {
    // reset the in-progress run on menu/stop (keep session total)
    driftState.current = 0; driftState.seconds = 0; driftState.mult = 1;
    driftState.active = false; driftState.event = 'none'; driftState.lastTs = null;
    return driftFields();
  }

  // dt from packet timestamps, clamped to a sane range
  let dt = 0;
  if (driftState.lastTs !== null) {
    dt = (t.TimestampMS - driftState.lastTs) / 1000;
    if (!(dt > 0) || dt > 0.1) dt = 0; // ignore wraps / stalls
  }
  driftState.lastTs = t.TimestampMS;

  const speedKmh = t.Speed * 3.6;
  const angle = Math.abs(Math.atan2(t.VelocityX, t.VelocityZ) * 180 / Math.PI);
  const crashed = t.SmashableVelDiff > DRIFT.IMPACT;
  const spun = angle >= DRIFT.SPIN_ANGLE;
  const drifting = !crashed && !spun && angle > DRIFT.MIN_ANGLE && speedKmh > DRIFT.MIN_SPEED;

  if (drifting) {
    driftState.seconds += dt;
    driftState.mult = Math.min(1 + driftState.seconds * DRIFT.MULT_RATE, DRIFT.MULT_MAX);
    driftState.current += DRIFT.K * angle * speedKmh * dt;
    driftState.active = true;
    driftState.event = 'drift';
  } else {
    if (driftState.active) {
      if (crashed || spun) {
        driftState.event = crashed ? 'crash' : 'spin'; // lose the run
      } else {
        driftState.total += driftState.current * driftState.mult; // bank it
        driftState.event = 'banked';
      }
    } else {
      driftState.event = 'none';
    }
    driftState.current = 0; driftState.seconds = 0; driftState.mult = 1;
    driftState.active = false;
  }

  return driftFields(angle);
}

function driftFields(angle = 0) {
  return {
    driftAngle: angle,
    driftActive: driftState.active,
    driftCurrent: driftState.current * driftState.mult, // live run value, multiplier applied
    driftMultiplier: driftState.mult,
    driftTotal: driftState.total,
    driftEvent: driftState.event, // 'drift' | 'banked' | 'spin' | 'crash' | 'none'
  };
}

function toClientMessage(t) {
  return {
    ...updateDrift(t),
    ...updateLap(t),
    gLat: t.AccelerationX / 9.80665,   // lateral g (right +)
    gLong: t.AccelerationZ / 9.80665,  // longitudinal g (forward +)
    gVert: t.AccelerationY / 9.80665,
    isRaceOn: t.IsRaceOn,
    speedKmh: t.Speed * 3.6,
    speedMph: t.Speed * 2.23694,
    rpm: t.CurrentEngineRpm,
    rpmMax: t.EngineMaxRpm,
    rpmIdle: t.EngineIdleRpm,
    gear: t.Gear,
    accel: t.Accel,
    brake: t.Brake,
    steer: t.Steer,
    handbrake: t.HandBrake,
    boost: t.Boost,
    fuel: t.Fuel,
    power: t.Power,
    powerHp: t.Power * 0.00134102,
    torqueNm: t.Torque,
    lapNumber: t.LapNumber,
    racePosition: t.RacePosition,
    bestLap: t.BestLap,
    lastLap: t.LastLap,
    currentLap: t.CurrentLap,
    currentRaceTime: t.CurrentRaceTime,
    tireTemp: { FL: t.TireTempFrontLeft, FR: t.TireTempFrontRight, RL: t.TireTempRearLeft, RR: t.TireTempRearRight },
    tireSlip: { FL: t.TireCombinedSlipFrontLeft, FR: t.TireCombinedSlipFrontRight, RL: t.TireCombinedSlipRearLeft, RR: t.TireCombinedSlipRearRight },
    suspension: { FL: t.NormalizedSuspensionTravelFrontLeft, FR: t.NormalizedSuspensionTravelFrontRight, RL: t.NormalizedSuspensionTravelRearLeft, RR: t.NormalizedSuspensionTravelRearRight },
    carOrdinal: t.CarOrdinal,
    carClass: t.CarClass,
    carPerformanceIndex: t.CarPerformanceIndex,
    drivetrainType: t.DrivetrainType,
    smashableVelDiff: t.SmashableVelDiff,
    positionX: t.PositionX,
    positionY: t.PositionY,
    positionZ: t.PositionZ,
  };
}

// --- UDP intake ---
const udp = dgram.createSocket('udp4');
let lastWasIdle = false;

udp.on('message', (msg) => {
  if (DEBUG) console.log(`[udp] received ${msg.length} bytes`);
  if (msg.length < 324) return; // too short to be a full FH6 packet
  const t = parsePacket(msg); // parses the first 324 bytes; trailing bytes ignored
  if (!t) return;

  // idle dedup: skip repeated IsRaceOn===0 packets
  if (t.IsRaceOn === 0) {
    if (lastWasIdle) return;
    lastWasIdle = true;
  } else {
    lastWasIdle = false;
  }

  if (DEBUG) console.log('[udp] packet', JSON.stringify(t));
  broadcast(JSON.stringify(toClientMessage(t)));
});

udp.on('error', (err) => {
  console.error('[udp] error:', err.message);
  udp.close();
});

udp.bind(UDP_PORT, UDP_HOST, () => {
  console.log(`[udp] listening on ${UDP_HOST}:${UDP_PORT} (set FH6 Data Out port to ${UDP_PORT})`);
});

// Fail cleanly on a bind error (e.g. port already in use) instead of throwing uncaught.
// The message still contains EADDRINUSE, which the overlay's parent watcher detects.
httpServer.on('error', (err) => {
  console.error('[http] server error:', err.message);
  process.exit(1);
});

httpServer.listen(HTTP_PORT, HTTP_HOST, () => {
  console.log(`[http] serving public/ on ${HTTP_HOST}:${HTTP_PORT}`);
  console.log(`[obs]  Browser Source URL: http://localhost:${HTTP_PORT}`);
});
