/* MADA · Lista de la compra del cliente (L1: plato a plato por día).
   Página estática (GitHub Pages). Lee su lista con GET EXEC_URL?lista=<token> ({ok, data|error}) y envía lo que
   elige con POST no-cors {form:'lista', token, week, submission_id, choices:[{weekday, slot, dish_id}]}.
   Todo texto que viene del endpoint se pinta con textContent / createElement. Funciones puras en window.Lista. */
(function (root) {
  'use strict';

  var WEEKDAYS = ['lun', 'mar', 'mie', 'jue', 'vie', 'sab', 'dom'];
  var DAY_LETTER = { lun: 'L', mar: 'M', mie: 'X', jue: 'J', vie: 'V', sab: 'S', dom: 'D' };
  var DAY_NAME = { lun: 'Lunes', mar: 'Martes', mie: 'Miércoles', jue: 'Jueves', vie: 'Viernes', sab: 'Sábado', dom: 'Domingo' };
  var SLOTS = ['desayuno', 'comida', 'cena'];
  var SLOT_NAME = { desayuno: 'Desayuno', comida: 'Comida', cena: 'Cena' };
  var SPECIAL = { fuera: 'Comer fuera', sobras: 'Sobras' };
  var MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  var TOKEN_RE = /^[A-Za-z0-9_-]{8,64}$/;
  var ID_RE = /^[a-z0-9]{1,24}$/;
  var SEC_RE = /^[a-z0-9_-]{1,40}$/;
  var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  var MAX_CHOICES = 21;

  // ───────────────────────── funciones puras ─────────────────────────

  function key(n) { return String(n).normalize('NFC').toLowerCase().trim(); }

  function plural(label) {
    if (label === 'ud') return 'uds';
    if (/[aeiouáéíóú]$/i.test(label)) return label + 's';
    if (/z$/i.test(label)) return label.slice(0, -1) + 'ces';
    return label + 'es';
  }
  function fmtNum(x) { return String(x).replace('.', ','); }
  /** Cantidad con su unidad: gramos (g/kg) o, si u === 'ml', mililitros (ml/l). */
  function fmtGrams(g, u) {
    var big = u === 'ml' ? ' l' : ' kg', small = u === 'ml' ? ' ml' : ' g';
    if (g >= 1000) return fmtNum(Math.round(g / 100) / 10) + big;
    return Math.round(g) + small;
  }
  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function special(id) { return typeof id === 'string' && has(SPECIAL, id); }

  
  /** Suma lo elegido. choices = {lun: {desayuno: id, comida: id, cena: id}, …}. */
  function sum(payload, choices) {
    var acc = Object.create(null), order = [];
    var slots = (payload && payload.slots) || {};
    WEEKDAYS.forEach(function (day) {
      var dc = (choices && choices[day]) || {};
      SLOTS.forEach(function (slot) {
        var id = dc[slot];
        if (!id || special(id)) return;
        var dish = (slots[slot] || []).filter(function (d) { return d.id === id; })[0];
        if (!dish) return;
        (dish.ings || []).forEach(function (ing) {
          var u = ing.u === 'ml' ? 'ml' : '';
          var k = key(ing.n) + (u ? '|ml' : '');
          if (!acc[k]) { acc[k] = { n: String(ing.n).normalize('NFC'), g: 0, u: u, sec: ing.sec, buy: ing.buy || null }; order.push(k); }
          acc[k].g += ing.g;
          if (!acc[k].buy && ing.buy) acc[k].buy = ing.buy;
        });
      });
    });
    var secs = ((payload && payload.sections) || []).slice();
    var known = Object.create(null); secs.forEach(function (s) { known[s.slug] = true; });
    var hasOther = order.some(function (k) { return !known[acc[k].sec]; });
    if (hasOther) secs.push({ slug: '__otros', label: 'Otros' });
    var out = [];
    secs.forEach(function (s) {
      var items = order.filter(function (k) {
        return s.slug === '__otros' ? !known[acc[k].sec] : acc[k].sec === s.slug;
      }).map(function (k) {
        var a = acc[k], it;
        if (a.buy && a.buy.size_g > 0) {
          var n = Math.max(1, Math.ceil(Math.round((a.g / a.buy.size_g - 0.1) * 1e6) / 1e6));
          var lab = n + ' ' + (n === 1 ? a.buy.label : plural(a.buy.label));
          it = { n: a.n, key: k, g: Math.round(a.g), buy_n: n, buy_label: lab, g_label: fmtGrams(a.g, a.u), u: a.u };
        } else {
          var g = Math.ceil(Math.round(a.g * 1e6) / 1e6 / 10) * 10;
          it = { n: a.n, key: k, g: g, buy_n: null, buy_label: null, g_label: fmtGrams(g, a.u), u: a.u };
        }
        return it;
      }).sort(function (x, y) { return x.n.localeCompare(y.n, 'es'); });
      if (items.length) out.push({ sec: s.slug, label: s.label, items: items });
    });
    return out;
  }

  /** Las tres tomas del día elegidas («Comer fuera» y «Sobras» cuentan). */
  function complete(choices, weekday) {
    var dc = (choices && choices[weekday]) || {};
    return SLOTS.every(function (s) { return typeof dc[s] === 'string' && dc[s] !== ''; });
  }

  function shareText(sections, title) {
    var lines = [];
    if (title) lines.push(title, '');
    sections.forEach(function (s) {
      lines.push(s.label.toUpperCase());
      s.items.forEach(function (it) { lines.push('- ' + it.n + ': ' + (it.buy_label ? it.buy_label : it.g_label)); });
      lines.push('');
    });
    return lines.join('\n').replace(/\s+$/, '') + '\n';
  }

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  /** Lunes de la semana que se planifica: sábado y domingo → la siguiente. */
  function defaultWeek(now) {
    var d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var dow = d.getDay();                       // 0 dom … 6 sáb
    var back = (dow + 6) % 7;                   // días desde el lunes
    d.setDate(d.getDate() - back + (dow === 0 || dow === 6 ? 7 : 0));
    return ymd(d);
  }
  function addDays(week, n) {
    var p = week.split('-'); var d = new Date(+p[0], +p[1] - 1, +p[2]); d.setDate(d.getDate() + n); return ymd(d);
  }
  function weekRange(week) {
    var a = week.split('-'), b = addDays(week, 6).split('-');
    var da = +a[2], db = +b[2], ma = +a[1] - 1, mb = +b[1] - 1;
    return 'Semana del ' + da + (ma === mb ? '' : ' de ' + MONTHS[ma]) + ' al ' + db + ' de ' + MONTHS[mb];
  }

  function str(v, max) { return typeof v === 'string' && v.length > 0 && v.length <= max; }
  /** Valida de forma defensiva el payload; lo que no cumpla se descarta. null si no sirve. */
  function validate(p) {
    if (!p || typeof p !== 'object' || p.v !== 1) return null;
    var secs = [], seen = Object.create(null);
    (Array.isArray(p.sections) ? p.sections : []).slice(0, 30).forEach(function (s) {
      if (s && typeof s.slug === 'string' && SEC_RE.test(s.slug) && str(s.label, 60) && !seen[s.slug]) {
        seen[s.slug] = 1; secs.push({ slug: s.slug, label: s.label });
      }
    });
    var slots = {};
    SLOTS.forEach(function (slot) {
      var ids = Object.create(null);
      slots[slot] = ((p.slots && Array.isArray(p.slots[slot])) ? p.slots[slot] : []).slice(0, 60).filter(function (d) {
        return d && typeof d.id === 'string' && ID_RE.test(d.id) && !special(d.id) && str(d.name, 120) && Array.isArray(d.ings);
      }).map(function (d) {
        var ings = d.ings.slice(0, 80).filter(function (i) {
          return i && str(i.n, 120) && typeof i.g === 'number' && isFinite(i.g) && i.g >= 0 && i.g <= 100000 &&
            typeof i.sec === 'string' && SEC_RE.test(i.sec);
        }).map(function (i) {
          var o = { n: i.n, g: i.g, sec: i.sec };
          if (i.u === 'ml') o.u = 'ml';
          var b = i.buy;
          if (b && typeof b === 'object' && typeof b.size_g === 'number' && isFinite(b.size_g) && b.size_g > 0 && b.size_g <= 100000 && str(b.label, 24)) {
            o.buy = { size_g: b.size_g, label: b.label };
          }
          return o;
        });
        return { id: d.id, name: d.name, ings: ings };
      }).filter(function (d) { if (ids[d.id]) return false; ids[d.id] = 1; return true; });
    });
    return { v: 1, updated: (typeof p.updated === 'string' && DATE_RE.test(p.updated)) ? p.updated : '', slots: slots, sections: secs };
  }

  /** Elecciones guardadas → solo las que existen en el payload (o son fuera/sobras). */
  function cleanChoices(payload, raw) {
    var out = {};
    if (!raw || typeof raw !== 'object') return out;
    WEEKDAYS.forEach(function (day) {
      var dc = has(raw, day) ? raw[day] : null; if (!dc || typeof dc !== 'object') return;
      SLOTS.forEach(function (slot) {
        var id = has(dc, slot) ? dc[slot] : null;
        if (typeof id !== 'string') return;
        var okId = special(id) || payload.slots[slot].some(function (d) { return d.id === id; });
        if (okId) { (out[day] = out[day] || {})[slot] = id; }
      });
    });
    return out;
  }
  function flatten(choices) {
    var out = [];
    WEEKDAYS.forEach(function (day) {
      SLOTS.forEach(function (slot) {
        var id = choices[day] && choices[day][slot];
        if (id) out.push({ weekday: day, slot: slot, dish_id: id });
      });
    });
    return out.slice(0, MAX_CHOICES);
  }
  function submissionId() {
    var A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789', s = '';
    var buf = new Uint8Array(16);
    (root.crypto || {}).getRandomValues(buf);
    for (var i = 0; i < 16; i++) s += A.charAt(buf[i] % A.length);
    return s;
  }

  var Lista = { sum: sum, complete: complete, shareText: shareText, validate: validate, defaultWeek: defaultWeek,
    weekRange: weekRange, plural: plural, flatten: flatten, cleanChoices: cleanChoices, TOKEN_RE: TOKEN_RE };
  root.Lista = Lista;
  if (typeof module !== 'undefined' && module.exports) module.exports = Lista;

  // ───────────────────────── página ─────────────────────────

  var doc = root.document;
  if (!doc || !doc.getElementById('lista-app')) return;

  var app = doc.getElementById('lista-app');
  var token = (new URLSearchParams(root.location.search).get('t') || '').trim();
  var S = { payload: null, offline: false, week: '', defWeek: '', choices: {}, ticks: Object.create(null), view: 'elegir', day: 'lun',
    lastSent: '', openMenu: false, toast: '' };
  var toastTimer = null;

  function store(k, v) { try { if (v === null) root.localStorage.removeItem(k); else root.localStorage.setItem(k, v); } catch (e) {} }
  function load(k) { try { return root.localStorage.getItem(k); } catch (e) { return null; } }
  function pk() { return 'mada_lista:' + token + ':p'; }
  function wk(suffix) { return 'mada_lista:' + token + ':' + S.week + ':' + suffix; }
  function safeTicks(raw) {
    var t = Object.create(null);
    if (raw && typeof raw === 'object') Object.keys(raw).forEach(function (k) { if (raw[k]) t[k] = 1; });
    return t;
  }
  function parse(s) { try { return JSON.parse(s); } catch (e) { return null; } }

  function el(tag, cls, text, attrs) {
    var e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    if (attrs) Object.keys(attrs).forEach(function (a) { e.setAttribute(a, attrs[a]); });
    return e;
  }
  function btn(cls, text, onclick, attrs) {
    var b = el('button', cls, text, attrs); b.type = 'button'; b.addEventListener('click', onclick); return b;
  }
  function clear() { while (app.firstChild) app.removeChild(app.firstChild); }

  function header() {
    var h = el('header', 'head');
    var brand = el('div', 'brand'); brand.appendChild(el('span', 'wordmark', 'mada')); h.appendChild(brand);
    h.appendChild(el('h1', 'title', 'Tu lista de la compra'));
    if (S.payload) {
      var row = el('div', 'weekrow');
      row.appendChild(el('p', 'weektext', Lista.weekRange(S.week)));
      var thisWeek = isWeekend() ? addDays(S.defWeek, -7) : S.defWeek, nextWeek = addDays(thisWeek, 7);
      row.appendChild(btn('mini', S.week === thisWeek ? 'Ver la semana siguiente' : 'Ver esta semana', function () {
        setWeek(S.week === thisWeek ? nextWeek : thisWeek);
      }));
      h.appendChild(row);
      if (S.offline) h.appendChild(el('p', 'note offline', 'Sin conexión: se muestra la última lista guardada.', { role: 'status' }));
    }
    return h;
  }
  function isWeekend() { var d = new Date().getDay(); return d === 0 || d === 6; }

  function message(text, retry) {
    clear();
    app.appendChild(header());
    var box = el('div', 'msg', null, { role: 'alert' });
    box.appendChild(el('p', null, text));
    if (retry) box.appendChild(btn('primary', 'Reintentar', start));
    app.appendChild(box);
  }

  function countDishes() {
    var n = 0;
    flatten(S.choices).forEach(function (c) { if (!special(c.dish_id)) n++; });
    return n;
  }
  function saveChoices() { store(wk('c'), JSON.stringify(S.choices)); }
  function dishName(slot, id) {
    if (special(id)) return SPECIAL[id];
    var d = S.payload.slots[slot].filter(function (x) { return x.id === id; })[0];
    return d ? d.name : '';
  }

  function setWeek(w) {
    S.week = w; S.view = 'elegir';
    S.choices = Lista.cleanChoices(S.payload, parse(load(wk('c'))));
    S.ticks = safeTicks(parse(load(wk('t'))));
    S.lastSent = load(wk('s')) || '';
    S.openMenu = false;
    render();
  }

  function render() {
    clear();
    app.appendChild(header());
    app.appendChild(S.view === 'lista' ? listView() : pickView());
    var live = el('div', 'toast', S.toast, { role: 'status', 'aria-live': 'polite' });
    if (!S.toast) live.hidden = true;
    app.appendChild(live);
  }
  function toast(t) {
    S.toast = t;
    var live = app.querySelector('.toast');
    if (live) { live.textContent = t; live.hidden = false; }
    if (toastTimer) root.clearTimeout(toastTimer);
    toastTimer = root.setTimeout(function () { S.toast = ''; var l = app.querySelector('.toast'); if (l) { l.textContent = ''; l.hidden = true; } }, 2600);
  }

  function pickView() {
    var wrap = el('div', 'pick');
    var tabs = el('div', 'tabs', null, { role: 'group', 'aria-label': 'Día de la semana' });
    WEEKDAYS.forEach(function (day) {
      var done = Lista.complete(S.choices, day);
      var cls = 'tab' + (day === S.day ? ' on' : '') + (done ? ' done' : '');
      var b = btn(cls, DAY_LETTER[day] + (done ? ' ✓' : ''), function () { S.day = day; render(); },
        { 'aria-pressed': day === S.day ? 'true' : 'false', 'aria-label': DAY_NAME[day] + (done ? ', completo' : '') });
      if (day === S.day) b.setAttribute('aria-current', 'true');
      tabs.appendChild(b);
    });
    wrap.appendChild(tabs);
    wrap.appendChild(el('h2', 'dayname', DAY_NAME[S.day]));
    SLOTS.forEach(function (slot) {
      var sec = el('section', 'toma');
      var h = el('h3', null, SLOT_NAME[slot]); h.appendChild(el('span', 'hint', ' · elige una'));
      sec.appendChild(h);
      var cur = (S.choices[S.day] || {})[slot];
      S.payload.slots[slot].forEach(function (d) {
        var b = btn('dish' + (cur === d.id ? ' on' : ''), null, function () { choose(slot, d.id); }, { 'aria-pressed': cur === d.id ? 'true' : 'false' });
        var txt = el('span', 'dtxt');
        txt.appendChild(el('span', 'dname', d.name));
        txt.appendChild(el('span', 'dsub', d.ings.length === 1 ? '1 ingrediente' : d.ings.length + ' ingredientes'));
        b.appendChild(txt); b.appendChild(el('span', 'ck', cur === d.id ? '✓' : ''));
        sec.appendChild(b);
      });
      var sp = el('div', 'specials');
      Object.keys(SPECIAL).forEach(function (id) {
        sp.appendChild(btn('chip' + (cur === id ? ' on' : ''), SPECIAL[id], function () { choose(slot, id); }, { 'aria-pressed': cur === id ? 'true' : 'false' }));
      });
      sec.appendChild(sp);
      wrap.appendChild(sec);
    });
    wrap.appendChild(el('p', 'note', '«Comer fuera» y «Sobras» también valen: esa toma no suma a la lista.'));
    var n = countDishes();
    var bar = el('div', 'bar');
    bar.appendChild(el('span', 'barcount', n === 1 ? '1 plato elegido' : n + ' platos elegidos'));
    var go = btn('barbtn', 'Ver mi lista ›', showList);
    if (!flatten(S.choices).length) { go.disabled = true; }
    bar.appendChild(go);
    wrap.appendChild(bar);
    return wrap;
  }

  function choose(slot, id) {
    var dc = S.choices[S.day] = S.choices[S.day] || {};
    if (dc[slot] === id) delete dc[slot]; else dc[slot] = id;
    if (!Object.keys(dc).length) delete S.choices[S.day];
    saveChoices();
    var y = root.scrollY || 0;
    render();
    if (root.scrollTo) root.scrollTo(0, y);
  }

  function showList() {
    S.view = 'lista';
    send();
    render();
    if (root.scrollTo) root.scrollTo(0, 0);
  }

  function send() {
    var list = flatten(S.choices);
    var canon = JSON.stringify(list);
    if (!list.length || canon === S.lastSent) return;
    var body = { form: 'lista', token: token, week: S.week, submission_id: submissionId(), choices: list };
    S.lastSent = canon;                         // no se reenvía si no cambia; si falla el envío no bloquea la vista
    store(wk('s'), canon);
    try {
      var p = root.fetch(root.EXEC_URL, { method: 'POST', mode: 'no-cors', credentials: 'omit', redirect: 'follow',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) });
      if (p && p.catch) p.catch(function () { S.lastSent = ''; store(wk('s'), null); });
    } catch (e) { S.lastSent = ''; store(wk('s'), null); }
  }

  function listView() {
    var wrap = el('div', 'listview');
    var top = el('div', 'listtop');
    top.appendChild(btn('back', '‹ Elegir platos', function () { S.view = 'elegir'; render(); if (root.scrollTo) root.scrollTo(0, 0); }));
    var n = countDishes();
    top.appendChild(el('p', 'note', (n === 1 ? '1 plato elegido' : n + ' platos elegidos') + ' · cantidades ya sumadas'));
    wrap.appendChild(top);
    var sections = Lista.sum(S.payload, S.choices);
    if (!sections.length) {
      wrap.appendChild(el('p', 'note empty', 'Elige algún plato para ver tu lista.'));
    }
    sections.forEach(function (s) {
      var sec = el('section', 'lsec');
      sec.appendChild(el('h3', null, s.label));
      s.items.forEach(function (it) {
        var ticked = has(S.ticks, it.key);
        var lab = el('label', 'li' + (ticked ? ' tick' : ''));
        var cb = el('input'); cb.type = 'checkbox'; cb.checked = ticked;
        cb.addEventListener('change', function () {
          if (cb.checked) S.ticks[it.key] = 1; else delete S.ticks[it.key];
          lab.className = 'li' + (cb.checked ? ' tick' : '');
          store(wk('t'), JSON.stringify(S.ticks));
        });
        lab.appendChild(cb);
        lab.appendChild(el('span', 'box', null, { 'aria-hidden': 'true' }));
        lab.appendChild(el('span', 'lname', it.n));
        var q = el('span', 'lqty', it.buy_label || it.g_label);
        if (it.buy_label) q.appendChild(el('small', null, it.g_label));
        lab.appendChild(q);
        sec.appendChild(lab);
      });
      wrap.appendChild(sec);
    });
    if (sections.length) {
      wrap.appendChild(btn('primary share', 'Compartir lista', function () { share(sections); }));
    }
    wrap.appendChild(menuBlock());
    return wrap;
  }

  function menuBlock() {
    var det = el('details', 'menu');
    if (S.openMenu) det.open = true;
    det.addEventListener('toggle', function () { S.openMenu = det.open; });
    det.appendChild(el('summary', null, 'Mi menú de la semana'));
    WEEKDAYS.forEach(function (day) {
      var dc = S.choices[day]; if (!dc) return;
      var p = el('div', 'mday');
      p.appendChild(el('h4', null, DAY_NAME[day]));
      var ul = el('ul');
      SLOTS.forEach(function (slot) {
        if (!dc[slot]) return;
        var li = el('li'); li.appendChild(el('b', null, SLOT_NAME[slot] + ': ')); li.appendChild(doc.createTextNode(dishName(slot, dc[slot])));
        ul.appendChild(li);
      });
      p.appendChild(ul); det.appendChild(p);
    });
    return det;
  }

  function share(sections) {
    var text = Lista.shareText(sections, 'Lista de la compra · ' + Lista.weekRange(S.week));
    var nav = root.navigator || {};
    if (typeof nav.share === 'function') {
      Promise.resolve().then(function () { return nav.share({ text: text }); }).catch(function () {});
      return;
    }
    var done = function () { toast('Lista copiada'); };
    if (nav.clipboard && typeof nav.clipboard.writeText === 'function') {
      nav.clipboard.writeText(text).then(done, function () { toast('No se pudo copiar'); });
      return;
    }
    try {
      var ta = el('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'absolute'; ta.style.left = '-9999px';
      doc.body.appendChild(ta); ta.select();
      var okc = doc.execCommand && doc.execCommand('copy'); doc.body.removeChild(ta);
      toast(okc ? 'Lista copiada' : 'No se pudo copiar');
    } catch (e) { toast('No se pudo copiar'); }
  }

  function ready(payload, offline) {
    S.payload = payload; S.offline = offline;
    S.defWeek = Lista.defaultWeek(new Date());
    setWeek(S.defWeek);
  }

  var INVALID = 'Este enlace no es válido o tu lista aún no está preparada. Escríbenos.';
  var FAILED = 'No se ha podido cargar. Vuelve a intentarlo.';

  function fallback() {
    var cached = Lista.validate(parse(load(pk())));
    if (cached) ready(cached, true); else message(FAILED, true);
  }

  function start() {
    if (!TOKEN_RE.test(token)) { message(INVALID); return; }
    clear(); app.appendChild(header()); app.appendChild(el('p', 'note loading', 'Cargando tu lista…', { role: 'status' }));
    var req;
    try { req = root.fetch(root.EXEC_URL + '?lista=' + encodeURIComponent(token), { credentials: 'omit' }); }
    catch (e) { fallback(); return; }
    Promise.resolve(req).then(function (r) { return r.json(); }).then(function (j) {
      if (j && j.ok === true) {
        var p = Lista.validate(j.data);
        if (!p) { fallback(); return; }
        store(pk(), JSON.stringify(p));
        ready(p, false);
      } else if (j && (j.error === 'token' || j.error === 'sin_lista')) {
        store(pk(), null); message(INVALID);
      } else { fallback(); }               // rate u otra cosa
    }).catch(fallback);
  }

  start();
})(typeof window !== 'undefined' ? window : globalThis);
