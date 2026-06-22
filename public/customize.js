// public/customize.js — applies HUD appearance from URL query params.
// Loaded by every widget BEFORE its own <script> so window.UNITS is ready in time.
// Exposes window.__applyCustomize(search) so the Electron overlay can re-apply live
// (no reload/flash) when you tweak settings. OBS uses the params baked into the URL.
// Every field is optional and revertible: an absent param restores the built-in default,
// so the un-customized widget looks exactly as before.
(function () {
  var root = document.documentElement;
  var body = document.body;
  function hex(v) { return v && /^([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(v) ? '#' + v : null; }
  function num(v) { var n = parseFloat(v); return isNaN(n) ? null : n; }

  // load the shared theming stylesheet — auto-applies skins/glass/legibility to every widget.
  // Re-fetchable (cache-busted) so editing skin.css or switching skins shows live without a relaunch.
  var applied = false;
  function loadSkin(bust) {
    var l = document.getElementById('ovl-skin');
    if (!l) { l = document.createElement('link'); l.id = 'ovl-skin'; l.rel = 'stylesheet'; document.head.appendChild(l); }
    l.href = 'skin.css' + (bust ? ('?v=' + Date.now()) : '');
  }
  loadSkin(false);
  window.__reloadSkin = function () { loadSkin(true); };

  function apply(search) {
    var q = new URLSearchParams(search || '');

    // theme/skin: <html data-skin="…"> drives skin.css (absent = classic default)
    var skin = q.get('skin');
    if (skin) root.setAttribute('data-skin', skin); else root.removeAttribute('data-skin');

    // colors → override (or clear) the CSS custom properties widgets already use
    var accent = hex(q.get('accent'));
    ['--amber', '--cyan', '--accent'].forEach(function (k) {
      if (accent) root.style.setProperty(k, accent); else root.style.removeProperty(k);
    });
    var alert = hex(q.get('alert'));
    ['--red', '--alert'].forEach(function (k) {
      if (alert) root.style.setProperty(k, alert); else root.style.removeProperty(k);
    });

    // background card opacity (0/absent = fully transparent)
    var bg = num(q.get('bg'));
    body.style.background = (bg && bg > 0) ? 'rgba(0,0,0,' + Math.min(1, bg) + ')' : '';

    // whole-widget opacity
    var op = num(q.get('op'));
    body.style.opacity = (op == null) ? '' : String(Math.max(0.1, Math.min(1, op)));

    // content scale (Chromium zoom; works in Electron and OBS/CEF)
    var sc = num(q.get('scale'));
    root.style.zoom = (sc && sc > 0) ? String(Math.max(0.4, Math.min(3, sc))) : '';

    // font (loads a Google font on demand; Orbitron/absent = built-in default)
    var font = q.get('font');
    if (font && font !== 'Orbitron') {
      if (font !== 'monospace' && font !== 'Arial' && !document.getElementById('ovl-font-' + font)) {
        var link = document.createElement('link');
        link.id = 'ovl-font-' + font; link.rel = 'stylesheet';
        link.href = 'https://fonts.googleapis.com/css2?family=' + encodeURIComponent(font) + ':wght@500;700&display=swap';
        document.head.appendChild(link);
      }
      body.style.fontFamily = "'" + font + "', 'Orbitron', monospace";
    } else {
      body.style.fontFamily = '';
    }

    // units (read by each widget's render code)
    window.UNITS = {
      speed: q.get('speed') === 'mph' ? 'mph' : 'kmh',
      temp: q.get('temp') === 'f' ? 'f' : 'c',
    };

    // visual style: show the [data-style="<value>"] block, hide the others (default = first)
    var style = q.get('style') || '';
    window.STYLE = style;
    var styled = document.querySelectorAll('[data-style]');
    if (styled.length) {
      var want = style || styled[0].getAttribute('data-style');
      styled.forEach(function (el) { el.style.display = el.getAttribute('data-style') === want ? '' : 'none'; });
    }

    // field toggles: reset all, then hide every [data-field] whose f_<name>=0
    document.querySelectorAll('[data-field]').forEach(function (el) { el.style.display = ''; });
    q.forEach(function (val, key) {
      if (key.indexOf('f_') === 0 && val === '0') {
        document.querySelectorAll('[data-field="' + key.slice(2) + '"]').forEach(function (el) { el.style.display = 'none'; });
      }
    });

    // let a widget react to a live re-apply (e.g. rebuild a unit-dependent gauge while idle)
    if (typeof window.__onCustomize === 'function') window.__onCustomize();

    // on any live re-apply (settings tweak / skin switch), re-fetch skin.css so on-disk
    // edits show immediately. Skipped on first load (the link was just fetched above).
    if (applied) loadSkin(true);
    applied = true;
  }

  window.__applyCustomize = apply;
  apply(location.search);
})();
