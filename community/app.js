/* BooKLove community — library, reviews, anonymous sharing, resources.
 * Plain JS, no build step. User text is always inserted as text nodes (never as HTML).
 * Data: Supabase REST when config has url + anon key (실제 모드), else localStorage (체험 모드).
 */
(function () {
  'use strict';
  var CFG = window.BOOKLOVE_CONFIG || {};
  var BOOKS = window.BOOKLOVE_CATALOG || [];
  // A current book that has no folder yet (just started) is added from config.js.
  (function () {
    var cb = CFG.currentBook || {};
    if (!cb.slug || !cb.title) return;
    for (var i = 0; i < BOOKS.length; i++) if (BOOKS[i].slug === cb.slug) return;
    BOOKS.unshift({ slug: cb.slug, title: cb.title, author: cb.author || '', cover: cb.cover || '', sessions: [] });
  })();
  var LIVE = !!(CFG.supabaseUrl && CFG.supabaseAnonKey);
  var CLUB_KEY = 'blk_club';            // club code, kept on this device after it opens the page
  var ACC_KEY = 'blk_acct';             // { t: login token, id, name } — kept on this device
  var LS_KEY = 'booklove_community_demo_v1';
  var LIMITS = { one: 100, review: 3000, title: 60, post: 4000, comment: 1000 };
  var NICK = ['책갈피', '연필', '등불', '찻잔', '오솔길', '들꽃', '창가', '담요', '새벽빛', '종이배', '나무그늘', '밤하늘'];

  // ---------- small helpers ----------
  function $(id) { return document.getElementById(id); }
  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      var v = attrs[k];
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (var i = 2; i < arguments.length; i++) add(el, arguments[i]);
    return el;
  }
  function add(el, c) {
    if (c == null || c === false) return;
    if (Array.isArray(c)) { c.forEach(function (x) { add(el, x); }); return; }
    el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
  function bookBy(slug) { for (var i = 0; i < BOOKS.length; i++) if (BOOKS[i].slug === slug) return BOOKS[i]; return null; }
  function bookName(b) { return (b && b.title) || '제목 미확인'; }
  function dot(d) { return d.replace(/-/g, '.'); }
  function fmtTime(iso) {
    var d = new Date(iso); if (isNaN(d)) return '';
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + '.' + p(d.getMonth() + 1) + '.' + p(d.getDate());
  }
  function starText(n) { var r = Math.round(n); return '★★★★★'.slice(0, r) + '☆☆☆☆☆'.slice(0, 5 - r); }
  function nickname() { return NICK[Math.floor(Math.random() * NICK.length)] + ' ' + (1 + Math.floor(Math.random() * 99)); }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function cover(b, cls) {
    if (b && b.cover) return h('img', { class: cls || 'cv', src: '../' + b.cover, alt: bookName(b) + ' 표지', loading: 'lazy' });
    return h('div', { class: 'ph' }, bookName(b));
  }
  function sget(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }
  function sset(k, v) { try { sessionStorage.setItem(k, v); } catch (e) { } }
  function avgOf(list) {
    if (!list.length) return 0;
    return list.reduce(function (s, r) { return s + r.rating; }, 0) / list.length;
  }

  // ---------- data layer ----------
  var ERR = {
    invalid_code: '입장 코드가 맞지 않습니다. 모임에서 받은 코드를 확인해 주세요.',
    no_code: '입장 코드를 입력해 주세요.',
    bad_login: '이름 또는 비밀번호가 맞지 않습니다.',
    name_taken: '이미 쓰이는 이름입니다. 다른 이름이나 별명을 정해 주세요.',
    invalid_name: '이름이나 별명을 적어 주세요.',
    weak_password: '비밀번호는 4자 이상으로 정해 주세요.',
    login_required: '로그인이 필요합니다. 다시 로그인해 주세요.',
    rate_limited: '짧은 시간에 글이 많이 올라왔어요. 잠시 후 다시 시도해 주세요.',
    invalid_input: '입력한 내용을 다시 확인해 주세요.',
    not_found: '글을 찾을 수 없습니다.',
    network: '연결이 원활하지 않습니다. 잠시 후 다시 시도해 주세요.'
  };

  var Demo = {
    load: function () {
      try { var d = JSON.parse(localStorage.getItem(LS_KEY)); if (d && d.reviews) return d; } catch (e) { }
      return { reviews: [], posts: [], comments: [], members: [] };
    },
    save: function (d) { try { localStorage.setItem(LS_KEY, JSON.stringify(d)); return true; } catch (e) { return false; } },
    write: function (fn) {
      var d = Demo.load(); var res = fn(d);
      if (res.ok && !Demo.save(d)) return { ok: false, error: 'network' };
      return res;
    }
  };

  function api(path, opts) {
    opts = opts || {};
    var headers = { apikey: CFG.supabaseAnonKey, Authorization: 'Bearer ' + CFG.supabaseAnonKey };
    if (opts.body) headers['Content-Type'] = 'application/json';
    return fetch(CFG.supabaseUrl.replace(/\/$/, '') + path, {
      method: opts.body ? 'POST' : 'GET', headers: headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined
    }).then(function (r) {
      return r.json().catch(function () { return null; }).then(function (j) {
        if (!r.ok) throw new Error('http ' + r.status);
        return j;
      });
    });
  }
  function rpc(name, body) {
    return api('/rest/v1/rpc/' + name, { body: body }).then(function (j) {
      return j && typeof j === 'object' ? j : { ok: false, error: 'network' };
    }, function () { return { ok: false, error: 'network' }; });
  }

  function tok() { return ACC ? ACC.t : ''; }
  function demoMe(d) { return ACC ? (d.members || []).filter(function (m) { return m.id === ACC.id; })[0] : null; }
  function demoMine(list, id) { return list.filter(function (x) { return x.id === id && ACC && x.member_id === ACC.id; })[0]; }
  var SEL_R = 'id,book_slug,rating,one_liner,body,nickname,member_id,created_at,updated_at';

  var Store = {
    reviews: function (slug) {
      if (!LIVE) return Promise.resolve(Demo.load().reviews.filter(function (r) { return !slug || r.book_slug === slug; })
        .sort(function (a, b) { return a.created_at < b.created_at ? 1 : -1; }));
      return api('/rest/v1/reviews?select=' + SEL_R + '&order=created_at.desc&limit=1000' +
        (slug ? '&book_slug=eq.' + encodeURIComponent(slug) : ''));
    },
    posts: function () {
      if (!LIVE) {
        var d = Demo.load();
        return Promise.resolve(d.posts.map(function (p) {
          var n = d.comments.filter(function (c) { return c.post_id === p.id; }).length;
          return Object.assign({}, p, { comment_count: n });
        }).sort(function (a, b) { return a.created_at < b.created_at ? 1 : -1; }));
      }
      return api('/rest/v1/posts?select=id,title,body,nickname,member_id,created_at,comments(count)&order=created_at.desc&limit=300')
        .then(function (rows) {
          return rows.map(function (p) {
            p.comment_count = p.comments && p.comments[0] ? p.comments[0].count : 0; return p;
          });
        });
    },
    post: function (id) {
      if (!LIVE) {
        var d = Demo.load();
        var p = d.posts.filter(function (x) { return x.id === id; })[0] || null;
        var cs = d.comments.filter(function (c) { return c.post_id === id; })
          .sort(function (a, b) { return a.created_at > b.created_at ? 1 : -1; });
        return Promise.resolve({ post: p, comments: cs });
      }
      var q = encodeURIComponent(id);
      return Promise.all([
        api('/rest/v1/posts?select=id,title,body,nickname,member_id,created_at,updated_at&id=eq.' + q),
        api('/rest/v1/comments?select=id,post_id,body,nickname,member_id,created_at&order=created_at.asc&post_id=eq.' + q)
      ]).then(function (r) { return { post: r[0][0] || null, comments: r[1] }; });
    },

    // ----- entrance and account -----
    checkCode: function (code) {
      if (!LIVE) return Promise.resolve({ ok: true });
      return rpc('check_code', { p_code: code });
    },
    register: function (code, name, pw) {
      if (!LIVE) return Promise.resolve(Demo.write(function (d) {
        d.members = d.members || [];
        if (d.members.some(function (m) { return m.name.toLowerCase() === name.toLowerCase(); })) return { ok: false, error: 'name_taken' };
        var m = { id: uid(), name: name, pw: pw }; d.members.push(m);
        return { ok: true, token: 'demo', id: m.id, name: m.name };
      }));
      return rpc('register', { p_code: code, p_name: name, p_password: pw });
    },
    login: function (name, pw) {
      if (!LIVE) {
        var m = (Demo.load().members || []).filter(function (x) { return x.name.toLowerCase() === name.toLowerCase() && x.pw === pw; })[0];
        return Promise.resolve(m ? { ok: true, token: 'demo', id: m.id, name: m.name } : { ok: false, error: 'bad_login' });
      }
      return rpc('login', { p_name: name, p_password: pw });
    },
    me: function () {
      if (!LIVE) { var m = demoMe(Demo.load()); return Promise.resolve(m ? { ok: true, id: m.id, name: m.name } : { ok: false, error: 'login_required' }); }
      return rpc('me', { p_token: tok() });
    },
    logout: function () {
      if (!LIVE) return Promise.resolve({ ok: true });
      return rpc('logout', { p_token: tok() });
    },
    changePw: function (oldPw, newPw) {
      if (!LIVE) return Promise.resolve(Demo.write(function (d) {
        var m = demoMe(d); if (!m) return { ok: false, error: 'login_required' };
        if (m.pw !== oldPw) return { ok: false, error: 'bad_login' };
        m.pw = newPw; return { ok: true };
      }));
      return rpc('change_password', { p_token: tok(), p_old: oldPw, p_new: newPw });
    },

    // ----- member writes -----
    addReview: function (x) {
      if (!LIVE) return Promise.resolve(Demo.write(function (d) {
        var m = demoMe(d); if (!m) return { ok: false, error: 'login_required' };
        var row = { id: uid(), book_slug: x.slug, rating: x.rating, one_liner: x.one, body: x.body || null,
          nickname: m.name, member_id: m.id, created_at: new Date().toISOString() };
        d.reviews.push(row); return { ok: true, id: row.id };
      }));
      return rpc('m_add_review', { p_token: tok(), p_book_slug: x.slug, p_rating: x.rating, p_one_liner: x.one, p_body: x.body || null });
    },
    editReview: function (x) {
      if (!LIVE) return Promise.resolve(Demo.write(function (d) {
        var r = demoMine(d.reviews, x.id); if (!r) return { ok: false, error: 'not_found' };
        r.rating = x.rating; r.one_liner = x.one; r.body = x.body || null; r.updated_at = new Date().toISOString();
        return { ok: true };
      }));
      return rpc('m_edit_review', { p_token: tok(), p_id: x.id, p_rating: x.rating, p_one_liner: x.one, p_body: x.body || null });
    },
    addPost: function (x) {
      if (!LIVE) return Promise.resolve(Demo.write(function (d) {
        var m = demoMe(d); if (!m) return { ok: false, error: 'login_required' };
        var row = { id: uid(), title: x.title, body: x.body, nickname: m.name, member_id: m.id, created_at: new Date().toISOString() };
        d.posts.push(row); return { ok: true, id: row.id };
      }));
      return rpc('m_add_post', { p_token: tok(), p_title: x.title, p_body: x.body });
    },
    editPost: function (x) {
      if (!LIVE) return Promise.resolve(Demo.write(function (d) {
        var p = demoMine(d.posts, x.id); if (!p) return { ok: false, error: 'not_found' };
        p.title = x.title; p.body = x.body; p.updated_at = new Date().toISOString(); return { ok: true };
      }));
      return rpc('m_edit_post', { p_token: tok(), p_id: x.id, p_title: x.title, p_body: x.body });
    },
    addComment: function (x) {
      if (!LIVE) return Promise.resolve(Demo.write(function (d) {
        var m = demoMe(d); if (!m) return { ok: false, error: 'login_required' };
        if (!d.posts.some(function (p) { return p.id === x.postId; })) return { ok: false, error: 'not_found' };
        var row = { id: uid(), post_id: x.postId, body: x.body, nickname: m.name, member_id: m.id, created_at: new Date().toISOString() };
        d.comments.push(row); return { ok: true, id: row.id };
      }));
      return rpc('m_add_comment', { p_token: tok(), p_post_id: x.postId, p_body: x.body });
    },
    del: function (kind, id) {
      if (!LIVE) return Promise.resolve(Demo.write(function (d) {
        var key = { review: 'reviews', post: 'posts', comment: 'comments' }[kind];
        if (!demoMine(d[key], id)) return { ok: false, error: 'not_found' };
        d[key] = d[key].filter(function (x) { return x.id !== id; });
        if (kind === 'post') d.comments = d.comments.filter(function (c) { return c.post_id !== id; });
        return { ok: true };
      }));
      return rpc('m_delete', { p_token: tok(), p_kind: kind, p_id: id });
    }
  };

  // ---------- account & shared form pieces ----------
  var NAME_MAX = 20;
  function lget(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lset(k, v) { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch (e) { } }
  function cleanName(v) { return (v || '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX); }
  var ACC = (function () {
    try { var a = JSON.parse(localStorage.getItem(ACC_KEY)); return a && a.t && a.id ? a : null; } catch (e) { return null; }
  })();
  function setAcc(a) { ACC = a; lset(ACC_KEY, a ? JSON.stringify(a) : ''); drawAcct(); }
  function drawAcct() { var el = $('acct'); if (el) el.textContent = ACC ? ACC.name : '로그인'; }
  function mine(row) { return !!(ACC && row && row.member_id && row.member_id === ACC.id); }
  function goLogin() { sset('blk_return', location.hash || '#/'); location.hash = '#/account'; }
  function whoLine() { return h('div', { class: 'who' }, h('b', null, ACC.name), ' 이름으로 올립니다.'); }
  function loginPrompt(what) {
    return h('div', { class: 'login-ask' },
      h('p', null, what + ' 로그인해 주세요. 처음이면 이름과 비밀번호를 정해 한 번만 가입하면 됩니다.'),
      h('button', { class: 'btn', type: 'button', onclick: goLogin }, '로그인 · 가입'));
  }
  function pwInput(ac) { return h('input', { type: 'password', autocomplete: ac, maxlength: '72' }); }
  // Runs a request: shows the check message, disables the button, shows the result.
  function run(btn, msg, check, send, done) {
    msg.className = 'msg'; msg.textContent = '';
    var bad = check(); if (bad) { msg.className = 'msg err'; msg.textContent = bad; return; }
    btn.disabled = true; msg.textContent = '잠시만요…';
    send().then(function (res) {
      btn.disabled = false;
      if (res && res.ok) { msg.textContent = ''; done(res); return; }
      var e = (res && res.error) || 'network';
      msg.className = 'msg err'; msg.textContent = ERR[e] || ERR.network;
      if (e === 'login_required') setAcc(null);
    });
  }
  // A write needs a login.
  function submitWith(btn, msg, check, send, done) {
    if (!ACC) { goLogin(); return; }
    run(btn, msg, check, send, done);
  }
  function delBtn(kind, id, label, after) {
    return h('button', { type: 'button', class: 'lnk', onclick: function () {
      if (!window.confirm(label + ' 지울까요? 지운 글은 되살릴 수 없습니다.')) return;
      Store.del(kind, id).then(function (res) {
        if (res && res.ok) after(); else if (res && res.error === 'login_required') { setAcc(null); goLogin(); }
        else window.alert(ERR[(res && res.error)] || ERR.network);
      });
    } }, '지우기');
  }
  function counter(input, max) {
    var c = h('span', { class: 'hint' }, '0 / ' + max);
    input.addEventListener('input', function () { c.textContent = input.value.length + ' / ' + max; });
    return c;
  }
  function loading() { return h('p', { class: 'muted small' }, '불러오는 중…'); }
  function failed() { return h('p', { class: 'empty' }, ERR.network); }

  // ---------- views ----------
  function viewHome(root) {
    var cb = CFG.currentBook || {};
    var b = bookBy(cb.slug);
    if (b) {
      var last = b.sessions.length ? b.sessions[b.sessions.length - 1] : null;
      root.appendChild(h('section', { class: 'card now' },
        cover(b),
        h('div', null,
          h('div', { class: 'lbl' }, '지금 읽는 책 ', cb.example ? h('span', { class: 'badge' }, '예시') : null),
          h('h2', null, bookName(b)),
          b.author ? h('div', { class: 'muted small' }, b.author) : null,
          h('dl', null,
            cb.note ? [h('dt', null, '모임'), h('dd', null, cb.note)] : null,
            h('dt', null, '다음 모임'), h('dd', null, cb.nextMeeting || '미정'),
            cb.place ? [h('dt', null, '장소'), h('dd', null, cb.place)] : null,
            last ? [h('dt', null, '지난 모임'), h('dd', null, dot(last.date) + ' (' + last.day + ') · ' + last.round + '회')] : null),
          h('div', { class: 'acts' },
            h('a', { class: 'btn', href: '#/book/' + b.slug }, '책 자세히'),
            h('a', { class: 'btn ghost', href: '#/book/' + b.slug + '/write' }, '서평 남기기')))));
    }
    var nSessions = BOOKS.reduce(function (s, x) { return s + x.sessions.length; }, 0);
    root.appendChild(h('section', { class: 'sec quick' },
      h('a', { class: 'card', href: '#/library' }, h('b', null, '서재'), h('span', null, BOOKS.length + '권의 책과 서평')),
      h('a', { class: 'card', href: '#/share' }, h('b', null, '나눔'), h('span', null, '편하게 나누는 이야기')),
      h('a', { class: 'card', href: '#/resources' }, h('b', null, '자료실'), h('span', null, '모임 기록 ' + nSessions + '개')),
      h('a', { class: 'card', href: '../' }, h('b', null, '허브'), h('span', null, '처음 화면으로'))));

    var rsec = h('section', { class: 'sec' }, h('h2', null, '최근 서평'), loading());
    var psec = h('section', { class: 'sec' }, h('h2', null, '최근 나눔'), loading());
    root.appendChild(rsec); root.appendChild(psec);
    Store.reviews().then(function (rows) {
      rsec.lastChild.remove();
      rsec.appendChild(rows.length ? h('div', { class: 'list' }, rows.slice(0, 3).map(function (r) { return reviewItem(r, true); }))
        : h('p', { class: 'empty' }, '아직 남겨진 서평이 없습니다. 서재에서 첫 한 줄을 남겨 주세요.'));
    }, function () { rsec.lastChild.replaceWith(failed()); });
    Store.posts().then(function (rows) {
      psec.lastChild.remove();
      psec.appendChild(rows.length ? h('div', { class: 'list' }, rows.slice(0, 3).map(postItem))
        : h('p', { class: 'empty' }, '아직 나눔 글이 없습니다.'));
    }, function () { psec.lastChild.replaceWith(failed()); });
  }

  function viewLibrary(root) {
    root.appendChild(h('h1', { class: 'h2' }, '서재', h('small', null, '함께 읽은 책 ' + BOOKS.length + '권 · 최근에 읽은 순')));
    var q = h('input', { class: 'search', type: 'search', placeholder: '책 제목이나 저자로 찾기', 'aria-label': '책 찾기' });
    var grid = h('div', { class: 'grid' });
    root.appendChild(q); root.appendChild(grid);
    var stats = {};
    function draw() {
      var term = q.value.trim().toLowerCase();
      grid.textContent = '';
      var shown = BOOKS.filter(function (b) { return !term || (b.title + ' ' + b.author).toLowerCase().indexOf(term) >= 0; });
      shown.forEach(function (b) {
        var st = stats[b.slug];
        var last = b.sessions.length ? b.sessions[b.sessions.length - 1].date.slice(0, 7).replace('-', '.') : '';
        grid.appendChild(h('a', { class: 'bk', href: '#/book/' + b.slug },
          cover(b),
          h('div', { class: 't' }, bookName(b)),
          b.author ? h('div', { class: 'a' }, b.author) : null,
          h('div', { class: 'm' }, (b.sessions.length ? '모임 ' + b.sessions.length + '회 · ' + last : '모임 기록 없음')),
          st ? h('div', { class: 'm' }, h('span', { class: 'stars' }, starText(st.avg)), ' ' + st.avg.toFixed(1) + ' (' + st.n + ')') : null));
      });
      if (!shown.length) grid.appendChild(h('p', { class: 'empty' }, '찾는 책이 없습니다.'));
    }
    q.addEventListener('input', draw);
    draw();
    Store.reviews().then(function (rows) {
      var by = {};
      rows.forEach(function (r) { (by[r.book_slug] = by[r.book_slug] || []).push(r); });
      for (var s in by) stats[s] = { avg: avgOf(by[s]), n: by[s].length };
      draw();
    }, function () { });
  }

  function viewBook(root, slug, focusWrite) {
    var b = bookBy(slug);
    root.appendChild(h('a', { class: 'back', href: '#/library' }, '← 서재'));
    if (!b) { root.appendChild(h('p', { class: 'empty' }, '책을 찾을 수 없습니다.')); return; }
    root.appendChild(h('section', { class: 'bhead' },
      cover(b),
      h('div', null,
        h('h1', null, bookName(b)),
        b.author ? h('div', { class: 'a' }, b.author) : null,
        h('div', { class: 'muted small', style: 'margin-top:6px' },
          b.sessions.length ? '모임에서 ' + b.sessions.length + '회 함께 읽었습니다.' : '모임 기록이 아직 없습니다.'),
        h('div', { class: 'acts' }, h('a', { class: 'btn ghost', href: '../' + b.slug + '/' }, '책 페이지 열기')))));

    if (b.sessions.length) {
      root.appendChild(h('section', { class: 'sec' }, h('h2', null, '모임에서 읽은 날', h('small', null, '누르면 그날의 기록으로')),
        h('div', { class: 'dates' }, b.sessions.slice().reverse().map(function (s) {
          return h('a', { href: '../' + s.href }, h('b', null, s.round + '회'), ' · ' + dot(s.date) + ' (' + s.day + ')');
        }))));
    }

    var sum = h('div', { class: 'card avg' }, loading());
    var list = h('div', { class: 'list' });
    var form = reviewForm(b, function () { refresh(); });
    var sec = h('section', { class: 'sec', id: 'reviews' }, h('h2', null, '멤버 서평'), sum,
      h('div', { class: 'card', style: 'margin-top:12px' }, h('div', { class: 'h2' }, '서평 남기기'), form),
      h('div', { class: 'sec' }, list));
    root.appendChild(sec);
    function refresh() {
      Store.reviews(b.slug).then(function (rows) {
        sum.textContent = ''; list.textContent = '';
        if (rows.length) {
          var a = avgOf(rows);
          add(sum, [h('div', { class: 'n' }, a.toFixed(1)),
            h('div', null, h('div', { class: 'stars' }, starText(a)), h('div', { class: 'muted small' }, '서평 ' + rows.length + '개의 평균'))]);
          rows.forEach(function (r) { list.appendChild(reviewItem(r, false, refresh)); });
        } else {
          add(sum, h('div', { class: 'muted small' }, '아직 서평이 없습니다. 첫 한 줄을 남겨 주세요.'));
        }
      }, function () { sum.textContent = ''; sum.appendChild(failed()); });
    }
    refresh();
    if (focusWrite) setTimeout(function () { form.scrollIntoView({ block: 'start' }); }, 0);
  }

  // edit: an existing review of mine (edit mode), cancel: called by 「취소」 in edit mode.
  function reviewForm(b, done, edit, cancel) {
    if (!ACC) return loginPrompt('서평을 남기려면');
    var rating = edit ? edit.rating : 0;
    var stars = h('div', { class: 'rate', role: 'radiogroup', 'aria-label': '별점' });
    var btns = [1, 2, 3, 4, 5].map(function (n) {
      return h('button', { type: 'button', role: 'radio', 'aria-checked': 'false', 'aria-label': n + '점', 'data-n': String(n),
        onclick: function () { rating = n; paint(); } }, '★');
    });
    function paint() { btns.forEach(function (x, i) { x.className = i < rating ? 'on' : ''; x.setAttribute('aria-checked', String(i + 1 === rating)); }); }
    add(stars, btns); paint();
    var one = h('input', { name: 'one', maxlength: String(LIMITS.one), placeholder: '이 책을 한 줄로 말한다면' });
    var body = h('textarea', { name: 'body', maxlength: String(LIMITS.review), placeholder: '조금 더 길게 남기고 싶다면 (선택)' });
    var c1 = counter(one, LIMITS.one), c2 = counter(body, LIMITS.review);
    if (edit) { one.value = edit.one_liner || ''; body.value = edit.body || ''; one.dispatchEvent(new Event('input')); body.dispatchEvent(new Event('input')); }
    var msg = h('div', { class: 'msg', role: 'status' });
    var btn = h('button', { class: 'btn', type: 'submit' }, edit ? '고친 내용 저장' : '서평 남기기');
    var f = h('form', { class: 'fm', novalidate: true },
      whoLine(),
      h('label', null, '별점', stars),
      h('label', null, h('span', { class: 'row' }, '한줄평', c1), one),
      h('label', null, h('span', { class: 'row' }, '서평 (선택)', c2), body),
      h('div', { class: 'row' }, msg, h('span', null,
        edit ? h('button', { class: 'btn ghost', type: 'button', onclick: cancel, style: 'margin-right:6px' }, '취소') : null, btn)));
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      submitWith(btn, msg, function () {
        if (!rating) return '별점을 골라 주세요.';
        if (!one.value.trim()) return '한줄평을 적어 주세요.';
        return null;
      }, function () {
        var x = { slug: b.slug, rating: rating, one: one.value.trim(), body: body.value.trim() };
        if (edit) { x.id = edit.id; return Store.editReview(x); }
        return Store.addReview(x);
      }, function () {
        if (edit) { done(); return; }
        rating = 0; paint(); one.value = ''; body.value = '';
        one.dispatchEvent(new Event('input')); body.dispatchEvent(new Event('input'));
        msg.className = 'msg ok'; msg.textContent = '서평이 올라갔습니다. 고맙습니다.';
        done();
      });
    });
    return f;
  }

  // changed: refresh callback; when given, my own reviews get 「고치기 · 지우기」.
  function reviewItem(r, showBook, changed) {
    var b = bookBy(r.book_slug);
    var art = h('article', { class: 'card item' },
      showBook ? h('a', { class: 'book', href: '#/book/' + r.book_slug }, bookName(b)) : null,
      h('div', { class: 'meta' }, h('span', { class: 'stars' }, starText(r.rating)), h('span', null, r.nickname),
        h('span', null, fmtTime(r.created_at) + (r.updated_at ? ' · 고침' : ''))),
      h('div', { class: 'one' }, r.one_liner),
      r.body ? h('div', { class: 'body' }, r.body) : null,
      changed && mine(r) ? h('div', { class: 'own' },
        h('button', { type: 'button', class: 'lnk', onclick: function () {
          var box = h('div', { class: 'card' });
          box.appendChild(reviewForm(b || { slug: r.book_slug }, changed, r, function () { box.replaceWith(art); }));
          art.replaceWith(box);
        } }, '고치기'),
        delBtn('review', r.id, '이 서평을', changed)) : null);
    return art;
  }

  function postItem(p) {
    var ex = p.body.length > 90 ? p.body.slice(0, 90) + '…' : p.body;
    return h('a', { class: 'card item', href: '#/post/' + encodeURIComponent(p.id) },
      h('div', { class: 'one' }, p.title),
      h('div', { class: 'body muted small' }, ex),
      h('div', { class: 'meta', style: 'margin-top:6px' }, h('span', null, p.nickname), h('span', null, fmtTime(p.created_at)),
        h('span', null, '댓글 ' + (p.comment_count || 0))));
  }

  function viewShare(root) {
    root.appendChild(h('h1', { class: 'h2' }, '나눔', h('small', null, '편하게 나누는 자리')));
    root.appendChild(h('p', { class: 'lead' }, '책을 읽으며 든 생각, 기도 제목, 마음에 남은 문장을 편하게 나눠 주세요. 글에는 가입할 때 정한 이름이 붙습니다.'));
    var title = h('input', { name: 'title', maxlength: String(LIMITS.title), placeholder: '제목' });
    var body = h('textarea', { name: 'body', maxlength: String(LIMITS.post), placeholder: '나누고 싶은 이야기' });
    var msg = h('div', { class: 'msg', role: 'status' });
    var btn = h('button', { class: 'btn', type: 'submit' }, '올리기');
    var f = h('form', { class: 'fm', novalidate: true },
      ACC ? whoLine() : null,
      h('label', null, h('span', { class: 'row' }, '제목', counter(title, LIMITS.title)), title),
      h('label', null, h('span', { class: 'row' }, '내용', counter(body, LIMITS.post)), body),
      h('div', { class: 'row' }, msg, btn));
    var box = h('div', { class: 'card', hidden: true }, ACC ? f : loginPrompt('나눔 글을 쓰려면'));
    var toggle = h('button', { class: 'btn', type: 'button', onclick: function () {
      box.hidden = !box.hidden; toggle.textContent = box.hidden ? '글쓰기' : '닫기'; if (!box.hidden && ACC) title.focus();
    } }, '글쓰기');
    root.appendChild(h('div', { style: 'margin-bottom:12px' }, toggle));
    root.appendChild(box);
    var list = h('div', { class: 'list sec' }, loading());
    root.appendChild(list);
    function refresh() {
      Store.posts().then(function (rows) {
        list.textContent = '';
        if (!rows.length) list.appendChild(h('p', { class: 'empty' }, '아직 나눔 글이 없습니다. 첫 이야기를 들려주세요.'));
        rows.forEach(function (p) { list.appendChild(postItem(p)); });
      }, function () { list.textContent = ''; list.appendChild(failed()); });
    }
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      submitWith(btn, msg, function () {
        if (!title.value.trim()) return '제목을 적어 주세요.';
        if (!body.value.trim()) return '내용을 적어 주세요.';
        return null;
      }, function () { return Store.addPost({ title: title.value.trim(), body: body.value.trim() }); },
      function () {
        title.value = ''; body.value = ''; title.dispatchEvent(new Event('input')); body.dispatchEvent(new Event('input'));
        msg.className = 'msg ok'; msg.textContent = '글이 올라갔습니다.';
        refresh();
      });
    });
    refresh();
  }

  function viewPost(root, id) {
    root.appendChild(h('a', { class: 'back', href: '#/share' }, '← 나눔'));
    var box = h('div', null, loading());
    root.appendChild(box);
    function refresh() {
      Store.post(id).then(function (r) {
        box.textContent = '';
        if (!r.post) { box.appendChild(h('p', { class: 'empty' }, ERR.not_found)); return; }
        var p = r.post;
        var art = h('article', { class: 'card post item' },
          h('div', { class: 'meta' }, h('span', null, p.nickname), h('span', null, fmtTime(p.created_at) + (p.updated_at ? ' · 고침' : ''))),
          h('h1', null, p.title), h('div', { class: 'body' }, p.body),
          mine(p) ? h('div', { class: 'own' },
            h('button', { type: 'button', class: 'lnk', onclick: function () { art.replaceWith(postEditForm(p, refresh, function () { refresh(); })); } }, '고치기'),
            delBtn('post', p.id, '이 글과 댓글을 모두', function () { location.hash = '#/share'; })) : null);
        box.appendChild(art);
        box.appendChild(h('section', { class: 'sec' }, h('h2', null, '댓글', h('small', null, r.comments.length + '개')),
          r.comments.length ? h('div', { class: 'list' }, r.comments.map(function (c) {
            return h('div', { class: 'card item' }, h('div', { class: 'meta' }, h('span', null, c.nickname), h('span', null, fmtTime(c.created_at)),
              mine(c) ? delBtn('comment', c.id, '이 댓글을', refresh) : null),
              h('div', { class: 'body', style: 'margin-top:4px' }, c.body));
          })) : h('p', { class: 'empty' }, '아직 댓글이 없습니다.')));
        box.appendChild(h('div', { class: 'card sec' }, commentForm(p.id, refresh)));
      }, function () { box.textContent = ''; box.appendChild(failed()); });
    }
    refresh();
  }

  function postEditForm(p, done, cancel) {
    var title = h('input', { name: 'title', maxlength: String(LIMITS.title) });
    var body = h('textarea', { name: 'body', maxlength: String(LIMITS.post) });
    var c1 = counter(title, LIMITS.title), c2 = counter(body, LIMITS.post);
    title.value = p.title; body.value = p.body; title.dispatchEvent(new Event('input')); body.dispatchEvent(new Event('input'));
    var msg = h('div', { class: 'msg', role: 'status' });
    var btn = h('button', { class: 'btn', type: 'submit' }, '고친 내용 저장');
    var f = h('form', { class: 'fm card', novalidate: true },
      h('label', null, h('span', { class: 'row' }, '제목', c1), title),
      h('label', null, h('span', { class: 'row' }, '내용', c2), body),
      h('div', { class: 'row' }, msg, h('span', null, h('button', { class: 'btn ghost', type: 'button', onclick: cancel, style: 'margin-right:6px' }, '취소'), btn)));
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      submitWith(btn, msg, function () {
        if (!title.value.trim()) return '제목을 적어 주세요.';
        if (!body.value.trim()) return '내용을 적어 주세요.';
        return null;
      }, function () { return Store.editPost({ id: p.id, title: title.value.trim(), body: body.value.trim() }); }, function () { done(); });
    });
    return f;
  }

  function commentForm(postId, done) {
    if (!ACC) return loginPrompt('댓글을 달려면');
    var body = h('textarea', { name: 'comment', maxlength: String(LIMITS.comment), placeholder: '따뜻한 한마디를 남겨 주세요' });
    var msg = h('div', { class: 'msg', role: 'status' });
    var btn = h('button', { class: 'btn', type: 'submit' }, '댓글 달기');
    var f = h('form', { class: 'fm', novalidate: true },
      whoLine(),
      h('label', null, h('span', { class: 'row' }, '댓글', counter(body, LIMITS.comment)), body),
      h('div', { class: 'row' }, msg, btn));
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      submitWith(btn, msg, function () { return body.value.trim() ? null : '댓글 내용을 적어 주세요.'; },
        function () { return Store.addComment({ postId: postId, body: body.value.trim() }); },
        function () { done(); });
    });
    return f;
  }

  function viewAccount(root) {
    function back() {
      var url = sget('blk_return_url');
      if (url) {   // came from a session page's comment box
        try { sessionStorage.removeItem('blk_return_url'); } catch (e) { }
        if (url.indexOf(location.origin + '/') === 0) { location.href = url; return; }
      }
      var to = sget('blk_return') || '#/';
      try { sessionStorage.removeItem('blk_return'); } catch (e) { }
      location.hash = to.indexOf('#/account') === 0 ? '#/' : to;
    }
    function lab(t, hint, inp) { return h('label', null, t, hint ? h('span', { class: 'hint' }, hint) : null, inp); }
    if (ACC) {
      root.appendChild(h('h1', { class: 'h2' }, '내 계정'));
      root.appendChild(h('p', { class: 'lead' }, ACC.name + '님으로 로그인되어 있습니다. 이 기기에서는 30일 동안 로그인이 유지됩니다.'));
      var o = pwInput('current-password'), n1 = pwInput('new-password'), n2 = pwInput('new-password');
      var msg = h('div', { class: 'msg', role: 'status' });
      var btn = h('button', { class: 'btn', type: 'submit' }, '비밀번호 바꾸기');
      var f = h('form', { class: 'fm', novalidate: true },
        h('input', { type: 'text', name: 'username', autocomplete: 'username', value: ACC.name, hidden: true }),
        lab('지금 비밀번호', null, o), lab('새 비밀번호', '4자 이상', n1), lab('새 비밀번호 한 번 더', null, n2),
        h('div', { class: 'row' }, msg, btn));
      f.addEventListener('submit', function (e) {
        e.preventDefault();
        run(btn, msg, function () {
          if (!o.value) return '지금 비밀번호를 적어 주세요.';
          if (n1.value.length < 4) return ERR.weak_password;
          if (n1.value !== n2.value) return '새 비밀번호가 서로 다릅니다.';
          return null;
        }, function () { return Store.changePw(o.value, n1.value); }, function () {
          o.value = n1.value = n2.value = ''; msg.className = 'msg ok'; msg.textContent = '비밀번호를 바꿨습니다.';
        });
      });
      root.appendChild(h('div', { class: 'card' }, h('div', { class: 'h2' }, '비밀번호 바꾸기'), f));
      root.appendChild(h('div', { class: 'sec' }, h('button', { class: 'btn ghost', type: 'button', onclick: function () {
        Store.logout().then(function () { setAcc(null); location.hash = '#/'; });
      } }, '로그아웃')));
      return;
    }
    function finish(res) { setAcc({ t: res.token, id: res.id, name: res.name }); back(); }

    root.appendChild(h('h1', { class: 'h2' }, '로그인'));
    root.appendChild(h('p', { class: 'lead' }, '서평과 나눔은 로그인한 멤버만 쓸 수 있습니다. 한 번 로그인하면 이 기기에서 30일 동안 유지됩니다.'));
    var ln = h('input', { type: 'text', name: 'username', autocomplete: 'username', maxlength: String(NAME_MAX), autocapitalize: 'off' });
    var lp = pwInput('current-password');
    var lm = h('div', { class: 'msg', role: 'status' });
    var lb = h('button', { class: 'btn', type: 'submit' }, '로그인');
    var lf = h('form', { class: 'fm', novalidate: true }, lab('이름 또는 별명', null, ln), lab('비밀번호', null, lp), h('div', { class: 'row' }, lm, lb));
    lf.addEventListener('submit', function (e) {
      e.preventDefault();
      run(lb, lm, function () { return !cleanName(ln.value) ? ERR.invalid_name : !lp.value ? '비밀번호를 적어 주세요.' : null; },
        function () { return Store.login(cleanName(ln.value), lp.value); }, finish);
    });
    root.appendChild(h('div', { class: 'card' }, lf));

    root.appendChild(h('div', { class: 'or' }, h('span', null, '처음이신가요?')));
    var club = lget(CLUB_KEY) || '';
    var rc = h('input', { type: 'text', name: 'club-code', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', style: '-webkit-text-security:disc' });
    var rcl = lab('입장 코드', '모임에서 받은 코드', rc); rcl.hidden = !!club;
    var rn = h('input', { type: 'text', name: 'username', autocomplete: 'username', maxlength: String(NAME_MAX), placeholder: '예: 김집사, 들꽃' });
    var rp = pwInput('new-password'), rp2 = pwInput('new-password');
    var rm = h('div', { class: 'msg', role: 'status' });
    var rb = h('button', { class: 'btn ghost', type: 'submit' }, '가입하기');
    var rf = h('form', { class: 'fm', novalidate: true },
      h('div', { class: 'join-head' }, h('b', null, '새로 가입하기'), h('span', null, '처음 한 번만 하면 됩니다. 다음부터는 위에서 로그인하세요.')), rcl,
      lab('이름 또는 별명', '서평과 나눔에 이 이름이 보입니다. 20자까지, 다른 멤버와 겹치지 않게.', rn),
      lab('비밀번호', '4자 이상. 잊으면 모임 리더에게 말씀해 주세요.', rp), lab('비밀번호 한 번 더', null, rp2),
      h('div', { class: 'row' }, rm, rb));
    rf.addEventListener('submit', function (e) {
      e.preventDefault();
      var code = rcl.hidden ? club : rc.value.trim();
      run(rb, rm, function () {
        if (!code) return ERR.no_code;
        if (!cleanName(rn.value)) return ERR.invalid_name;
        if (rp.value.length < 4) return ERR.weak_password;
        if (rp.value !== rp2.value) return '비밀번호가 서로 다릅니다.';
        return null;
      }, function () {
        return Store.register(code, cleanName(rn.value), rp.value).then(function (res) {
          if (res && res.error === 'invalid_code') { lset(CLUB_KEY, ''); rcl.hidden = false; rc.value = ''; }
          return res;
        });
      }, function (res) { if (!rcl.hidden) lset(CLUB_KEY, code); finish(res); });
    });
    root.appendChild(h('div', { class: 'card join' }, rf));
  }

  function viewResources(root) {
    var rows = [];
    BOOKS.forEach(function (b) { b.sessions.forEach(function (s) { rows.push({ b: b, s: s }); }); });
    rows.sort(function (x, y) { return x.s.date < y.s.date ? 1 : x.s.date > y.s.date ? -1 : 0; });
    root.appendChild(h('h1', { class: 'h2' }, '자료실', h('small', null, '모임 기록 ' + rows.length + '개 · 최신순')));
    root.appendChild(h('p', { class: 'lead' }, '회차마다 정리된 하이라이트와 카드입니다. 누르면 그날의 기록이 열립니다.'));
    var sel = h('select', { class: 'sel', 'aria-label': '책으로 거르기' }, h('option', { value: '' }, '모든 책'),
      BOOKS.filter(function (b) { return b.sessions.length; }).map(function (b) { return h('option', { value: b.slug }, bookName(b)); }));
    var out = h('div');
    root.appendChild(sel); root.appendChild(out);
    function draw() {
      out.textContent = '';
      var yr = '';
      rows.filter(function (r) { return !sel.value || r.b.slug === sel.value; }).forEach(function (r) {
        var y = r.s.date.slice(0, 4);
        if (y !== yr) { yr = y; out.appendChild(h('div', { class: 'yr' }, y + '년')); }
        out.appendChild(h('a', { class: 'card res', href: '../' + r.s.href, style: 'margin-bottom:8px' },
          h('span', { class: 'd' }, r.s.date.slice(5).replace('-', '.') + ' (' + r.s.day + ')'),
          h('span', { class: 't' }, bookName(r.b)),
          h('span', { class: 'r' }, r.s.round + '회')));
      });
    }
    sel.addEventListener('change', draw);
    draw();
  }

  // ---------- router ----------
  function route() {
    var parts = (location.hash.replace(/^#\/?/, '') || '').split('/').map(function (x) {
      try { return decodeURIComponent(x); } catch (e) { return x; }
    });
    var root = $('view');
    root.textContent = '';
    var tab = parts[0] === 'account' ? '' : 'home';
    if (parts[0] === 'library' || parts[0] === 'book') tab = 'library';
    else if (parts[0] === 'share' || parts[0] === 'post') tab = 'share';
    else if (parts[0] === 'resources') tab = 'resources';
    Array.prototype.forEach.call(document.querySelectorAll('.tabs a'), function (a) {
      a.classList.toggle('on', a.getAttribute('data-tab') === tab);
      if (a.getAttribute('data-tab') === tab) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    if (parts[0] === 'library') viewLibrary(root);
    else if (parts[0] === 'book') viewBook(root, parts[1], parts[2] === 'write');
    else if (parts[0] === 'share') viewShare(root);
    else if (parts[0] === 'post') viewPost(root, parts[1]);
    else if (parts[0] === 'resources') viewResources(root);
    else if (parts[0] === 'account') viewAccount(root);
    else viewHome(root);
    window.scrollTo(0, 0);
  }

  function start() {
    $('gate').hidden = true;
    $('app').hidden = false;
    var mb = $('modebar');
    if (!LIVE) {
      mb.hidden = false;
      mb.appendChild(h('div', null, '체험 모드입니다. 여기서 쓴 서평과 나눔은 이 기기에만 저장되고 다른 멤버에게는 보이지 않습니다.'));
    }
    drawAcct();
    if (ACC) Store.me().then(function (r) {
      if (r && r.ok) { if (r.name !== ACC.name) setAcc({ t: ACC.t, id: r.id, name: r.name }); }
      else if (r && r.error === 'login_required') { setAcc(null); route(); }
    });
    window.addEventListener('hashchange', route);
    route();
  }

  // ---------- entrance: the club code, checked by the server and remembered on this device ----------
  function showGate() {
    $('gate').hidden = false;
    var b = $('gb'), p = $('gp'), m = $('gm');
    p.focus();
    function go() {
      var code = p.value.trim();
      if (!code) { m.textContent = ERR.no_code; return; }
      b.disabled = true; m.textContent = '확인하는 중…';
      Store.checkCode(code).then(function (res) {
        b.disabled = false;
        if (res && res.ok) { lset(CLUB_KEY, code); start(); return; }
        m.textContent = ERR[(res && res.error)] || ERR.network; p.value = ''; p.focus();
      });
    }
    b.onclick = go;
    p.onkeydown = function (e) { if (e.key === 'Enter') go(); };
  }
  if (ACC || lget(CLUB_KEY)) start(); else showGate();
})();
