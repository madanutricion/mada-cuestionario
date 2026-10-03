/* MADA · motor común de los formularios públicos (cuestionario inicial y semanal).
   Página estática (GitHub Pages) → POST no-cors al doPost del Apps Script.
   Uso: MadaForm.mount({ root, brand, steps, draftKey, execUrl, base, numeric,
                         validateStep, transform, success, preview }).
   preview: true = vista previa para el nutricionista (se recorre entero y no envía nada).
   Sin dependencias. Tipos de campo: text, email, tel, number, date, textarea, meal,
   select, chips, checks, grid, slider, weights, sport_totals, sessions, rows, consent. */
(function (global) {
  'use strict';

  function esc(s) {
    return (s == null ? '' : String(s)).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function pad(n) { return String(n).padStart(2, '0'); }
  function localISO(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' +
           pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  }
  function num(v) {
    if (v == null || String(v).trim() === '') return null;
    var n = +String(v).replace(',', '.');
    return isNaN(n) ? null : n;
  }

  // Deportes: mismas claves que mada-app/app/training.py (SPORTS).
  // km = pide kilómetros en los totales semanales; dist = pide km y desnivel por sesión.
  var SPORTS = [
    { key: 'running', label: 'Carrera', km: true, dist: true, types: [['rodaje_suave', 'Rodaje suave'], ['rodaje', 'Rodaje'], ['series', 'Series / intervalos'], ['tirada_larga', 'Tirada larga'], ['trail', 'Trail / montaña'], ['competicion', 'Competición']] },
    { key: 'cycling', label: 'Bici', km: true, dist: true, types: [['salida_suave', 'Salida suave'], ['salida_larga', 'Salida larga'], ['series', 'Series / intervalos'], ['rodillo', 'Rodillo']] },
    { key: 'swimming', label: 'Natación', km: true, dist: false, types: [['tecnica', 'Técnica'], ['series', 'Series'], ['nado_largo', 'Nado largo']] },
    { key: 'gym', label: 'Gimnasio / fuerza', km: false, dist: false, types: [['fuerza', 'Fuerza'], ['hipertrofia', 'Hipertrofia'], ['circuito', 'Circuito']] },
    { key: 'crossfit', label: 'CrossFit / HIIT', km: false, dist: false, types: [['wod', 'WOD'], ['open_gym', 'Open gym']] },
    { key: 'team', label: 'Deporte de equipo', km: false, dist: false, types: [['entreno', 'Entreno'], ['partido', 'Partido']] },
    { key: 'other', label: 'Otro', km: true, dist: false, types: [] }
  ];
  var INTENSITIES = [['baja', 'Suave'], ['media', 'Media'], ['alta', 'Intensa']];
  var WEEKDAYS = [['lun', 'L'], ['mar', 'M'], ['mie', 'X'], ['jue', 'J'], ['vie', 'V'], ['sab', 'S'], ['dom', 'D']];
  var TIMES = [['ayunas', 'En ayunas, al levantarme'], ['manana', 'Mañana'], ['mediodia', 'Mediodía'], ['tarde', 'Tarde'], ['noche', 'Noche']];
  var MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  var DAY_NAMES = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
  var DAY_KEYS = ['peso_lunes', 'peso_martes', 'peso_miercoles', 'peso_jueves', 'peso_viernes', 'peso_sabado', 'peso_domingo'];
  var TOTAL_FIELDS = ['sessions', 'hours', 'km', 'rpe', 'hr'];
  var INPUT_TYPES = ['text', 'email', 'tel', 'number', 'date', 'textarea', 'meal', 'select'];
  var WORDMARK = '<span class="wordmark">mada<sup>©</sup></span>';
  // Escala de Bristol: [valor, etiqueta, descripción, dibujo de ICONS]. La usan el inicial digestivo y su semanal.
  var BRISTOL = [
    ['Tipo 1', 'Tipo 1', 'Bolitas duras y separadas, cuesta expulsarlas', 'b1'],
    ['Tipo 2', 'Tipo 2', 'Alargada, pero formada por bultos', 'b2'],
    ['Tipo 3', 'Tipo 3', 'Alargada, con grietas en la superficie', 'b3'],
    ['Tipo 4', 'Tipo 4', 'Alargada, lisa y blanda', 'b4'],
    ['Tipo 5', 'Tipo 5', 'Trozos blandos con los bordes definidos', 'b5'],
    ['Tipo 6', 'Tipo 6', 'Trozos pastosos con los bordes irregulares', 'b6'],
    ['Tipo 7', 'Tipo 7', 'Líquida, sin trozos sólidos', 'b7']
  ];

  function sportOf(key) { for (var i = 0; i < SPORTS.length; i++) if (SPORTS[i].key === key) return SPORTS[i]; return null; }
  function typeLabel(sportKey, typeKey) {
    var sp = sportOf(sportKey); if (!sp) return '';
    for (var i = 0; i < sp.types.length; i++) if (sp.types[i][0] === typeKey) return sp.types[i][1];
    return '';
  }

  function mount(cfg) {
    var root = typeof cfg.root === 'string' ? document.querySelector(cfg.root) : cfg.root;
    var steps = cfg.steps, fields = [], byId = {};
    steps.forEach(function (s) { s.fields.forEach(function (f) { fields.push(f); byId[f.id] = f; }); });
    function freshState() { return { chips: {}, checks: {}, grid: {}, sliders: {}, sessions: [], rows: {}, totals: {}, consent: {} }; }
    var st = freshState();
    var current = 0, seq = 0;

    // ── API que reciben showIf, validateStep y transform ──
    var api = {
      chip: function (id) { return st.chips[id] || ''; },
      checks: function (id) { return (st.checks[id] || []).slice(); },
      value: function (id) { var el = document.getElementById(id); return el ? el.value.trim() : ''; },
      slider: function (id) { return st.sliders[id] == null ? null : st.sliders[id]; },
      sessions: function () { return st.sessions; },
      consent: function (id) { return !!st.consent[id]; }
    };

    function visible(f) {
      if (!f.showIf) return true;
      if (typeof f.showIf === 'function') return !!f.showIf(api);
      var k = Object.keys(f.showIf)[0];
      return st.chips[k] === f.showIf[k];
    }

    // ── HTML de cada campo ──
    // Dibujos de la escala de Bristol (formas abstractas, color del texto)
    function svg(body) { return '<svg viewBox="0 0 64 24" aria-hidden="true" focusable="false">' + body + '</svg>'; }
    function dots(list, o) { return list.map(function (c) { return '<circle cx="' + c[0] + '" cy="' + c[1] + '" r="' + c[2] + '" fill="currentColor"' + (o ? ' opacity="' + o + '"' : '') + '/>'; }).join(''); }
    var ICONS = {
      b1: svg(dots([[8, 13, 4.2], [20, 8, 4.2], [31, 15, 4.2], [43, 9, 4.2], [55, 14, 4.2]])),
      b2: svg(dots([[13, 12, 6.6], [22, 13, 6.6], [31, 11, 6.6], [40, 13, 6.6], [50, 12, 6.6]])),
      // las grietas se recortan con una máscara: quedan transparentes sobre cualquier fondo (también el del chip marcado)
      b3: svg('<mask id="mada-b3"><rect width="64" height="24" fill="#fff"/><path d="M16 5.5l2.2 4M27 5.5l-1.6 3.4M37 5.5l2.2 4M48 5.5l-1.6 3.4M22 18.5l1.6-3.2M43 18.5l-1.6-3.2" stroke="#000" stroke-width="1.3" stroke-linecap="round" fill="none"/></mask>' +
              '<rect x="6" y="6" width="52" height="12" rx="6" fill="currentColor" mask="url(#mada-b3)"/>'),
      b4: svg('<path d="M9 15C21 6 41 19 55 9" stroke="currentColor" stroke-width="9" stroke-linecap="round" fill="none"/>'),
      b5: svg('<ellipse cx="13" cy="13" rx="7.5" ry="5.2" fill="currentColor"/><ellipse cx="32" cy="10" rx="7.5" ry="5.2" fill="currentColor"/><ellipse cx="51" cy="13" rx="7.5" ry="5.2" fill="currentColor"/>'),
      b6: svg(dots([[10, 13, 5], [15, 9.5, 3.8], [17, 15.5, 3.4], [6.5, 8.5, 2.4], [31, 11, 5], [36.5, 14.5, 4.2], [27.5, 15.5, 3], [38, 8.5, 2.4], [51, 12, 5], [56.5, 15.5, 3.4], [46.5, 15.5, 3], [55.5, 7.5, 2.4]], 0.72)),
      b7: svg('<path d="M5 15C5 9 16 11 22 8C30 4 38 9 44 7C52 5 61 10 59 15C58 20 46 19 38 20C27 21 6 21 5 15Z" fill="currentColor" opacity="0.5"/>')
    };

    // Opción = 'texto' | [valor, etiqueta] | [valor, etiqueta, subtítulo, dibujo]. `f.layout`: 'rows' (una fila por
    // opción, con dibujo de ICONS) o 'grid3' (rejilla de tres columnas con cabecera `f.head`; la opción `f.none` va a lo ancho).
    function chipsHTML(attr, id, opts, selected, f) {
      var layout = f && f.layout ? f.layout : '';
      var head = layout === 'grid3' && f.head ? '<div class="chips-head">' + f.head.map(function (h) { return '<span>' + esc(h) + '</span>'; }).join('') + '</div>' : '';
      return head + '<div class="chips' + (layout ? ' is-' + layout : '') + '" ' + attr + '="' + esc(id) + '">' + opts.map(function (o) {
        var arr = Array.isArray(o), v = arr ? o[0] : o, l = arr ? o[1] : o, sub = arr ? o[2] : '', ico = arr ? ICONS[o[3]] : '';
        var on = Array.isArray(selected) ? selected.indexOf(v) >= 0 : selected === v;
        var inner = !layout ? esc(l) :
          (ico ? '<span class="chip-ico">' + ico + '</span>' : '') +
          '<span class="chip-text"><span class="chip-main">' + esc(l) + '</span>' + (sub ? '<span class="chip-sub">' + esc(sub) + '</span>' : '') + '</span>';
        var wide = layout === 'grid3' && f.none === v ? ' is-wide' : '';
        return '<button type="button" class="chip' + (on ? ' sel' : '') + wide + '" data-val="' + esc(v) + '">' + inner + '</button>';
      }).join('') + '</div>';
    }

    function fieldHTML(f) {
      var lab = f.label ? '<label class="field-label"' + (INPUT_TYPES.indexOf(f.type) >= 0 ? ' for="' + esc(f.id) + '"' : '') + '>' + esc(f.label) +
        (f.req ? ' <span class="req">*</span>' : (f.opt ? ' <span class="optional">· opcional</span>' : '')) + '</label>' : '';
      var hint = f.hint ? '<div class="field-hint">' + esc(f.hint) + '</div>' : '';
      var body = '', t = f.type;
      if (t === 'text' || t === 'email' || t === 'tel') {
        body = '<input type="' + t + '" id="' + f.id + '"' + (f.ac ? ' autocomplete="' + f.ac + '"' : '') +
          (t === 'email' ? ' inputmode="email"' : (t === 'tel' ? ' inputmode="tel"' : '')) + ' placeholder="' + esc(f.ph || '') + '">';
      } else if (t === 'date') {
        body = '<input type="date" id="' + f.id + '">';
      } else if (t === 'number') {
        body = '<div class="with-unit"><input type="number" id="' + f.id + '" inputmode="' + (f.int ? 'numeric' : 'decimal') + '"' +
          (f.min != null ? ' min="' + f.min + '"' : '') + (f.max != null ? ' max="' + f.max + '"' : '') + (f.step != null ? ' step="' + f.step + '"' : '') +
          ' placeholder="' + esc(f.ph || '') + '">' + (f.unit ? '<span class="unit">' + esc(f.unit) + '</span>' : '') + '</div>';
      } else if (t === 'textarea' || t === 'meal') {
        body = '<textarea id="' + f.id + '"' + (t === 'meal' ? ' class="is-short"' : '') + ' placeholder="' + esc(f.ph || (t === 'meal' ? '—' : '')) + '"></textarea>';
      } else if (t === 'select') {
        var o = '<option value="">—</option>';
        for (var n = f.min; n <= f.max; n++) o += '<option value="' + n + '">' + n + (n === f.max ? '+' : '') + '</option>';
        body = '<select id="' + f.id + '">' + o + '</select>';
      } else if (t === 'chips') {
        body = chipsHTML('data-chip', f.id, f.opts, st.chips[f.id], f);
      } else if (t === 'checks') {
        body = chipsHTML('data-checks', f.id, f.opts, st.checks[f.id] || [], f);
      } else if (t === 'grid') {
        body = '<div class="grid-legend">' + f.levels.map(function (l) { return l[1] + ' ' + l[2]; }).join(' · ') + '</div>' +
          f.foods.map(function (food) {
            return '<div class="grid-row"><div class="grid-name">' + esc(food) + '</div><div class="grid-opts">' +
              f.levels.map(function (l) { return '<button type="button" class="grid-dot' + (st.grid[food] === l[0] ? ' sel' : '') + '" data-food="' + esc(food) + '" data-lvl="' + l[0] + '" title="' + esc(l[2]) + '">' + l[1] + '</button>'; }).join('') +
              '</div></div>';
          }).join('');
      } else if (t === 'slider') {
        return '<div class="card slider-block" data-fid="' + f.id + '"><div class="slider-head"><label class="field-label" style="margin-bottom:0" for="' + f.id + '">' + esc(f.label) +
          '</label><span class="slider-value unset" id="' + f.id + '-val">toca para valorar</span></div>' +
          '<input type="range" min="0" max="10" step="1" value="5" id="' + f.id + '" data-set="0">' +
          '<div class="slider-ends"><span>' + esc(f.minLabel) + '</span><span>' + esc(f.maxLabel) + '</span></div></div>';
      } else if (t === 'weights') {
        var ws = new Date(f.weekStart + 'T12:00:00');
        body = DAY_NAMES.map(function (d, i) {
          var dt = new Date(ws); dt.setDate(ws.getDate() + i);
          return '<div class="weight-row"><div class="weight-day"><div class="d">' + d + '</div><div class="f">' + dt.getDate() + ' ' + MONTHS[dt.getMonth()] + '</div></div>' +
            '<input type="number" inputmode="decimal" step="0.05" min="30" max="250" id="' + DAY_KEYS[i] + '" placeholder="—"><span class="kg">kg</span></div>';
        }).join('');
      } else if (t === 'sport_totals') {
        body = '<div class="chips sport-chips">' + SPORTS.map(function (sp) {
          return '<button type="button" class="chip sport-chip" data-sport="' + sp.key + '">' + esc(sp.label) + '</button>';
        }).join('') + '</div><div id="sport-rows">' + SPORTS.map(function (sp) {
          function cell(fld, label, attrs, off) {
            return '<div class="cell' + (off ? ' off' : '') + '"><input type="number" ' + attrs + ' id="tr_' + sp.key + '_' + fld + '" placeholder="—"' + (off ? ' disabled' : '') + '><label>' + label + '</label></div>';
          }
          return '<div class="sport-row" id="sport-row-' + sp.key + '"><div class="name">' + esc(sp.label) + '</div><div class="sport-grid">' +
            cell('sessions', 'sesiones', 'inputmode="numeric" min="0" max="14" step="1"') +
            cell('hours', 'horas', 'inputmode="decimal" min="0" max="60" step="0.5"') +
            cell('km', 'km', 'inputmode="decimal" min="0" max="2000" step="0.1"', !sp.km) +
            cell('rpe', 'esfuerzo 0-10', 'inputmode="numeric" min="0" max="10" step="1"') +
            cell('hr', 'FC media', 'inputmode="numeric" min="30" max="240" step="1"') + '</div></div>';
        }).join('') + '</div>';
      } else if (t === 'sessions') {
        body = '<div class="sessions" id="' + f.id + '-box"></div><button type="button" class="btn-add" data-s-add="' + f.id + '">+ Añadir sesión</button>' +
          (f.note ? '<div class="field-hint" style="margin-top:12px;margin-bottom:0">' + esc(f.note) + '</div>' : '');
      } else if (t === 'rows') {
        body = '<div class="rows" id="' + f.id + '-box"></div><button type="button" class="btn-add" data-r-add="' + f.id + '">' + esc(f.addLabel || '+ Añadir') + '</button>';
      } else if (t === 'consent') {
        body = '<label class="consent"><input type="checkbox" id="' + f.id + '"><span>' + esc(f.text) + '</span></label>' +
          (f.legal ? '<details class="legal"><summary>Leer la información de protección de datos</summary><p>' + esc(f.legal) + '</p></details>' : '');
      }
      var inner = t === 'meal' ? '<div class="meal-label">' + esc(f.label) + '</div>' + hint + body : lab + hint + body;
      return '<div class="card" data-fid="' + f.id + '">' + inner + '</div>';
    }

    // ── Bloque de sesiones (cuestionario inicial) ──
    function newSession(sport) {
      seq += 1;
      return { id: 's' + seq, sport: sport || '', type: '', name: '', times_per_week: 1, duration_min: '', intensity: '',
               weekdays: [], time_of_day: '', distance_km: '', elevation_m: '', avg_hr: '', avg_power_w: '' };
    }
    function sessionHTML(f, s, i) {
      var sp = sportOf(s.sport);
      var typeOpts = sp ? sp.types.concat([['otro', 'Otro']]) : [];
      function mini(attr, opts, sel, multi, cls) {
        return '<div class="chips is-mini' + (cls ? ' ' + cls : '') + '">' + opts.map(function (o) {
          var on = multi ? sel.indexOf(o[0]) >= 0 : sel === o[0];
          return '<button type="button" class="chip' + (on ? ' sel' : '') + '" ' + attr + '="' + o[0] + '">' + esc(o[1]) + '</button>';
        }).join('') + '</div>';
      }
      function input(key, label, attrs) {
        return '<div><label class="mini-label">' + label + '</label><input type="number" ' + attrs + ' data-s-field="' + key + '" value="' + esc(s[key]) + '" placeholder="—"></div>';
      }
      var h = '<div class="session" data-sid="' + s.id + '"><div class="session-head"><span>Sesión ' + (i + 1) + '</span>' +
        '<button type="button" class="link-btn" data-s-remove="1" aria-label="Quitar la sesión ' + (i + 1) + '">Quitar</button></div>' +
        '<label class="mini-label">Deporte</label>' + mini('data-s-sport', SPORTS.map(function (x) { return [x.key, x.label]; }), s.sport);
      if (!sp) return h + '</div>';
      if (typeOpts.length > 1) h += '<label class="mini-label">Tipo de sesión</label>' + mini('data-s-type', typeOpts, s.type);
      if (s.type === 'otro' || typeOpts.length <= 1) {
        h += '<label class="mini-label">Nombre de la sesión</label><input type="text" data-s-field="name" value="' + esc(s.name) + '" placeholder="' + (s.sport === 'other' ? 'Ej. Brick bici + carrera, pádel…' : 'Ej. Cuestas, técnica…') + '">';
      }
      h += '<div class="pair"><div><label class="mini-label">Veces por semana</label><div class="stepper">' +
        '<button type="button" data-s-step="-1" aria-label="Menos">−</button><span class="stepper-val">' + s.times_per_week + '</span>' +
        '<button type="button" data-s-step="1" aria-label="Más">+</button></div></div>' +
        input('duration_min', 'Duración (min)', 'inputmode="numeric" min="5" max="1440" step="5"') + '</div>' +
        '<label class="mini-label">Intensidad</label>' + mini('data-s-int', INTENSITIES, s.intensity) +
        '<label class="mini-label">Días <span class="optional">· opcional</span></label>' + mini('data-s-day', WEEKDAYS, s.weekdays, true, 'is-days') +
        '<label class="mini-label">¿Cuándo sueles hacerla?</label>' + mini('data-s-tod', TIMES, s.time_of_day);
      var extra = '';
      if (sp.dist) extra += input('distance_km', 'Km de la sesión', 'inputmode="decimal" min="0" max="1000" step="0.5"') + input('elevation_m', 'Desnivel + de la sesión (m)', 'inputmode="numeric" min="0" max="20000" step="10"');
      if (f.hr ? f.hr(api) : true) extra += input('avg_hr', 'FC media (ppm)', 'inputmode="numeric" min="30" max="240" step="1"');
      if (s.sport === 'cycling' && (f.power ? f.power(api) : false)) extra += input('avg_power_w', 'Vatios medios', 'inputmode="numeric" min="0" max="2000" step="5"');
      if (extra) h += '<label class="mini-label">Si lo sabes <span class="optional">· opcional</span></label><div class="pair is-wrap">' + extra + '</div>';
      return h + '</div>';
    }
    function renderSessions() {
      fields.forEach(function (f) {
        if (f.type !== 'sessions') return;
        var box = document.getElementById(f.id + '-box'); if (!box) return;
        box.innerHTML = st.sessions.map(function (s, i) { return sessionHTML(f, s, i); }).join('') ||
          '<div class="optional">' + esc(f.empty || 'Añade una sesión por cada tipo de entreno que hagas.') + '</div>';
      });
    }
    function cleanSessions() {
      return st.sessions.map(function (s) {
        var sp = sportOf(s.sport); if (!sp) return null;
        var name = (s.type && s.type !== 'otro' ? typeLabel(s.sport, s.type) : String(s.name || '').trim()) || sp.label;
        var o = { id: s.id, sport: s.sport, type: s.type && s.type !== 'otro' ? s.type : 'libre', name: name,
                  times_per_week: s.times_per_week || null, duration_min: num(s.duration_min), intensity: s.intensity || null,
                  weekdays: WEEKDAYS.map(function (d) { return d[0]; }).filter(function (d) { return s.weekdays.indexOf(d) >= 0; }),
                  time_of_day: s.time_of_day || null,
                  distance_km: sp.dist ? num(s.distance_km) : null, elevation_m: sp.dist ? num(s.elevation_m) : null,
                  avg_hr: num(s.avg_hr), avg_power_w: s.sport === 'cycling' ? num(s.avg_power_w) : null };
        return o;      // toda ficha con deporte viaja; las que no tienen deporte (recién añadidas) no
      }).filter(Boolean);
    }

    // ── Filas repetibles (competiciones, medicación…) ──
    function rowHTML(f, r, i) {
      return '<div class="row-item" data-rid="' + i + '">' + f.columns.map(function (c) {
        var v = r[c.key] || '';
        if (c.type === 'chips') {
          return '<div class="is-full"><label class="mini-label">' + esc(c.label) + '</label><div class="chips is-mini">' + c.opts.map(function (o) {
            return '<button type="button" class="chip' + (v === o ? ' sel' : '') + '" data-r-col="' + c.key + '" data-val="' + esc(o) + '">' + esc(o) + '</button>';
          }).join('') + '</div></div>';
        }
        return '<div' + (c.full ? ' class="is-full"' : '') + '><label class="mini-label">' + esc(c.label) + '</label><input type="' + (c.type || 'text') + '" data-r-col="' + c.key + '" value="' + esc(v) + '" placeholder="' + esc(c.ph || '') + '"></div>';
      }).join('') + '<button type="button" class="link-btn is-full" data-r-remove="1">Quitar</button></div>';
    }
    function renderRows(id) {
      var f = byId[id], box = document.getElementById(id + '-box'); if (!box) return;
      box.innerHTML = (st.rows[id] || []).map(function (r, i) { return rowHTML(f, r, i); }).join('');
    }

    // ── Esqueleto ──
    root.innerHTML =
      '<div id="form-area">' + (cfg.preview ? '<div class="preview-flag">Vista previa · no se envía nada</div>' : '') +
      '<div class="head-rule"><div class="brand">' + WORDMARK + '<span class="kicker">' + esc(cfg.brand.kicker) + '</span></div>' +
      '<h1 class="greeting" id="greeting">' + esc(cfg.brand.greeting) + '</h1><div class="week-meta" id="week-label">' + esc(cfg.brand.meta || '') + '</div></div>' +
      '<div class="progress-row"><span class="step-label" id="step-name"></span><span class="step-count" id="step-count"></span></div>' +
      '<div class="progress-track"><div class="progress-fill" id="progress"></div></div>' +
      '<div class="error-banner" id="error-banner" role="alert"></div><div id="steps">' +
      steps.map(function (s, i) {
        return '<section class="step' + (i === 0 ? ' active' : '') + '" data-name="' + esc(s.name) + '"><h2 class="step-title">' + esc(s.title) + '</h2>' +
          '<div class="step-desc">' + esc(s.desc || '') + '</div>' + s.fields.map(fieldHTML).join('') + '</section>';
      }).join('') + '</div></div>' +
      '<div class="success" id="success"><div class="check-ring"><svg viewBox="0 0 24 24"><path d="M4 12.5l5 5L20 6.5"/></svg></div>' +
      '<h2 id="success-title">' + esc(cfg.success.title) + '</h2><p>' + esc(cfg.success.text) + '</p></div>' +
      '<div class="nav" id="nav"><div class="nav-inner"><button type="button" class="btn btn-back" id="btn-back" style="visibility:hidden">Atrás</button>' +
      '<button type="button" class="btn btn-next" id="btn-next">Continuar</button></div></div>';

    var stepEls = Array.prototype.slice.call(root.querySelectorAll('.step'));
    var btnNext = document.getElementById('btn-next'), btnBack = document.getElementById('btn-back');
    var banner = document.getElementById('error-banner');

    function applyShowIf() {
      fields.forEach(function (f) {
        if (!f.showIf) return;
        var card = root.querySelector('[data-fid="' + f.id + '"]');
        if (card) card.style.display = visible(f) ? '' : 'none';
      });
    }
    function paintSlider(f) {
      var input = document.getElementById(f.id), val = document.getElementById(f.id + '-val');
      if (!input || st.sliders[f.id] == null) return;
      var v = +st.sliders[f.id];
      input.value = v; input.dataset.set = '1';
      input.style.setProperty('--fill', (v * 10) + '%');
      var e = f.emojis ? f.emojis[Math.min(f.emojis.length - 1, Math.floor(v / (10.01 / f.emojis.length)))] : '';
      val.innerHTML = (e ? '<span class="slider-emoji">' + e + '</span>' : '') + v;
      val.classList.remove('unset');
    }
    function toggleTotals(key, on) {
      var chip = root.querySelector('.sport-chip[data-sport="' + key + '"]'), row = document.getElementById('sport-row-' + key);
      if (!chip || !row) return;
      chip.classList.toggle('sel', on); row.classList.toggle('on', on); st.totals[key] = on;
      if (!on) TOTAL_FIELDS.forEach(function (fl) { var el = document.getElementById('tr_' + key + '_' + fl); if (el) el.value = ''; });
    }

    // ── Borrador ──
    function inputIds() {
      var ids = [];
      fields.forEach(function (f) {
        if (INPUT_TYPES.indexOf(f.type) >= 0) ids.push(f.id);
        else if (f.type === 'weights') ids = ids.concat(DAY_KEYS);
        else if (f.type === 'sport_totals') SPORTS.forEach(function (sp) { TOTAL_FIELDS.forEach(function (fl) { ids.push('tr_' + sp.key + '_' + fl); }); });
      });
      return ids;
    }
    function saveDraft() {
      if (cfg.preview) return;
      try {
        var d = { _st: st, _seq: seq };
        inputIds().forEach(function (id) { var el = document.getElementById(id); if (el && el.value !== '') d[id] = el.value; });
        localStorage.setItem(cfg.draftKey, JSON.stringify(d));
      } catch (e) {}
    }
    function loadDraft() {
      var d = {}, raw = null;
      try {
        raw = localStorage.getItem(cfg.draftKey);
        if (raw == null && cfg.legacyDraftKey) raw = localStorage.getItem(cfg.legacyDraftKey);   // borrador de la página anterior
        d = JSON.parse(raw || '{}') || {};
      } catch (e) { d = {}; }
      if (typeof d !== 'object' || Array.isArray(d)) d = {};
      // Un borrador dañado o de otra versión no puede romper el formulario: solo se acepta lo que tiene la forma esperada
      if (d._st && typeof d._st === 'object') {
        Object.keys(st).forEach(function (k) {
          var v = d._st[k];
          if (v != null && typeof v === 'object' && Array.isArray(v) === Array.isArray(st[k])) st[k] = v;
        });
      } else {
        // Formato anterior al motor común (sin _st): sliders como id → valor, deportes por sus casillas tr_*,
        // y _chips / _checks / _grid del cuestionario inicial v2. Así un borrador a medias no pierde nada.
        fields.forEach(function (f) {
          if (f.type !== 'slider' || d[f.id] == null || d[f.id] === '') return;
          var n = +d[f.id]; if (n >= 0 && n <= 10) st.sliders[f.id] = n;
        });
        SPORTS.forEach(function (sp) {
          if (TOTAL_FIELDS.some(function (fl) { var x = d['tr_' + sp.key + '_' + fl]; return x != null && x !== ''; })) st.totals[sp.key] = true;
        });
        ['chips', 'checks', 'grid'].forEach(function (k) {
          var v = d['_' + k]; if (v && typeof v === 'object' && !Array.isArray(v)) st[k] = v;
        });
        if (cfg.migrateDraft) cfg.migrateDraft(d, ctl);
      }
      // Segundo nivel: cada valor con el tipo que el pintado espera
      Object.keys(st.chips).forEach(function (k) { if (typeof st.chips[k] !== 'string') delete st.chips[k]; });
      Object.keys(st.checks).forEach(function (k) { if (!Array.isArray(st.checks[k])) delete st.checks[k]; });
      Object.keys(st.rows).forEach(function (k) {
        if (!Array.isArray(st.rows[k])) delete st.rows[k];
        else st.rows[k] = st.rows[k].filter(function (r) { return r && typeof r === 'object'; });
      });
      st.sessions = st.sessions.filter(function (s) { return s && typeof s === 'object' && Array.isArray(s.weekdays); });
      seq = +d._seq || st.sessions.length;
      inputIds().forEach(function (id) { if (d[id] != null) { var el = document.getElementById(id); if (el) el.value = d[id]; } });
    }
    function paintState() {
      Object.keys(st.chips).forEach(function (k) {
        if (!byId[k]) return;
        var g = root.querySelector('[data-chip="' + k + '"]');
        if (g) g.querySelectorAll('.chip').forEach(function (c) { c.classList.toggle('sel', c.dataset.val === st.chips[k]); });
      });
      Object.keys(st.checks).forEach(function (k) {
        if (!byId[k]) return;
        var g = root.querySelector('[data-checks="' + k + '"]');
        if (g) g.querySelectorAll('.chip').forEach(function (c) { c.classList.toggle('sel', st.checks[k].indexOf(c.dataset.val) >= 0); });
      });
      root.querySelectorAll('.grid-dot').forEach(function (dot) { dot.classList.toggle('sel', st.grid[dot.dataset.food] === dot.dataset.lvl); });
      fields.forEach(function (f) {
        if (f.type === 'slider') paintSlider(f);
        else if (f.type === 'rows') renderRows(f.id);
        else if (f.type === 'consent') { var el = document.getElementById(f.id); if (el) el.checked = !!st.consent[f.id]; }
      });
      Object.keys(st.totals).forEach(function (k) { if (st.totals[k]) toggleTotals(k, true); });
      renderSessions(); applyShowIf();
    }

    // ── Interacciones (delegadas) ──
    function changed(id) {
      if (cfg.onChange) cfg.onChange(id, api, ctl);
      renderSessions(); applyShowIf(); saveDraft();
    }
    root.addEventListener('click', function (e) {
      var t = e.target, b;
      if ((b = t.closest('[data-chip] .chip'))) {
        var k = b.parentElement.dataset.chip, was = b.classList.contains('sel');
        b.parentElement.querySelectorAll('.chip').forEach(function (c) { c.classList.remove('sel'); });
        if (!was) { b.classList.add('sel'); st.chips[k] = b.dataset.val; } else { st.chips[k] = ''; }
        return changed(k);
      }
      if ((b = t.closest('[data-checks] .chip'))) {
        var g = b.parentElement, key = g.dataset.checks, f = byId[key];
        b.classList.toggle('sel');
        if (f.none && b.classList.contains('sel')) {          // «Ninguna» excluye al resto y viceversa
          g.querySelectorAll('.chip').forEach(function (c) { if ((c.dataset.val === f.none) !== (b.dataset.val === f.none)) c.classList.remove('sel'); });
        }
        st.checks[key] = Array.prototype.map.call(g.querySelectorAll('.chip.sel'), function (c) { return c.dataset.val; });
        return changed(key);
      }
      if ((b = t.closest('.grid-dot'))) {
        var food = b.dataset.food, already = b.classList.contains('sel');
        b.parentElement.querySelectorAll('.grid-dot').forEach(function (x) { x.classList.remove('sel'); });
        if (!already) { b.classList.add('sel'); st.grid[food] = b.dataset.lvl; } else { delete st.grid[food]; }
        return saveDraft();
      }
      if ((b = t.closest('.sport-chip'))) {
        toggleTotals(b.dataset.sport, !b.classList.contains('sel'));
        if (st.totals[b.dataset.sport]) { var first = document.getElementById('tr_' + b.dataset.sport + '_sessions'); if (first) first.focus(); }
        return saveDraft();
      }
      if ((b = t.closest('[data-s-add]'))) { st.sessions.push(newSession('')); renderSessions(); return saveDraft(); }
      var card = t.closest('.session');
      if (card) {
        var s = null; st.sessions.forEach(function (x) { if (x.id === card.dataset.sid) s = x; });
        if (!s) return;
        if (t.closest('[data-s-remove]')) st.sessions = st.sessions.filter(function (x) { return x !== s; });
        else if ((b = t.closest('[data-s-sport]'))) { if (s.sport !== b.dataset.sSport) { s.sport = b.dataset.sSport; s.type = ''; } }
        else if ((b = t.closest('[data-s-type]'))) s.type = s.type === b.dataset.sType ? '' : b.dataset.sType;
        else if ((b = t.closest('[data-s-int]'))) s.intensity = s.intensity === b.dataset.sInt ? '' : b.dataset.sInt;
        else if ((b = t.closest('[data-s-tod]'))) s.time_of_day = s.time_of_day === b.dataset.sTod ? '' : b.dataset.sTod;
        else if ((b = t.closest('[data-s-day]'))) { var d = b.dataset.sDay, ix = s.weekdays.indexOf(d); if (ix >= 0) s.weekdays.splice(ix, 1); else s.weekdays.push(d); }
        else if ((b = t.closest('[data-s-step]'))) s.times_per_week = Math.max(1, Math.min(14, (s.times_per_week || 1) + (+b.dataset.sStep)));
        else return;
        renderSessions(); return saveDraft();
      }
      if ((b = t.closest('[data-r-add]'))) { var rid = b.dataset.rAdd; (st.rows[rid] = st.rows[rid] || []).push({}); renderRows(rid); return saveDraft(); }
      var item = t.closest('.row-item');
      if (item) {
        var id = item.parentElement.id.replace(/-box$/, ''), list = st.rows[id] || [], idx = +item.dataset.rid;
        if (t.closest('[data-r-remove]')) list.splice(idx, 1);
        else if ((b = t.closest('button[data-r-col]'))) list[idx][b.dataset.rCol] = list[idx][b.dataset.rCol] === b.dataset.val ? '' : b.dataset.val;
        else return;
        renderRows(id); return saveDraft();
      }
    });
    root.addEventListener('input', function (e) {
      var el = e.target;
      if (el.type === 'range') { st.sliders[el.id] = +el.value; paintSlider(byId[el.id]); applyShowIf(); return saveDraft(); }
      if (el.dataset.sField) {
        var card = el.closest('.session');
        st.sessions.forEach(function (s) { if (s.id === card.dataset.sid) s[el.dataset.sField] = el.value; });
        return saveDraft();
      }
      if (el.dataset.rCol) {
        var item = el.closest('.row-item'), id = item.parentElement.id.replace(/-box$/, '');
        st.rows[id][+item.dataset.rid][el.dataset.rCol] = el.value; return saveDraft();
      }
      if (el.classList.contains('invalid')) el.classList.remove('invalid');
      applyShowIf(); saveDraft();
    });
    root.addEventListener('change', function (e) {
      var el = e.target;
      if (el.type === 'checkbox' && byId[el.id] && byId[el.id].type === 'consent') { st.consent[el.id] = el.checked; saveDraft(); }
    });

    // ── Control expuesto a onChange (p. ej. añadir una sesión al marcar un deporte) ──
    var ctl = {
      addSession: function (sport, values) {
        var s = newSession(sport);
        Object.keys(values || {}).forEach(function (k) { if (k in s && k !== 'id') s[k] = values[k]; });
        st.sessions.push(s);
      },
      hasSession: function (sport) { return st.sessions.some(function (s) { return s.sport === sport; }); }
    };

    // ── Wizard ──
    function fail(message, i) {
      if (i != null && i !== current) show(i);
      banner.textContent = message; banner.style.display = 'block';
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return false;
    }
    function show(i) {
      stepEls.forEach(function (s, j) { s.classList.toggle('active', i === j); });
      current = i;
      document.getElementById('progress').style.width = ((i + 1) / stepEls.length * 100) + '%';
      document.getElementById('step-name').textContent = stepEls[i].dataset.name;
      document.getElementById('step-count').textContent = 'Paso ' + (i + 1) + ' de ' + stepEls.length;
      btnBack.style.visibility = i === 0 ? 'hidden' : 'visible';
      btnNext.textContent = i === stepEls.length - 1 ? 'Enviar' : 'Continuar';
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    function stepOk(i) {
      var msg = cfg.validateStep ? cfg.validateStep(steps[i].key, api) : null;
      if (msg) return fail(msg, i);
      banner.style.display = 'none';
      return true;
    }
    btnBack.addEventListener('click', function () { banner.style.display = 'none'; if (current > 0) show(current - 1); });
    btnNext.addEventListener('click', function () {
      if (!stepOk(current)) return;
      if (current < stepEls.length - 1) { show(current + 1); saveDraft(); } else submit();
    });

    // ── Envío ──
    function collect() {
      var data = {}, n = !!cfg.numeric;
      Object.keys(cfg.base || {}).forEach(function (k) { data[k] = cfg.base[k]; });
      fields.forEach(function (f) {
        if (!visible(f)) return;
        var el = document.getElementById(f.id), t = f.type;
        if (t === 'number') { if (el.value.trim() !== '') data[f.id] = n ? +el.value.replace(',', '.') : el.value.trim(); }
        else if (INPUT_TYPES.indexOf(t) >= 0) { if (el.value.trim() !== '') data[f.id] = el.value.trim(); }
        else if (t === 'chips') { if (st.chips[f.id]) data[f.id] = st.chips[f.id]; }
        else if (t === 'checks') { if ((st.checks[f.id] || []).length) data[f.id] = st.checks[f.id].join(', '); }
        else if (t === 'grid') {
          var names = {}; f.levels.forEach(function (l) { names[l[0]] = l[2]; });
          var keys = f.foods.filter(function (food) { return st.grid[food]; });
          if (keys.length) data[f.id] = keys.map(function (food) { return food + ': ' + names[st.grid[food]]; }).join(' | ');
        }
        else if (t === 'slider') { if (st.sliders[f.id] != null) data[f.id] = +st.sliders[f.id]; }
        else if (t === 'weights') DAY_KEYS.forEach(function (k) { var w = document.getElementById(k); if (w && w.value !== '') data[k] = +w.value.replace(',', '.'); });
        else if (t === 'sport_totals') {
          var out = [];
          SPORTS.forEach(function (sp) {
            if (!st.totals[sp.key]) return;
            var g = function (fl) { var x = document.getElementById('tr_' + sp.key + '_' + fl); return x ? num(x.value) : null; };
            var hours = g('hours');
            var e = { sport: sp.key, sessions: g('sessions'), minutes: hours == null ? null : Math.round(hours * 60), km: sp.km ? g('km') : null, rpe: g('rpe'), hr: g('hr') };
            if (e.sessions || e.minutes || e.km) out.push(e);
          });
          if (out.length) data[f.id] = JSON.stringify(out);
        }
        else if (t === 'sessions') { var ss = cleanSessions(); if (ss.length) data[f.id] = JSON.stringify(ss); }
        else if (t === 'rows') {
          var rows = (st.rows[f.id] || []).filter(function (r) { return f.columns.some(function (c) { return String(r[c.key] || '').trim() !== ''; }); });
          if (rows.length) data[f.id] = JSON.stringify(rows);
        }
        else if (t === 'consent') { if (st.consent[f.id]) data[f.id] = localISO(new Date()); }
      });
      return cfg.transform ? (cfg.transform(data, api) || data) : data;
    }
    function submit() {
      for (var i = 0; i < steps.length; i++) { if (!stepOk(i)) return; }
      btnNext.disabled = true; btnNext.innerHTML = '<span class="spinner"></span>Enviando…';
      var data = collect();
      if (cfg.preview) {       // vista previa: se llega al final, pero no se envía ni se toca ningún borrador
        document.getElementById('form-area').style.display = 'none';
        document.getElementById('nav').style.display = 'none';
        document.getElementById('success-title').textContent = 'Vista previa';
        document.querySelector('#success p').textContent = 'Así lo verá tu cliente. No se ha enviado nada.';
        document.getElementById('success').classList.add('active'); window.scrollTo(0, 0);
        return;
      }
      // no-cors + credentials omit: la petición no lleva la sesión de Google del cliente
      // (evita el fallo multi-cuenta de Apps Script). La respuesta es opaca; doPost escribe igual.
      fetch(cfg.execUrl, { method: 'POST', mode: 'no-cors', credentials: 'omit', redirect: 'follow',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(data) })
        .then(function () {
          try { localStorage.removeItem(cfg.draftKey); } catch (e) {}
          document.getElementById('form-area').style.display = 'none';
          document.getElementById('nav').style.display = 'none';
          if (cfg.success.titleFor) { var tt = cfg.success.titleFor(data); if (tt) document.getElementById('success-title').textContent = tt; }
          document.getElementById('success').classList.add('active'); window.scrollTo(0, 0);
        })
        .catch(function (err) {
          btnNext.disabled = false; btnNext.textContent = 'Reintentar envío';
          fail('No se pudo enviar (' + ((err && err.message) || 'sin conexión') + '). Tus respuestas siguen guardadas en este dispositivo: prueba otra vez.');
        });
    }

    try { loadDraft(); paintState(); }
    catch (e) {      // último recurso: un borrador que rompe el pintado se descarta en vez de dejar el formulario inservible
      st = freshState(); seq = 0;
      try { localStorage.removeItem(cfg.draftKey); } catch (e2) {}
      paintState();
    }
    show(0);
    return { collect: collect, state: st, show: show };
  }

  global.MadaForm = { mount: mount, SPORTS: SPORTS, BRISTOL: BRISTOL, esc: esc, localISO: localISO };
})(window);
