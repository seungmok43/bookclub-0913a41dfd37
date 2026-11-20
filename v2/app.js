/* BooKLove v2 preview — one site, four screens (홈 · 서재 · 책 · 내 계정) + 서평 list.
   Data: v2/data.js (built by v2/build_data.py), v2/groups.js (draft curation), community/config.js.
   Writes reuse the existing Supabase RPCs (login / register / logout / m_add_review) and the same
   localStorage key `blk_acct` as community/app.js, so a login here carries to the real pages. */
(function () {
  'use strict';
  var CFG = window.BOOKLOVE_CONFIG || {};
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
  function setAcc(a) { ACC = a; lset(ACC_KEY, a ? JSON.stringify(a) : ''); }
  function cleanName(v) { return (v || '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX); }
  function dot(d) { return d.replace(/-/g, '.'); }
  function stars(n) { n = Math.round(n); return '★★★★★'.slice(0, n) + '☆☆☆☆☆'.slice(0, 5 - n); }
  function cover(b) {
    if (b.cover) return h('div', { class: 'cv' }, h('img', { src: '../' + b.cover, alt: b.title + ' 표지', loading: 'lazy' }));
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
      .then(function (r) { return r.json().catch(function () { return null; }).then(function (j) { if (!r.ok) throw new Error('http ' + r.status); return j; }); });
  }
  function rpc(name, body) {
    if (!LIVE) return Promise.resolve({ ok: false, error: 'network' });
    return api('/rest/v1/rpc/' + name, body).then(function (j) { return j && typeof j === 'object' ? j : { ok: false, error: 'network' }; },
      function () { return { ok: false, error: 'network' }; });
  }
  var revCache = null;
  function reviews() {
    if (!LIVE) return Promise.resolve([]);
    if (!revCache) revCache = api('/rest/v1/reviews?select=id,book_slug,rating,one_liner,body,nickname,member_id,created_at&order=created_at.desc&limit=1000')
      .catch(function () { revCache = null; return null; });
    return revCache;
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
    return h('a', { class: 'row nocv', href: '../' + s.href },
      h('div', null, showBook ? h('div', { class: 't' }, b.title) : null, h('div', { class: 'h' }, s.hook), h('div', { class: 'd' }, when + ' · 기록 읽기 →')));
  }

  // ---------- screens ----------
  function viewHome(root) {
    var open = allSessions().filter(function (x) { return !x.s.locked; });
    var top = open[0];
    if (top) add(root, h('section', { class: 'hero' }, cover(top.b),
      h('div', null, h('div', { class: 'eb' }, '이번 주 기록'), h('h2', null, top.b.title),
        h('div', { class: 'when' }, dot(top.s.date) + ' (' + top.s.day + ') · ' + top.s.round + '회')),
      h('p', { class: 'hook' }, top.s.hook),
      h('div', { class: 'go' }, h('a', { class: 'btn', href: '../' + top.s.href }, '읽기'))));

    var cbs = CFG.currentBooks || (CFG.currentBook ? [CFG.currentBook] : []);
    if (cbs.length) {
      add(root, h('h2', { class: 'sec' }, '지금 읽는 책'));
      add(root, h('div', { class: 'now' }, cbs.map(function (c) {
        var b = BY[c.slug] || { slug: c.slug, title: c.title, author: c.author, cover: (c.cover || ''), tone: '' };
        var fri = /금/.test(c.group || '');
        return h('a', { class: 'nowc', href: '#/book/' + c.slug }, cover(b),
          h('div', null, h('span', { class: 'g ' + (fri ? 'f' : 'w') }, c.group || ''), h('b', null, c.title || b.title),
            h('span', { class: 'm' }, c.author || b.author), c.nextMeeting ? h('span', { class: 'm' }, '다음 모임 · ' + c.nextMeeting) : null));
      })));
    }

    if ((GR.groups || []).length) add(root, h('h2', { class: 'sec' }, '삶의 질문으로 고르기'));
    (GR.groups || []).forEach(function (g) {
      var list = (g.slugs || []).map(function (s) { return BY[s]; }).filter(Boolean);
      if (!list.length) return;
      var rows = h('div', { class: 'rows' }, list.slice(0, 4).map(bookRow));
      var box = h('section', { class: 'grp' }, h('h3', null, g.q, GR.draft ? h('span', { class: 'tag' }, '초안') : null),
        g.line ? h('p', { class: 'l' }, g.line) : null, rows);
      if (list.length > 4) {
        var more = h('button', { class: 'more', type: 'button', style: 'background:none;border:0;cursor:pointer;font:inherit;font-weight:700;color:var(--accent)' }, '더 보기 (' + (list.length - 4) + ')');
        more.addEventListener('click', function () { list.slice(4).forEach(function (b) { add(rows, bookRow(b)); }); more.remove(); });
        add(box, more);
      }
      add(root, box);
    });

    // Trust line rule: N = every meeting listed in community/catalog.js (open + locked sessions);
    // M = books that have at least one such session; first year = earliest session date.
    var all = allSessions();
    var N = all.length, M = BOOKS.filter(function (b) { return b.sessions.length > 0; }).length;
    var first = all.length ? all[all.length - 1].s.date.slice(0, 4) : '';
    add(root, h('p', { class: 'trust' }, first + '년부터 ' + N + '번 모였고, ' + M + '권을 함께 읽었습니다'));

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

  function viewBook(root, slug) {
    var b = BY[slug];
    if (!b) { add(root, h('p', { class: 'empty' }, '책을 찾을 수 없습니다.'), h('a', { class: 'more', href: '#/library' }, '함께 읽은 책으로 →')); return; }
    add(root, h('div', { class: 'bhead' }, cover(b), h('div', null, h('h1', null, b.title), h('div', { class: 'a' }, b.author),
      h('div', { class: 'a' }, b.period + (b.sessions.length ? ' · 모임 ' + b.sessions.length + '회' : '')),
      h('a', { class: 'blink', href: '../' + b.href }, '이 책 정리 페이지 →'))));
    if (b.hook) add(root, h('p', { class: 'bone' }, b.hook));
    var fw = (GR.forWhom || {})[slug];
    if (fw) add(root, h('div', { class: 'who' }, h('b', null, '이런 분께 '), fw, GR.draft ? h('span', { class: 'tag' }, '초안') : null));

    add(root, h('h2', { class: 'sec' }, '모임 기록'));
    if (!b.sessions.length) add(root, h('p', { class: 'empty' }, '이 책은 회차별 기록 대신 정리 페이지 한 곳에 모여 있습니다.'));
    else add(root, h('div', { class: 'rows' }, b.sessions.slice().sort(function (x, y) { return x.date < y.date ? -1 : 1; })
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
      return h('button', { type: 'button', 'aria-label': n + '점', onclick: function () { rating = n; paint(); } }, '★');
    });
    function paint() { btns.forEach(function (x, i) { x.className = i < rating ? 'on' : ''; }); }
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
      }, function () { return rpc('register', { p_code: '', p_name: cleanName(rn.value), p_password: rp.value }); }, finish);
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
        rpc('logout', { p_token: ACC.t }).then(function () { setAcc(null); route(); });
      });
      add(root, h('p', { class: 'sub' }, h('b', null, ACC.name), ' 이름으로 로그인되어 있습니다. 이 기기에서 로그아웃할 때까지 유지됩니다.'), b, m);
      return;
    }
    add(root, h('p', { class: 'sub' }, '기록은 누구나 읽을 수 있고, 서평은 로그인한 멤버만 남길 수 있습니다.'));
    add(root, accountForms(function () { route(); }));
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
    var root = document.getElementById('app'); root.textContent = '';
    var tab = parts[0] === 'library' || parts[0] === 'book' ? 'library' : parts[0] === 'reviews' ? 'reviews' : parts[0] === 'account' ? 'account' : 'home';
    [].forEach.call(document.querySelectorAll('[data-tab]'), function (a) { a.classList.toggle('on', a.getAttribute('data-tab') === tab); });
    if (parts[0] === 'library') viewLibrary(root, parts[1] === 'date');
    else if (parts[0] === 'book') viewBook(root, parts[1]);
    else if (parts[0] === 'reviews') viewReviews(root);
    else if (parts[0] === 'account') viewAccount(root);
    else viewHome(root);
    window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', route);
  route();
})();
