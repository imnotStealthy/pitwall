// src/config.js — env loading + validation
import 'dotenv/config';

function parsePort(value, fallback, name) {
  if (value === undefined || value === '') return fallback;
  const n = Number.parseInt(value, 10);
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    console.warn(`[config] ${name}="${value}" invalid, using default ${fallback}`);
    return fallback;
  }
  return n;
}

// Secure-by-default: loopback only. Override UDP_HOST=0.0.0.0 if the game runs on a
// separate console/PC (the overlay's Settings → Listen IP does this for you).
const UDP_HOST = process.env.UDP_HOST || '127.0.0.1';   // bind address (0.0.0.0 = all, 127.0.0.1 = loopback only)
const HTTP_HOST = process.env.HTTP_HOST || '127.0.0.1'; // HTTP/WS bind — loopback so OBS/overlay work without LAN exposure
const UDP_PORT = parsePort(process.env.UDP_PORT, 20777, 'UDP_PORT');
const HTTP_PORT = parsePort(process.env.HTTP_PORT, 9000, 'HTTP_PORT');
const LOG_LEVEL = process.env.LOG_LEVEL || 'info';

if (UDP_PORT >= 5200 && UDP_PORT <= 5300) {
  console.warn(`[config] UDP_PORT=${UDP_PORT} is in the 5200–5300 range FH6 binds for its own socket — pick another.`);
}

export const config = { UDP_HOST, HTTP_HOST, UDP_PORT, HTTP_PORT, LOG_LEVEL };
