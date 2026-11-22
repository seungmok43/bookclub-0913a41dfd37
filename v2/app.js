/* BooKLove v2 preview — one site, four screens (홈 · 서재 · 책 · 내 계정) + 서평 list.
   Data: v2/data.js (built by v2/build_data.py), v2/groups.js (draft curation), community/config.js.
   Writes reuse the existing Supabase RPCs (login / register / logout / m_add_review) and the same
   localStorage key `blk_acct` as community/app.js, so a login here carries to the real pages. */
(function () {
  'use strict';
  var CFG = window.BOOKLOVE_CONFIG || {};
  // Site root relative to the page: '' when served at the site root (index.html), '../' for /v2/.
  var BASE = typeof window.BLK_BASE === 'string' ? window.BLK_BASE : '../';
  var BOOKS = (window.V2_DATA || { books: [] }).books;
  var GR = window.V2_GROUPS || { groups: [], forWhom: {}, draft: true };
  var BY = {}; BOOKS.forEach(function (b) { BY[b.slug] = b; });
  var LIVE = !!(CFG.supabaseUrl && CFG.supabaseAnonKey);
  var ACC_KEY = 'blk_acct', NAME_MAX = 20;
  var ERR = {
    bad_login: '이름 또는 비밀번호가 맞지 않습니다.',
    name_taken: '이미 쓰이는 이름입니다. 다른 이름이나 별명을 정해 주세요.',
    invalid_name: '이름이나 별명을 적어 주세요.',
    weak_password: '비밀번호는 4자 이상으로 정해 주세요.',
    login_required: '로그인이 필요합니다. 다시 로그인해 주세요.',
    rate_limited: '짧은 시간에 글이 많이 올라왔어요. 잠시 후 다시 시도해 주세요.',
    invalid_input: '입력한 내용을 다시 확인해 주세요.',
    pending_approval: '가입 신청이 접수되었습니다. 목사님 승인 후 로그인할 수 있습니다.',
    not_approved: '가입이 승인되지 않았습니다. 모임 진행자에게 문의해 주세요.',
    not_host: '진행자만 할 수 있습니다.',
    network: '연결이 원활하지 않습니다. 잠시 후 다시 시도해 주세요.'
  };

  // ---------- helpers ----------
  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      var v = attrs[k]; if (v == null || v === false) continue;
      if (k === 'class') el.className = v; else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v); else el.setAttribute(k, v);
    }
    for (var i = 2; i < arguments.length; i++) add(el, arguments[i]);
    return el;
  }
  function add(el, c) {
    if (c == null || c === false) return;
    if (Array.isArray(c)) { c.forEach(function (x) { add(el, x); }); return; }
    el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
  function lget(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lset(k, v) { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch (e) { } }
  var ACC = (function () { try { var a = JSON.parse(lget(ACC_KEY)); return a && a.t && a.id ? a : null; } catch (e) { return null; } })();
  function setAcc(a) { ACC = a; attCache = null; lset(ACC_KEY, a ? JSON.stringify(a) : ''); }
  function cleanName(v) { return (v || '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX); }
  function dot(d) { return d.replace(/-/g, '.'); }
  function stars(n) { n = Math.round(n); return '★★★★★'.slice(0, n) + '☆☆☆☆☆'.slice(0, 5 - n); }
  function cover(b) {
    if (b.cover) return h('div', { class: 'cv' }, h('img', { src: BASE + b.cover, alt: b.title + ' 표지', loading: 'lazy' }));
    return h('div', { class: 'cv dz', style: '--t:' + (b.tone || '#3d5a4a') }, h('b', null, b.title), h('small', null, b.author));
  }
  function allSessions() {
    var out = [];
    BOOKS.forEach(function (b) { b.sessions.forEach(function (s) { out.push({ b: b, s: s }); }); });
    return out.sort(function (x, y) { return x.s.date < y.s.date ? 1 : x.s.date > y.s.date ? -1 : 0; });
  }
  function years(b) {
    var ys = {}; b.sessions.forEach(function (s) { ys[s.date.slice(0, 4)] = 1; });
    if (!b.sessions.length) (b.period.match(/20\d\d/g) || []).forEach(function (y) { ys[y] = 1; });
    return Object.keys(ys);
  }

  // ---------- Supabase ----------
  function api(path, body) {
    var hd = { apikey: CFG.supabaseAnonKey, Authorization: 'Bearer ' + CFG.supabaseAnonKey };
    if (body) hd['Content-Type'] = 'application/json';
    return fetch(CFG.supabaseUrl.replace(/\/$/, '') + path, { method: body ? 'POST' : 'GET', headers: hd, body: body ? JSON.stringify(body) : undefined })
      .then(function (r) { return r.json().catch(function () { return null; }).then(function (j) { if (!r.ok) { var e = new Error('http ' + r.status); e.status = r.status; throw e; } return j; }); });
  }
  function rpc(name, body) {
    if (!LIVE) return Promise.resolve({ ok: false, error: 'network' });
    return api('/rest/v1/rpc/' + name, body).then(function (j) { return j && typeof j === 'object' ? j : { ok: false, error: 'network' }; },
      function (e) { return { ok: false, error: e && e.status === 404 ? 'missing' : 'network' }; });
  }
  var revCache = null;
  function reviews() {
    if (!LIVE) return Promise.resolve([]);
    if (!revCache) revCache = api('/rest/v1/reviews?select=id,book_slug,rating,one_liner,body,nickname,member_id,created_at&order=created_at.desc&limit=1000')
      .catch(function () { revCache = null; return null; });
    return revCache;
  }
  // ---------- attendance (출석) ----------
  // Needs supabase/migrate_05_attendance.sql. Until the RPC exists it answers 404 ('missing'):
  // buttons stay hidden and the account screen says 「준비 중」.
  var attCache = null, attPainters = [];   // painters: every 출석 bar on the current screen
  function myAtt() {
    if (!ACC) return Promise.resolve(null);
    if (!attCache) attCache = rpc('m_my_attendance', { p_token: ACC.t });
    return attCache;
  }
  function kstToday() { return new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10); }
  var AERR = { invalid_input: '이 모임은 지금 출석할 수 없습니다.', too_late: '출석 취소는 출석한 날에만 할 수 있습니다.' };
  function attendBar(slug, date) {
    var bar = h('div', { class: 'att' }); bar.hidden = true;
    var dd = Math.round((Date.parse(kstToday()) - Date.parse(date)) / 864e5);
    if (!ACC || !LIVE || !(dd >= -1 && dd <= 60)) return bar;
    function paint() {
      myAtt().then(function (r) {
        bar.textContent = '';
        if (!r || !r.ok) { if (r && r.error === 'login_required') setAcc(null); bar.hidden = true; return; }
        var row = (r.rows || []).filter(function (x) { return x.book_slug === slug && x.date === date; })[0];
        var msg = h('span', { class: 'msg', role: 'status' });
        function act(name, b) {
          b.disabled = true;
          rpc(name, { p_token: ACC.t, p_book_slug: slug, p_date: date }).then(function (x) {
            b.disabled = false;
            if (x && x.ok) {
              if (name === 'm_check_in') { JUST = slug + '|' + date; setTimeout(function () { if (JUST === slug + '|' + date) JUST = null; }, 2500); }
              attCache = null; attPainters.forEach(function (f) { f(); }); return;
            }
            msg.className = 'msg err'; msg.textContent = AERR[x && x.error] || ERR[x && x.error] || ERR.network;
          });
        }
        if (row) {
          // Attended: no confirmation line here (cancelling lives in the calendar / 도장판 sheet).
          // Right after a check-in, only the stamp moment shows.
          if (JUST !== slug + '|' + date) { bar.hidden = true; return; }
          inkDefs(); add(bar, stampSvg({ book_slug: slug, date: date }, 'drop tiny'));
        } else {
          var b = h('button', { class: 'btn sm', type: 'button' }, '출석');
          b.addEventListener('click', function () { act('m_check_in', b); });
          add(bar, [h('span', null, dot(date) + ' 모임에 함께하셨나요?'), b]);
        }
        add(bar, msg); bar.hidden = false;
      });
    }
    attPainters.push(paint); paint();
    return bar;
  }
  function latestOpen(b) {
    var ss = (b && b.sessions || []).filter(function (s) { return !s.locked; }).sort(function (x, y) { return x.date < y.date ? 1 : -1; });
    return ss[0] || null;
  }


  // ---------- 홈 화면에 추가 (install hint) ----------
  // Members on a phone browser, not yet installed, not dismissed. Android/Chrome: one button that opens the
  // browser's own install prompt (beforeinstallprompt). iPhone/iPad: a two-step picture (공유 → 홈 화면에 추가).
  var BIP = null, hintPainters = [], HINT_KEY = 'blk_pwa_hint';
  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); BIP = e; hintPainters.forEach(function (f) { f(); }); });
  window.addEventListener('appinstalled', function () { BIP = null; lset(HINT_KEY, '1'); hintPainters.forEach(function (f) { f(); }); });
  function standalone() { try { return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true; } catch (e) { return false; } }
  function isIOS() { var u = navigator.userAgent || ''; return /iPhone|iPad|iPod/.test(u) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); }
  function isPhone() { try { return isIOS() || /Android/i.test(navigator.userAgent) || window.matchMedia('(pointer: coarse)').matches; } catch (e) { return false; } }
  var IC_SHARE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15V3"/><path d="m7.5 7.5 4.5-4.5 4.5 4.5"/><path d="M8 10H6a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-9a1 1 0 0 0-1-1h-2"/></svg>';
  var IC_ADD = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="3.5" width="17" height="17" rx="4"/><path d="M12 8v8M8 12h8"/></svg>';
  function icon(svg) { var sp = h('span', { class: 'ih-ic' }); sp.innerHTML = svg; return sp; }
  function installHint() {
    var box = h('div', { class: 'ihint-box' }); box.hidden = true;
    function paint() {
      box.textContent = ''; box.hidden = true;
      if (!ACC || standalone() || lget(HINT_KEY) || !isPhone()) return;
      var ios = isIOS();
      if (!ios && !BIP) return;                       // nothing we can offer on this browser (yet)
      var x = h('button', { class: 'ih-x', type: 'button', 'aria-label': '다음에 보기' }, '×');
      x.addEventListener('click', function () { lset(HINT_KEY, '1'); hintPainters.forEach(function (f) { f(); }); });
      var body;
      if (ios) {
        body = h('ol', { class: 'ih-steps' },
          h('li', null, h('span', { class: 'ih-n' }, '1'), icon(IC_SHARE), h('span', null, '화면 아래 ', h('b', null, '공유'), ' 버튼을 누르고')),
          h('li', null, h('span', { class: 'ih-n' }, '2'), icon(IC_ADD), h('span', null, h('b', null, '홈 화면에 추가'), '를 누르세요')));
      } else {
        var b = h('button', { class: 'btn sm', type: 'button' }, '홈 화면에 추가');
        b.addEventListener('click', function () {
          var ev = BIP; if (!ev) return;
          BIP = null; ev.prompt();
          (ev.userChoice || Promise.resolve({})).then(function (c) { if (c && c.outcome === 'accepted') lset(HINT_KEY, '1'); hintPainters.forEach(function (f) { f(); }); });
        });
        body = h('div', { class: 'ih-go' }, b);
      }
      add(box, h('section', { class: 'ihint', 'aria-label': '홈 화면에 추가' },
        h('div', { class: 'ih-hd' }, h('img', { class: 'ih-app', src: BASE + 'assets/icons/icon-192.png', alt: '', width: '44', height: '44' }),
          h('div', null, h('b', null, '북클러버를 홈 화면에'), h('span', null, '앱처럼 한 번에 열립니다.')), x),
        body));
      box.hidden = false;
    }
    hintPainters.push(paint); paint();
    return box;
  }

  // ---------- 출석 도장판 · 달력 ----------
  // Built only from m_my_attendance rows (the member's own). Shows stamps for meetings attended;
  // never marks a missed meeting. Faint dots only on upcoming meeting days (today or later).
  var JUST = null;   // 'slug|date' of the stamp just checked in — that one drops in once
  var CARD_N = 10;
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function seedOf(s) { var n = 7; for (var i = 0; i < s.length; i++) n = (n * 31 + s.charCodeAt(i)) % 9973; return n; }
  function inkDefs() {
    if (document.getElementById('blk-ink-defs')) return;
    var d = document.createElement('div');
    d.id = 'blk-ink-defs'; d.setAttribute('aria-hidden', 'true'); d.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
    d.innerHTML = '<svg width="0" height="0"><filter id="blk-ink" x="-10%" y="-10%" width="120%" height="120%">' +
      '<feTurbulence type="fractalNoise" baseFrequency="0.06" numOctaves="2" seed="4" result="w"/>' +
      '<feDisplacementMap in="SourceGraphic" in2="w" scale="2.6" xChannelSelector="R" yChannelSelector="G" result="d"/>' +
      '<feTurbulence type="fractalNoise" baseFrequency="0.55" numOctaves="2" seed="9" result="sp"/>' +
      '<feColorMatrix in="sp" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  -2.4 0 0 0 2.05" result="m"/>' +
      '<feComposite in="d" in2="m" operator="in"/></filter></svg>';
    document.body.appendChild(d);
  }
  function dayLabel(x) {
    var b = BY[x.book_slug], s = b && b.sessions.filter(function (z) { return z.date === x.date; })[0];
    var dw = s ? s.day : '일월화수목금토'.charAt(new Date(x.date + 'T00:00:00Z').getUTCDay());
    return dw + '요';
  }
  function sessOf(x) {
    var b = BY[x.book_slug];
    return b ? b.sessions.filter(function (z) { return z.date === x.date && !z.locked; })[0] || null : null;
  }
  // One round ink stamp (inline SVG). Slight rotation and ink colour come from the date + book, so they stay put.
  function shortTitle(b) { var t = (b ? b.title : '').replace(/\(.*?\)/g, '').split(/[\s,·:—?!.]+/)[0] || ''; return t.length > 4 ? t.slice(0, 4) : t; }
  function stampSvg(x, cls, label) {
    var sd = seedOf(x.book_slug + x.date), rot = (sd % 19) - 9;
    var ink = ['#b23a2b', '#a9641c', '#9a2f3c'][sd % 3];
    var b = BY[x.book_slug], title = b ? b.title : x.book_slug;
    var el = document.createElement('span');
    el.className = 'stp' + (cls ? ' ' + cls : '');
    el.setAttribute('role', 'img');
    el.setAttribute('aria-label', dot(x.date) + ' ' + title + ' 출석 도장');
    el.innerHTML = '<svg viewBox="0 0 100 100" aria-hidden="true"><g transform="rotate(' + rot + ' 50 50)" fill="none" stroke="' + ink + '" filter="url(#blk-ink)" opacity=".9">' +
      '<circle cx="50" cy="50" r="44" stroke-width="5.5"/><circle cx="50" cy="50" r="36" stroke-width="1.8"/>' +
      '<path d="M30 40c6-3 13-3 20 1 7-4 14-4 20-1v20c-6-3-13-3-20 1-7-4-14-4-20-1z" stroke-width="3.4" stroke-linejoin="round"/>' +
      '<path d="M50 41v20" stroke-width="2.6"/>' +
      '<text x="50" y="79" text-anchor="middle" fill="' + ink + '" stroke="none" font-size="13.5" font-weight="800" font-family="Pretendard,Apple SD Gothic Neo,sans-serif" letter-spacing="1">' + esc(label || dayLabel(x)) + '</text>' +
      '<text x="50" y="30" text-anchor="middle" fill="' + ink + '" stroke="none" font-size="9.5" font-weight="800" font-family="Georgia,serif" letter-spacing="1.2">BooKLove</text>' +
      '</g></svg>';
    return el;
  }
  function sortedAsc(rows) {
    return rows.slice().sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : String(a.created_at) < String(b.created_at) ? -1 : 1; });
  }
  // The café-style card: 10 slots, current card in front, full cards stacked behind (count shown).
  function stampCard(rows, mini) {
    var all = sortedAsc(rows), n = all.length;
    var full = Math.floor(n / CARD_N), cur = n % CARD_N;
    var justFilled = n > 0 && cur === 0;            // the newest stamp filled a card: show that card + the line
    var front = justFilled ? all.slice(n - CARD_N) : all.slice(n - cur);
    var behind = justFilled ? full - 1 : full;
    var no = justFilled ? full : full + 1;
    var card = h('div', { class: 'scard' + (mini ? ' mini' : '') + (behind > 0 ? ' stacked' + (behind > 1 ? ' s2' : '') : '') });
    add(card, h('div', { class: 'shd' }, h('b', null, 'BooKLove 출석 도장판'), h('span', null, no + '번째 장')));
    var grid = h('div', { class: 'sgrid' });
    for (var i = 0; i < CARD_N; i++) {
      var x = front[i];
      if (x) {
        var key = x.book_slug + '|' + x.date;
        var s = stampSvg(x, key === JUST ? 'drop' : '');
        var sb = h('button', { class: 'slot on', type: 'button', 'data-k': key, 'aria-label': (BY[x.book_slug] ? BY[x.book_slug].title : x.book_slug) + ' · ' + dot(x.date) + ' 출석' },
          s, h('span', { class: 'sd' }, x.date.slice(5).replace('-', '.')));
        sb.addEventListener('click', (function (dd, el) { return function () { openSheet(all.filter(function (z) { return z.date === dd; }), el); }; })(x.date, sb));
        add(grid, sb);
      } else add(grid, h('span', { class: 'slot' }, h('span', { class: 'ring', 'aria-hidden': 'true' }, String(i + 1))));
    }
    add(card, grid);
    if (justFilled) add(card, h('p', { class: 'sfull' }, '도장판 한 장을 채웠습니다. 함께 읽어 주셔서 고맙습니다.', mini ? null : h('small', null, '다음 출석부터 새 도장판이 시작됩니다.')));
    var foot = behind > 0 ? '채운 도장판 ' + behind + '장' : '';
    if (foot) add(card, h('p', { class: 'sstack' }, foot));
    return card;
  }
  function yearLine(rows) {
    var y = kstToday().slice(0, 4);
    var n = rows.filter(function (x) { return String(x.date).slice(0, 4) === y; }).length;
    return h('p', { class: 'secline' }, n ? '올해 ' + n + '번 함께했습니다.' : '올해는 아직 출석 기록이 없습니다.');
  }
  // Weekdays the club meets, from config currentBooks (nextMeeting 「매주 수요일 …」 or group 「수요 오전」).
  function meetDays() {
    var out = {};
    (CFG.currentBooks || (CFG.currentBook ? [CFG.currentBook] : [])).forEach(function (c) {
      var m = /([일월화수목금토])요일/.exec(c.nextMeeting || '') || /([수금])/.exec(c.group || '');
      if (m) out[DOW[m[1]]] = c.group || (m[1] + '요');
    });
    return out;
  }
  // Day sheet (from a calendar cover day or a 도장판 stamp): book, N회, date, record link,
  // and 「출석 취소」 only while the server allows it (undo_ok, same rule as before), with an inline confirm.
  var closeSheet = function () { };
  function reduceMotion() { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } }
  function openSheet(list, from) {
    closeSheet();
    if (!list.length) return;
    var day = list[0].date;
    var sh = h('div', { class: 'csheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': dot(day) + ' 출석' });
    var close = h('button', { class: 'cx', type: 'button', 'aria-label': '닫기' }, '×');
    add(sh, h('div', { class: 'csh' }, h('b', null, dot(day) + ' (' + dayLabel(list[0]).charAt(0) + ')'), close));
    list.forEach(function (x) {
      var b = BY[x.book_slug], s = sessOf(x), key = x.book_slug + '|' + x.date;
      var undo = null;
      if (x.undo_ok && ACC) {
        undo = h('div', { class: 'cundo' });
        var msg = h('span', { class: 'msg err', role: 'status' });
        var ask = function () {
          undo.textContent = '';
          var yes = h('button', { class: 'uq yes', type: 'button' }, '취소하기');
          var no = h('button', { class: 'uq', type: 'button' }, '그대로 두기');
          no.addEventListener('click', function () { idle(); });
          yes.addEventListener('click', function () {
            yes.disabled = no.disabled = true;
            rpc('m_undo_check_in', { p_token: ACC.t, p_book_slug: x.book_slug, p_date: x.date }).then(function (r) {
              if (!(r && r.ok)) { yes.disabled = no.disabled = false; msg.textContent = AERR[r && r.error] || ERR[r && r.error] || ERR.network; return; }
              var els = document.querySelectorAll('[data-k="' + key + '"]');
              [].forEach.call(els, function (e) { e.classList.add('lift'); });
              setTimeout(function () { closeSheet(); attCache = null; attPainters.forEach(function (f) { f(); }); }, reduceMotion() ? 0 : 420);
            });
          });
          add(undo, [h('span', { class: 'uqt' }, '취소할까요?'), yes, no, msg]);
        };
        var idle = function () {
          undo.textContent = '';
          var u = h('button', { class: 'ulnk', type: 'button' }, '출석 취소');
          u.addEventListener('click', ask);
          add(undo, u);
        };
        idle();
      }
      add(sh, h('div', { class: 'cone' }, b ? cover(b) : null,
        h('div', null, h('div', { class: 't' }, b ? b.title : x.book_slug),
          h('div', { class: 'd' }, (s ? s.round + '회 · ' : '') + dot(day) + ' 모임에 함께했습니다'),
          h('a', { class: 'btn sm', href: s ? BASE + s.href : '#/book/' + x.book_slug }, s ? '그날 기록 읽기' : '책 보기'),
          undo)));
    });
    var bg = h('div', { class: 'cback' });
    function done() { closeSheet(); if (from && from.isConnected) from.focus(); }
    close.addEventListener('click', done); bg.addEventListener('click', done);
    function escKey(e) { if (e.key === 'Escape') done(); }
    document.addEventListener('keydown', escKey);
    closeSheet = function () { document.removeEventListener('keydown', escKey); if (bg.parentNode) bg.remove(); if (sh.parentNode) sh.remove(); closeSheet = function () { }; };
    document.body.appendChild(bg); document.body.appendChild(sh); close.focus();
  }
  var CAL = null;   // { y, m } — month shown, kept while the screen repaints
  function calendar(rows) {
    var today = kstToday(), md = meetDays();
    var byDay = {}, last = '';
    rows.forEach(function (x) { (byDay[x.date] = byDay[x.date] || []).push(x); if (x.date > last) last = x.date; });
    var dm = last || today;   // default month: the latest month with attendance, else this month
    if (!CAL) CAL = { y: +dm.slice(0, 4), m: +dm.slice(5, 7) - 1 };
    var all = allSessions(), first = all.length ? all[all.length - 1].s.date : today;
    rows.forEach(function (x) { if (x.date < first) first = x.date; });
    var minI = +first.slice(0, 4) * 12 + (+first.slice(5, 7) - 1), maxI = +today.slice(0, 4) * 12 + (+today.slice(5, 7) - 1) + 3;
    var box = h('div', { class: 'cal' });
    var title = h('b', { class: 'cm', 'aria-live': 'polite' });
    var prev = h('button', { class: 'cnav', type: 'button', 'aria-label': '이전 달' }, '‹');
    var next = h('button', { class: 'cnav', type: 'button', 'aria-label': '다음 달' }, '›');
    var head = h('div', { class: 'chd' }, prev, title, next);
    var grid = h('div', { class: 'cgrid' });
    var legend = Object.keys(md).length ? h('p', { class: 'clg' }, h('span', { class: 'cdot', 'aria-hidden': 'true' }), '다가오는 모임 날 (' + Object.keys(md).map(function (k) { return md[k]; }).join(' · ') + ')') : null;
    add(box, [head, h('div', { class: 'cwk', 'aria-hidden': 'true' }, ['일', '월', '화', '수', '목', '금', '토'].map(function (w, i) { return h('span', { class: i === 0 ? 'sun' : '' }, w); })), grid, legend]);
    function draw() {
      var y = CAL.y, m = CAL.m, idx = y * 12 + m;
      title.textContent = y + '년 ' + (m + 1) + '월';
      prev.disabled = idx <= minI; next.disabled = idx >= maxI;
      grid.textContent = '';
      var start = new Date(Date.UTC(y, m, 1)).getUTCDay(), days = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
      for (var i = 0; i < start; i++) add(grid, h('span', { class: 'cd pad' }));
      for (var d = 1; d <= days; d++) {
        var ds = y + '-' + ('0' + (m + 1)).slice(-2) + '-' + ('0' + d).slice(-2), wd = (start + d - 1) % 7;
        var hit = byDay[ds], cls = 'cd' + (ds === today ? ' today' : '') + (wd === 0 ? ' sun' : '');
        if (hit) {
          var x = hit[0], key = x.book_slug + '|' + x.date, bk = BY[x.book_slug];
          var face = bk && bk.cover ? h('img', { class: 'ccv', src: BASE + bk.cover, alt: '', loading: 'lazy' })
            : h('span', { class: 'cfb' }, stampSvg(x, '', shortTitle(bk) || '출석'));
          var bt = h('button', { class: cls + ' hit', type: 'button', 'data-k': key, 'aria-label': dot(ds) + ' ' + hit.map(function (z) { return BY[z.book_slug] ? BY[z.book_slug].title : z.book_slug; }).join(', ') + ' 출석' },
            face, h('span', { class: 'n' }, String(d)), bk && bk.cover ? stampSvg(x, 'mark' + (key === JUST ? ' drop' : '')) : null);
          bt.addEventListener('click', (function (dd, el) { return function () { openSheet(byDay[dd] || [], el); }; })(ds, bt));
          add(grid, bt);
        } else {
          var up = ds >= today && md.hasOwnProperty(wd);
          add(grid, h('span', { class: cls }, h('span', { class: 'n' }, String(d)), up ? h('span', { class: 'cdot', 'aria-hidden': 'true' }) : null));
        }
      }
    }
    function move(k) {
      var idx = CAL.y * 12 + CAL.m + k;
      if (idx < minI || idx > maxI) return;
      CAL = { y: Math.floor(idx / 12), m: idx % 12 }; draw();
    }
    prev.addEventListener('click', function () { move(-1); });
    next.addEventListener('click', function () { move(1); });
    var tx = null, ty = null;
    grid.addEventListener('touchstart', function (e) { var t = e.touches[0]; tx = t.clientX; ty = t.clientY; }, { passive: true });
    grid.addEventListener('touchend', function (e) {
      if (tx == null) return;
      var t = e.changedTouches[0], dx = t.clientX - tx, dy = t.clientY - ty; tx = null;
      if (Math.abs(dx) > 50 && Math.abs(dy) < 40) move(dx < 0 ? 1 : -1);
    }, { passive: true });
    draw();
    return box;
  }
  // A box that (re)draws from the member's attendance; hidden when logged out or the RPC is unavailable.
  function stampBox(mini) {
    var box = h('div', { class: 'stampbox' + (mini ? ' home' : '') }); box.hidden = true;
    if (!ACC || !LIVE) return box;
    function paint() {
      myAtt().then(function (r) {
        box.textContent = '';
        if (!r || !r.ok) { box.hidden = true; return; }
        inkDefs();
        var rows = (r.rows || []).map(function (x) { return { book_slug: x.book_slug, date: String(x.date).slice(0, 10), created_at: x.created_at, undo_ok: x.undo_ok }; });
        if (mini) {
          add(box, h('div', { class: 'shome' }, h('div', { class: 'shl' }, h('b', null, '내 도장판'), yearLine(rows)), stampCard(rows, true),
            h('a', { class: 'more', href: '#/account' }, '도장판과 달력 보기 →')));
        } else {
          add(box, [yearLine(rows), calendar(rows), h('h3', { class: 'sub3' }, '도장판'), stampCard(rows, false)]);
        }
        box.hidden = false;
      });
    }
    attPainters.push(paint); paint();
    return box;
  }

  function revCard(r, withBook, short) {
    var b = BY[r.book_slug];
    return h('div', { class: 'rv' },
      withBook && b ? h('a', { class: 'bk', href: '#/book/' + b.slug }, b.title) : null,
      h('div', { class: 'st', 'aria-label': r.rating + '점' }, stars(r.rating)),
      h('div', { class: 'one' }, r.one_liner || ''),
      r.body && !short ? h('div', { class: 'body' }, r.body) : null,
      h('div', { class: 'meta' }, (r.nickname || '') + ' · ' + dot((r.created_at || '').slice(0, 10))));
  }
  function revInto(box, rows, n, withBook) {
    box.textContent = '';
    if (rows == null) { add(box, h('p', { class: 'empty' }, ERR.network)); return; }
    if (!rows.length) { add(box, h('p', { class: 'empty' }, '아직 서평이 없습니다.')); return; }
    rows.slice(0, n || rows.length).forEach(function (r) { add(box, revCard(r, withBook, !!n)); });
  }

  // ---------- rows ----------
  function bookRow(b) {
    return h('a', { class: 'row', href: '#/book/' + b.slug }, cover(b),
      h('div', null, h('div', { class: 't' }, b.title), h('div', { class: 'h' }, b.hook)));
  }
  function sessionRow(x, showBook) {
    var s = x.s, b = x.b;
    var when = dot(s.date) + ' (' + s.day + ') · ' + s.round + '회';
    if (s.locked) return h('div', { class: 'row nocv locked' },
      h('div', null, showBook ? h('div', { class: 't' }, b.title) : null, h('div', { class: 'h' }, '🔒 이 기록은 모임 안에서만 열립니다.'), h('div', { class: 'd' }, when)));
    return h('a', { class: 'row nocv', href: BASE + s.href },
      h('div', null, showBook ? h('div', { class: 't' }, b.title) : null, h('div', { class: 'h' }, s.hook), h('div', { class: 'd' }, when + ' · 기록 읽기 →')));
  }

  // ---------- screens ----------
  // Next meeting date for a 'currentBooks' entry: the coming 수/금 (today counts), Korea time.
  var DOW = { '일': 0, '월': 1, '화': 2, '수': 3, '목': 4, '금': 5, '토': 6 };
  function nextMeet(c) {
    var m = /([일월화수목금토])요일\s*(.*)$/.exec(c.nextMeeting || '') || /([수금])/.exec(c.group || '');
    if (!m) return null;
    var today = new Date(kstToday() + 'T00:00:00Z'), add = (DOW[m[1]] - today.getUTCDay() + 7) % 7;
    var d = new Date(today.getTime() + add * 864e5).toISOString().slice(0, 10);
    return { date: d, day: m[1], time: (m[2] || '').trim() };
  }
  function viewHome(root) {
    var cbs = CFG.currentBooks || (CFG.currentBook ? [CFG.currentBook] : []);
    // Home sentence — same wording as before, now on the opening photo. Breaks only at meaning units.
    // Trust line rule: N = every meeting listed in community/catalog.js (open + locked sessions);
    // M = books that have at least one such session; first year = earliest session date.
    var all = allSessions();
    var N = all.length, M = BOOKS.filter(function (b) { return b.sessions.length > 0; }).length;
    var first = all.length ? all[all.length - 1].s.date.slice(0, 4) : '';
    var IMG = BASE + 'assets/img/hero-library-';
    add(root, h('section', { class: 'lhero' },
      h('picture', null, h('source', { media: '(min-width: 700px)', srcset: IMG + '1600.jpg' }),
        h('img', { src: IMG + '900.jpg', alt: '', width: '900', height: '1260', decoding: 'async', fetchpriority: 'high' })),
      h('div', { class: 'lh-in' },
        h('p', { class: 'lh-brand' }, 'BooKLove'),
        h('p', { class: 'lh-tag' }, CFG.tagline || '책으로 삶을 읽다'),
        h('p', { class: 'trust' }, first + '년부터 모였습니다. ', h('br'), '함께 읽은 모든 책을 기록으로 남기지 못했지만, ', h('br'),
          '이곳에 그 일부인 ' + M + '권의 책과 ' + N + '번의 모임 기록이 담겨져 있습니다.')),
      h('div', { class: 'lh-ft' }, h('span', { class: 'lh-cp' }, '© 2026 BookLover(북클러버)'),
        h('a', { class: 'lh-cr', href: 'https://unsplash.com/@woltss78', target: '_blank', rel: 'noopener' }, '사진: Nikolai Sidorov / Unsplash'))));
    if (cbs.length) {
      add(root, h('h2', { class: 'sec first' }, '이번 주 모임'));
      add(root, h('div', { class: 'week' }, cbs.map(function (c) {
        var b = BY[c.slug] || { slug: c.slug, title: c.title, author: c.author, cover: (c.cover || ''), tone: '' };
        var fri = /금/.test(c.group || '');
        var nm = nextMeet(c);
        var last = latestOpen(BY[c.slug]);
        return h('div', { class: 'nowi' }, h('a', { class: 'nowc', href: '#/book/' + c.slug }, cover(b),
          h('div', null, h('span', { class: 'g ' + (fri ? 'f' : 'w') }, c.group || ''), h('b', null, c.title || b.title),
            h('span', { class: 'm' }, c.author || b.author),
            nm ? h('span', { class: 'when' }, dot(nm.date) + ' (' + nm.day + ')' + (nm.time ? ' ' + nm.time : '')) : (c.nextMeeting ? h('span', { class: 'when' }, c.nextMeeting) : null),
            c.place ? h('span', { class: 'pl' }, '장소 · ' + c.place) : null)),
          last ? attendBar(c.slug, last.date) : null);
      })));
    }
    if (ACC) add(root, [installHint(), stampBox(true)]);

    var open = allSessions().filter(function (x) { return !x.s.locked; });
    var top = open[0];
    if (top) add(root, h('section', { class: 'hero' }, cover(top.b),
      h('div', null, h('div', { class: 'eb' }, '최근 기록'), h('h2', null, top.b.title),
        h('div', { class: 'when' }, dot(top.s.date) + ' (' + top.s.day + ') · ' + top.s.round + '회')),
      h('p', { class: 'hook' }, top.s.hook),
      h('div', { class: 'go' }, h('a', { class: 'btn', href: BASE + top.s.href }, '읽기')),
      cbs.some(function (c) { return c.slug === top.b.slug; }) ? null : h('div', { class: 'go' }, attendBar(top.b.slug, top.s.date))));

    var groups = (GR.groups || []).filter(function (g) { return (g.slugs || []).some(function (s) { return BY[s]; }); });
    if (groups.length) add(root, h('h2', { class: 'sec' }, '삶의 질문으로 고르기'));
    var SHOW = 2, gbox = h('div');
    add(root, gbox);
    function groupBox(g) {
      var list = (g.slugs || []).map(function (s) { return BY[s]; }).filter(Boolean);
      var rows = h('div', { class: 'rows' }, list.slice(0, 3).map(bookRow));
      var box = h('section', { class: 'grp' }, h('h3', null, g.q), g.line ? h('p', { class: 'l' }, g.line) : null, rows);
      if (list.length > 3) {
        var more = h('button', { class: 'more', type: 'button' }, '책 더 보기 (' + (list.length - 3) + ')');
        more.addEventListener('click', function () { list.slice(3).forEach(function (b) { add(rows, bookRow(b)); }); more.remove(); });
        add(box, more);
      }
      return box;
    }
    groups.slice(0, SHOW).forEach(function (g) { add(gbox, groupBox(g)); });
    if (groups.length > SHOW) {
      var gm = h('button', { class: 'more', type: 'button' }, '질문 더 보기 (' + (groups.length - SHOW) + ')');
      gm.addEventListener('click', function () { groups.slice(SHOW).forEach(function (g) { add(gbox, groupBox(g)); }); gm.remove(); });
      add(root, gm);
    }

    // Trust line rule: N = every meeting listed in community/catalog.js (open + locked sessions);
    // M = books that have at least one such session; first year = earliest session date.

    add(root, h('h2', { class: 'sec' }, '최근 서평'));
    var rb = h('div', null, h('p', { class: 'empty' }, '불러오는 중…'));
    add(root, rb); add(root, h('a', { class: 'more', href: '#/reviews' }, '서평 모두 보기 →'));
    reviews().then(function (rows) { revInto(rb, rows, 3, true); });
  }

  var LIB = { f: '', q: '', date: false };
  function viewLibrary(root, dateView) {
    LIB.date = !!dateView;
    add(root, h('h1', { class: 'pg' }, '함께 읽은 책'));
    add(root, h('p', { class: 'sub' }, BOOKS.length + '권 · 모임 기록 ' + allSessions().length + '회'));
    var ys = {}; BOOKS.forEach(function (b) { years(b).forEach(function (y) { ys[y] = 1; }); });
    var filters = [['', '전체'], ['수', '수요'], ['금', '금요']].concat(Object.keys(ys).sort().reverse().map(function (y) { return [y, y + '년']; }));
    var chips = h('div', { class: 'tools' });
    var q = h('input', { class: 'search', type: 'search', placeholder: '책 제목·저자·한 줄로 찾기', value: LIB.q, 'aria-label': '찾기' });
    var view = h('div', { class: 'view' },
      h('a', { class: 'chip' + (LIB.date ? '' : ' on'), href: '#/library' }, '책으로 보기'),
      h('a', { class: 'chip' + (LIB.date ? ' on' : ''), href: '#/library/date' }, '날짜순'));
    var out = h('div');
    add(root, [q, chips, view, out]);
    function okBook(b) {
      var f = LIB.f;
      if (f === '수' || f === '금') { if (b.days.indexOf(f) < 0) return false; }
      else if (f && years(b).indexOf(f) < 0) return false;
      var t = LIB.q.trim().toLowerCase();
      return !t || (b.title + ' ' + b.author + ' ' + b.hook).toLowerCase().indexOf(t) >= 0;
    }
    function draw() {
      chips.textContent = '';
      filters.forEach(function (f) {
        add(chips, h('button', { type: 'button', class: 'chip' + (LIB.f === f[0] ? ' on' : ''), onclick: function () { LIB.f = f[0]; draw(); } }, f[1]));
      });
      out.textContent = '';
      if (!LIB.date) {
        var list = BOOKS.filter(okBook);
        if (!list.length) { add(out, h('p', { class: 'empty' }, '맞는 책이 없습니다.')); return; }
        add(out, h('div', { class: 'grid' }, list.map(function (b) {
          return h('a', { class: 'bk-card', href: '#/book/' + b.slug }, cover(b), h('div', { class: 't' }, b.title),
            h('div', { class: 'h' }, b.hook), h('div', { class: 'd' }, b.period + (b.sessions.length ? ' · ' + b.sessions.length + '회' : '')));
        })));
      } else {
        var t = LIB.q.trim().toLowerCase(), yr = '';
        var rows = allSessions().filter(function (x) {
          var f = LIB.f;
          if ((f === '수' || f === '금') && x.s.day !== f) return false;
          if (f && f !== '수' && f !== '금' && x.s.date.slice(0, 4) !== f) return false;
          return !t || (x.b.title + ' ' + x.b.author + ' ' + x.s.hook).toLowerCase().indexOf(t) >= 0;
        });
        if (!rows.length) { add(out, h('p', { class: 'empty' }, '맞는 기록이 없습니다.')); return; }
        var box = h('div', { class: 'rows' });
        rows.forEach(function (x) {
          var y = x.s.date.slice(0, 4);
          if (y !== yr) { yr = y; add(box, h('div', { class: 'yr' }, y + '년')); }
          add(box, sessionRow(x, true));
        });
        add(out, box);
      }
    }
    q.addEventListener('input', function () { LIB.q = q.value; draw(); });
    draw();
  }

  function viewBook(root, slug, write) {
    var b = BY[slug];
    if (!b) { add(root, h('p', { class: 'empty' }, '책을 찾을 수 없습니다.'), h('a', { class: 'more', href: '#/library' }, '함께 읽은 책으로 →')); return; }
    add(root, h('div', { class: 'bhead' }, cover(b), h('div', null, h('h1', null, b.title), h('div', { class: 'a' }, b.author),
      h('div', { class: 'a' }, b.period + (b.sessions.length ? ' · 모임 ' + b.sessions.length + '회' : '')),
      h('a', { class: 'blink', href: BASE + b.href }, '이 책 정리 페이지 →'))));
    if (b.hook) add(root, h('p', { class: 'bone' }, b.hook));
    var fw = (GR.forWhom || {})[slug];
    if (fw) add(root, h('div', { class: 'who' }, h('b', null, '이런 분께 '), fw));

    add(root, h('h2', { class: 'sec' }, '모임 기록'));
    if (!b.sessions.length) add(root, h('p', { class: 'empty' }, '이 책은 회차별 기록 대신 정리 페이지 한 곳에 모여 있습니다.'));
    else add(root, h('div', { class: 'rows' }, b.sessions.slice().sort(function (x, y) { return x.date < y.date ? 1 : -1; })
      .map(function (s) { return sessionRow({ b: b, s: s }, false); })));

    var head = h('h2', { class: 'sec' }, '서평');
    var sum = h('p', { class: 'secline' });
    var list = h('div', null, h('p', { class: 'empty' }, '불러오는 중…'));
    var writeBox = h('div');
    var wbtn = h('button', { class: 'btn ghost', type: 'button' }, '서평 남기기');
    add(root, [head, sum, h('div', null, wbtn), writeBox, list]);
    function load() {
      revCache = null;
      reviews().then(function (rows) {
        var mine = rows ? rows.filter(function (r) { return r.book_slug === slug; }) : null;
        if (mine) {
          var n = mine.length;
          sum.textContent = n >= 3 ? '★ ' + (mine.reduce(function (s, r) { return s + r.rating; }, 0) / n).toFixed(1) + ' · 서평 ' + n : '서평 ' + n;
        }
        revInto(list, mine, 0, false);
      });
    }
    wbtn.addEventListener('click', function () {
      wbtn.style.display = 'none';
      function showForm() { writeBox.textContent = ''; add(writeBox, reviewForm(b, function () { load(); })); }
      if (ACC) showForm(); else { writeBox.textContent = ''; add(writeBox, h('p', { class: 'secline' }, '서평은 로그인한 멤버만 남길 수 있습니다. 처음이면 이름과 비밀번호를 정해 한 번만 가입하면 됩니다.')); add(writeBox, accountForms(showForm)); }
    });
    load();
    if (write) { wbtn.click(); setTimeout(function () { head.scrollIntoView(); }, 0); }
  }

  function run(btn, msg, check, send, done) {
    msg.className = 'msg'; msg.textContent = '';
    var bad = check(); if (bad) { msg.className = 'msg err'; msg.textContent = bad; return; }
    btn.disabled = true; msg.textContent = '잠시만요…';
    send().then(function (res) {
      btn.disabled = false;
      if (res && res.ok) { msg.textContent = ''; done(res); return; }
      var e = (res && res.error) || 'network';
      if (e === 'login_required') setAcc(null);
      msg.className = 'msg err'; msg.textContent = ERR[e] || ERR.network;
    });
  }
  function reviewForm(b, done) {
    var rating = 0;
    var btns = [1, 2, 3, 4, 5].map(function (n) {
      return h('button', { type: 'button', 'aria-label': n + '점', 'aria-pressed': 'false', onclick: function () { rating = n; paint(); } }, '☆');
    });
    function paint() { btns.forEach(function (x, i) { var on = i < rating; x.className = on ? 'on' : ''; x.textContent = on ? '★' : '☆'; x.setAttribute('aria-pressed', on ? 'true' : 'false'); }); }
    var one = h('input', { maxlength: '100', placeholder: '이 책을 한 줄로 말한다면' });
    var body = h('textarea', { maxlength: '3000', placeholder: '조금 더 길게 남기고 싶다면 (선택)' });
    var msg = h('div', { class: 'msg', role: 'status' });
    var btn = h('button', { class: 'btn', type: 'submit' }, '서평 올리기');
    var f = h('form', { class: 'fm', novalidate: true },
      h('div', { class: 'secline', style: 'margin:0' }, h('b', null, ACC.name), ' 이름으로 올립니다.'),
      h('label', null, '별점', h('div', { class: 'rate' }, btns)), h('label', null, '한줄평', one), h('label', null, '서평 (선택)', body),
      h('div', null, btn), msg);
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      run(btn, msg, function () { return !rating ? '별점을 골라 주세요.' : !one.value.trim() ? '한줄평을 적어 주세요.' : null; },
        function () { return rpc('m_add_review', { p_token: ACC.t, p_book_slug: b.slug, p_rating: rating, p_one_liner: one.value.trim(), p_body: body.value.trim() || null }); },
        function () { rating = 0; paint(); one.value = ''; body.value = ''; msg.className = 'msg ok'; msg.textContent = '서평이 올라갔습니다. 고맙습니다.'; done(); });
    });
    return f;
  }
  function accountForms(after) {
    var wrap = h('div');
    function finish(res) { setAcc({ t: res.token, id: res.id, name: res.name }); after(); }
    var ln = h('input', { type: 'text', autocomplete: 'username', maxlength: String(NAME_MAX), autocapitalize: 'off' });
    var lp = h('input', { type: 'password', autocomplete: 'current-password', maxlength: '72' });
    var lm = h('div', { class: 'msg', role: 'status' }), lb = h('button', { class: 'btn', type: 'submit' }, '로그인');
    var lf = h('form', { class: 'fm', novalidate: true }, h('label', null, '이름 또는 별명', ln), h('label', null, '비밀번호', lp), h('div', null, lb), lm);
    lf.addEventListener('submit', function (e) {
      e.preventDefault();
      run(lb, lm, function () { return !cleanName(ln.value) ? ERR.invalid_name : !lp.value ? '비밀번호를 적어 주세요.' : null; },
        function () { return rpc('login', { p_name: cleanName(ln.value), p_password: lp.value }); }, finish);
    });
    var rn = h('input', { type: 'text', autocomplete: 'username', maxlength: String(NAME_MAX), placeholder: '예: 김집사, 들꽃' });
    var rp = h('input', { type: 'password', autocomplete: 'new-password', maxlength: '72' });
    var rp2 = h('input', { type: 'password', autocomplete: 'new-password', maxlength: '72' });
    var rm = h('div', { class: 'msg', role: 'status' }), rbt = h('button', { class: 'btn ghost', type: 'submit' }, '가입하기');
    var rf = h('form', { class: 'fm', novalidate: true },
      h('label', null, h('span', null, '이름 또는 별명 ', h('small', null, '서평에 이 이름이 보입니다. 20자까지.')), rn),
      h('label', null, h('span', null, '비밀번호 ', h('small', null, '4자 이상')), rp), h('label', null, '비밀번호 한 번 더', rp2), h('div', null, rbt), rm);
    rf.addEventListener('submit', function (e) {
      e.preventDefault();
      run(rbt, rm, function () {
        if (!cleanName(rn.value)) return ERR.invalid_name;
        if (rp.value.length < 4) return ERR.weak_password;
        return rp.value !== rp2.value ? '비밀번호가 서로 다릅니다.' : null;
      }, function () { return rpc('register', { p_code: '', p_name: cleanName(rn.value), p_password: rp.value }); }, function (res) {
        // migrate_06 (가입 승인): a new sign-up waits for a host and gets no token.
        if (res.pending || !res.token) { rn.value = rp.value = rp2.value = ''; rm.className = 'msg ok'; rm.textContent = ERR.pending_approval; return; }
        finish(res);
      });
    });
    add(wrap, [lf, h('p', { class: 'or' }, '처음이신가요? 한 번만 가입하면 됩니다.'), rf]);
    return wrap;
  }
  function viewAccount(root) {
    add(root, h('h1', { class: 'pg' }, '내 계정'));
    if (ACC) {
      var m = h('div', { class: 'msg', role: 'status' });
      var b = h('button', { class: 'btn ghost', type: 'button' }, '로그아웃');
      b.addEventListener('click', function () {
        b.disabled = true;
        rpc('logout', { p_token: ACC.t }).then(function () { setAcc(null); location.hash = '#/'; location.reload(); });
      });
      add(root, [h('p', { class: 'sub' }, h('b', null, ACC.name), ' 이름으로 로그인되어 있습니다. 이 기기에서 로그아웃할 때까지 유지됩니다.'), b, m]);
      add(root, installHint());
      myAccount(root);
      return;
    }
    add(root, h('p', { class: 'sub' }, '기록은 누구나 읽을 수 있고, 서평은 로그인한 멤버만 남길 수 있습니다.'));
    add(root, accountForms(function () { route(); }));
  }
  function myAccount(root) {
    var attBox = h('div', null, h('p', { class: 'empty' }, '불러오는 중…'));
    var revBox = h('div', null, h('p', { class: 'empty' }, '불러오는 중…'));
    add(root, [h('h2', { class: 'sec' }, '출석'), attBox, h('h2', { class: 'sec' }, '내가 쓴 서평'), revBox]);
    myAtt().then(function (r) {
      if (r && r.ok && r.is_host) hostApprovals(root);
      attBox.textContent = '';
      if (r && r.error === 'missing') { add(attBox, h('p', { class: 'empty' }, '출석체크는 준비 중입니다.')); return; }
      if (!r || !r.ok) { add(attBox, h('p', { class: 'empty' }, ERR[r && r.error] || ERR.network)); return; }
      add(attBox, stampBox(false));
    });
    reviews().then(function (rows) {
      revBox.textContent = '';
      if (rows == null) { add(revBox, h('p', { class: 'empty' }, ERR.network)); return; }
      var mine = rows.filter(function (x) { return x.member_id === ACC.id; });   // already newest first
      if (!mine.length) { add(revBox, h('p', { class: 'empty' }, '아직 남긴 서평이 없습니다. 함께 읽은 책에서 서평을 남겨 보세요.')); return; }
      add(revBox, h('p', { class: 'secline' }, '서평 ' + mine.length + '편'));
      add(revBox, h('div', { class: 'rows' }, mine.map(function (x) {
        var b = BY[x.book_slug] || { slug: x.book_slug, title: x.book_slug, author: '', cover: '', tone: '' };
        return h('a', { class: 'row', href: '#/book/' + b.slug }, cover(b),
          h('div', null, h('div', { class: 't' }, b.title), h('div', { class: 'st', 'aria-label': x.rating + '점' }, stars(x.rating)),
            h('div', { class: 'h' }, x.one_liner || ''), h('div', { class: 'd' }, dot((x.created_at || '').slice(0, 10)))));
      })));
    });
  }
  // 가입 승인 (hosts only; needs supabase/migrate_06_approval.sql — hidden until then)
  function hostApprovals(root) {
    rpc('m_host_pending', { p_token: ACC.t }).then(function (r) {
      if (!r || !r.ok) return;
      var box = h('div');
      add(root, [h('h2', { class: 'sec' }, '가입 승인'), h('p', { class: 'secline' }, '진행자에게만 보입니다. 승인하면 그분이 바로 로그인할 수 있습니다.'), box]);
      function draw(rows) {
        box.textContent = '';
        if (!rows.length) { add(box, h('p', { class: 'empty' }, '승인을 기다리는 가입 신청이 없습니다.')); return; }
        add(box, h('div', { class: 'rows' }, rows.map(function (x) {
          var msg = h('span', { class: 'msg', role: 'status' });
          var ok = h('button', { class: 'btn sm', type: 'button' }, '승인');
          var no = h('button', { class: 'btn sm ghost', type: 'button' }, '거절');
          function act(approve) {
            if (!approve && !window.confirm(x.name + ' 님의 가입 신청을 거절할까요?')) return;
            ok.disabled = no.disabled = true;
            rpc('m_host_approve', { p_token: ACC.t, p_member: x.id, p_approve: approve }).then(function (y) {
              if (y && y.ok) { rows = rows.filter(function (z) { return z.id !== x.id; }); draw(rows); return; }
              ok.disabled = no.disabled = false; msg.className = 'msg err'; msg.textContent = ERR[y && y.error] || ERR.network;
            });
          }
          ok.addEventListener('click', function () { act(true); });
          no.addEventListener('click', function () { act(false); });
          return h('div', { class: 'row nocv' }, h('div', null, h('div', { class: 't' }, x.name),
            h('div', { class: 'd' }, '신청 ' + dot(String(x.created_at || '').slice(0, 10))),
            h('div', { class: 'att', style: 'margin-top:6px' }, ok, no, msg)));
        })));
      }
      draw(r.rows || []);
    });
  }
  function viewReviews(root) {
    add(root, h('h1', { class: 'pg' }, '서평'));
    var sub = h('p', { class: 'sub' }, '함께 읽은 책에 멤버들이 남긴 한 줄과 서평입니다.');
    var box = h('div', null, h('p', { class: 'empty' }, '불러오는 중…'));
    add(root, [sub, box]);
    reviews().then(function (rows) { revInto(box, rows, 0, true); });
  }

  // ---------- router ----------
  function route() {
    var parts = location.hash.replace(/^#\/?/, '').split('/').map(function (x) { try { return decodeURIComponent(x); } catch (e) { return x; } });
    var root = document.getElementById('app'); root.textContent = ''; attPainters = []; hintPainters = [];
    closeSheet();
    var tab = parts[0] === 'library' || parts[0] === 'book' ? 'library' : parts[0] === 'reviews' ? 'reviews' : parts[0] === 'account' ? 'account' : 'home';
    [].forEach.call(document.querySelectorAll('[data-tab]'), function (a) { a.classList.toggle('on', a.getAttribute('data-tab') === tab); });
    if (parts[0] === 'library') viewLibrary(root, parts[1] === 'date');
    else if (parts[0] === 'book') viewBook(root, parts[1], parts[2] === 'write');
    else if (parts[0] === 'reviews') viewReviews(root);
    else if (parts[0] === 'account') viewAccount(root);
    else viewHome(root);
    if (!(parts[0] === 'book' && parts[2] === 'write')) window.scrollTo(0, 0);
  }
  var FS = [1, 1.125, 1.25, 1.375];
  function fsGet() { var v = parseFloat(lget('blk_fs')); return FS.indexOf(v) >= 0 ? v : 1; }
  function fsApply() {
    var v = fsGet(), i = FS.indexOf(v);
    document.documentElement.style.fontSize = v === 1 ? '' : (v * 100) + '%';
    [].forEach.call(document.querySelectorAll('[data-fs]'), function (b) { b.disabled = +b.getAttribute('data-fs') < 0 ? i <= 0 : i >= FS.length - 1; });
  }
  [].forEach.call(document.querySelectorAll('[data-fs]'), function (b) {
    b.addEventListener('click', function () {
      var i = FS.indexOf(fsGet()) + (+b.getAttribute('data-fs'));
      if (i < 0 || i >= FS.length) return;
      lset('blk_fs', FS[i] === 1 ? '' : String(FS[i])); fsApply();
    });
  });
  fsApply();
  window.addEventListener('hashchange', route);
  route();
})();
