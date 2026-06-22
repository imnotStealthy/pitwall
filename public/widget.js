// widget.js — WebSocket client + DOM rendering (classic script, no modules)
(function () {
  var WS_PORT = document.body.dataset.wsPort || location.port || '9000';

  // cache DOM nodes once — render() only updates, never rebuilds
  var el = {
    widget: document.getElementById('widget'),
    status: document.getElementById('status'),
    gear: document.getElementById('gear'),
    speed: document.getElementById('speed'),
    rpm: document.getElementById('rpm'),
    rpmBar: document.getElementById('rpm-bar'),
    throttle: document.getElementById('throttle-bar'),
    brake: document.getElementById('brake-bar'),
    tireFL: document.getElementById('tire-fl'),
    tireFR: document.getElementById('tire-fr'),
    tireRL: document.getElementById('tire-rl'),
    tireRR: document.getElementById('tire-rr'),
    lap: document.getElementById('lap'),
    currentLap: document.getElementById('current-lap'),
    bestLap: document.getElementById('best-lap'),
    position: document.getElementById('position'),
    speedUnit: document.getElementById('speed-unit'),
  };

  function fmtLap(sec) {
    if (!sec || sec <= 0) return '--';
    var m = Math.floor(sec / 60);
    var s = (sec % 60).toFixed(1);
    if (s < 10) s = '0' + s;
    return m + ':' + s;
  }

  function rpmColor(ratio) {
    if (ratio < 0.6) return '#2ecc40';
    if (ratio < 0.85) return '#ffd000';
    return '#ff4444';
  }

  function tireClass(temp) {
    if (temp < 60) return 'tire cold';
    if (temp < 90) return 'tire ok';
    if (temp < 110) return 'tire warm';
    return 'tire hot';
  }

  function setTire(node, label, temp) {
    var f = window.UNITS && window.UNITS.temp === 'f';
    node.textContent = label + ' ' + Math.round(f ? temp * 9 / 5 + 32 : temp) + '°';
    node.className = tireClass(temp);   // classify on °C (semantic)
  }

  function render(d) {
    if (d.isRaceOn === 0) {
      el.widget.classList.add('waiting');
      el.status.textContent = 'WAITING…';
      return;
    }
    el.widget.classList.remove('waiting');

    el.gear.textContent = d.gear === 0 ? 'R' : String(d.gear);
    var mph = window.UNITS && window.UNITS.speed === 'mph';
    el.speed.textContent = Math.round(mph ? d.speedMph : d.speedKmh);
    if (el.speedUnit) el.speedUnit.textContent = mph ? 'mph' : 'km/h';

    var ratio = d.rpmMax > 0 ? Math.min(d.rpm / d.rpmMax, 1) : 0;
    el.rpm.textContent = Math.round(d.rpm);
    el.rpmBar.style.width = (ratio * 100).toFixed(1) + '%';
    el.rpmBar.style.background = rpmColor(ratio);

    el.throttle.style.width = (Math.min(d.accel / 255, 1) * 100).toFixed(1) + '%';
    el.brake.style.width = (Math.min(d.brake / 255, 1) * 100).toFixed(1) + '%';

    setTire(el.tireFL, 'FL', d.tireTemp.FL);
    setTire(el.tireFR, 'FR', d.tireTemp.FR);
    setTire(el.tireRL, 'RL', d.tireTemp.RL);
    setTire(el.tireRR, 'RR', d.tireTemp.RR);

    el.lap.textContent = d.lapNumber;
    el.currentLap.textContent = fmtLap(d.currentLap);
    el.bestLap.textContent = fmtLap(d.bestLap);
    el.position.textContent = d.racePosition;
  }

  function connect() {
    var ws = new WebSocket('ws://localhost:' + WS_PORT);
    ws.onmessage = function (e) {
      try { render(JSON.parse(e.data)); } catch (err) { /* ignore malformed frame */ }
    };
    ws.onclose = function () { setTimeout(connect, 2000); };
    ws.onerror = function () { ws.close(); };
  }

  connect();
})();
