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
  var GATE_KEY = 'blk_v1';              // same session key the hub gate uses
  var CODE_KEY = 'blk_member_code';     // remembered for this tab only after a successful write
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
    rate_limited: '짧은 시간에 글이 많이 올라왔어요. 잠시 후 다시 시도해 주세요.',
    invalid_input: '입력한 내용을 다시 확인해 주세요.',
    not_found: '글을 찾을 수 없습니다.',
    network: '연결이 원활하지 않습니다. 잠시 후 다시 시도해 주세요.'
  };

  var Demo = {
    load: function () {
      try { var d = JSON.parse(localStorage.getItem(LS_KEY)); if (d && d.reviews) return d; } catch (e) { }
      return { reviews: [], posts: [], comments: [] };
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

  var Store = {
    reviews: function (slug) {
      if (!LIVE) return Promise.resolve(Demo.load().reviews.filter(function (r) { return !slug || r.book_slug === slug; })
        .sort(function (a, b) { return a.created_at < b.created_at ? 1 : -1; }));
      return api('/rest/v1/reviews?select=id,book_slug,rating,one_liner,body,nickname,created_at&order=created_at.desc&limit=1000' +
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
      return api('/rest/v1/posts?select=id,title,body,nickname,created_at,comments(count)&order=created_at.desc&limit=300')
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
        api('/rest/v1/posts?select=id,title,body,nickname,created_at&id=eq.' + q),
        api('/rest/v1/comments?select=id,post_id,body,nickname,created_at&order=created_at.asc&post_id=eq.' + q)
      ]).then(function (r) { return { post: r[0][0] || null, comments: r[1] }; });
    },
    addReview: function (x) {
      if (!LIVE) return Promise.resolve(Demo.write(function (d) {
        var row = { id: uid(), book_slug: x.slug, rating: x.rating, one_liner: x.one, body: x.body || null,
          nickname: nickname(), created_at: new Date().toISOString() };
        d.reviews.push(row); return { ok: true, id: row.id };
      }));
      return rpc('add_review', { p_code: x.code, p_book_slug: x.slug, p_rating: x.rating, p_one_liner: x.one, p_body: x.body || null });
    },
    addPost: function (x) {
      if (!LIVE) return Promise.resolve(Demo.write(function (d) {
        var row = { id: uid(), title: x.title, body: x.body, nickname: nickname(), created_at: new Date().toISOString() };
        d.posts.push(row); return { ok: true, id: row.id };
      }));
      return rpc('add_post', { p_code: x.code, p_title: x.title, p_body: x.body });
    },
    addComment: function (x) {
      if (!LIVE) return Promise.resolve(Demo.write(function (d) {
        if (!d.posts.some(function (p) { return p.id === x.postId; })) return { ok: false, error: 'not_found' };
        var row = { id: uid(), post_id: x.postId, body: x.body, nickname: nickname(), created_at: new Date().toISOString() };
        d.comments.push(row); return { ok: true, id: row.id };
      }));
      return rpc('add_comment', { p_code: x.code, p_post_id: x.postId, p_body: x.body });
    }
  };

  // ---------- shared form pieces ----------
  function codeField() {
    var inp = h('input', { type: 'password', name: 'code', autocomplete: 'off', placeholder: '모임에서 받은 코드', maxlength: '100' });
    var saved = sget(CODE_KEY); if (saved) inp.value = saved;
    return {
      el: h('label', null, '입장 코드',
        h('span', { class: 'hint' }, LIVE ? '글은 북클럽 멤버만 남길 수 있습니다.' : '체험 모드에서는 아무 코드나 입력해도 됩니다.'), inp),
      input: inp
    };
  }
  function anonNote() {
    return h('p', { class: 'note' }, '이름은 저장되지 않습니다. 글마다 「책갈피 23」처럼 임의의 별명이 붙습니다.');
  }
  // Runs a write: checks code, disables the button, shows result.
  function submitWith(btn, msg, codeInp, check, send, done) {
    msg.className = 'msg'; msg.textContent = '';
    var bad = check(); if (bad) { msg.className = 'msg err'; msg.textContent = bad; return; }
    var code = codeInp.value.trim();
    if (!code) { msg.className = 'msg err'; msg.textContent = ERR.no_code; codeInp.focus(); return; }
    btn.disabled = true; msg.textContent = '올리는 중…';
    send(code).then(function (res) {
      btn.disabled = false;
      if (res && res.ok) { sset(CODE_KEY, code); done(res); return; }
      var e = (res && res.error) || 'network';
      msg.className = 'msg err'; msg.textContent = ERR[e] || ERR.network;
      if (e === 'invalid_code') { codeInp.value = ''; codeInp.focus(); try { sessionStorage.removeItem(CODE_KEY); } catch (x) { } }
    });
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
      h('a', { class: 'card', href: '#/share' }, h('b', null, '나눔'), h('span', null, '이름 없이 나누는 이야기')),
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
          rows.forEach(function (r) { list.appendChild(reviewItem(r, false)); });
        } else {
          add(sum, h('div', { class: 'muted small' }, '아직 서평이 없습니다. 첫 한 줄을 남겨 주세요.'));
        }
      }, function () { sum.textContent = ''; sum.appendChild(failed()); });
    }
    refresh();
    if (focusWrite) setTimeout(function () { form.scrollIntoView({ block: 'start' }); }, 0);
  }

  function reviewForm(b, done) {
    var rating = 0;
    var stars = h('div', { class: 'rate', role: 'radiogroup', 'aria-label': '별점' });
    var btns = [1, 2, 3, 4, 5].map(function (n) {
      return h('button', { type: 'button', role: 'radio', 'aria-checked': 'false', 'aria-label': n + '점', 'data-n': String(n),
        onclick: function () { rating = n; paint(); } }, '★');
    });
    function paint() { btns.forEach(function (x, i) { x.className = i < rating ? 'on' : ''; x.setAttribute('aria-checked', String(i + 1 === rating)); }); }
    add(stars, btns);
    var one = h('input', { name: 'one', maxlength: String(LIMITS.one), placeholder: '이 책을 한 줄로 말한다면' });
    var body = h('textarea', { name: 'body', maxlength: String(LIMITS.review), placeholder: '조금 더 길게 남기고 싶다면 (선택)' });
    var code = codeField();
    var msg = h('div', { class: 'msg', role: 'status' });
    var btn = h('button', { class: 'btn', type: 'submit' }, '서평 남기기');
    var f = h('form', { class: 'fm', novalidate: true },
      h('label', null, '별점', stars),
      h('label', null, h('span', { class: 'row' }, '한줄평', counter(one, LIMITS.one)), one),
      h('label', null, h('span', { class: 'row' }, '서평 (선택)', counter(body, LIMITS.review)), body),
      code.el, anonNote(), h('div', { class: 'row' }, msg, btn));
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      submitWith(btn, msg, code.input, function () {
        if (!rating) return '별점을 골라 주세요.';
        if (!one.value.trim()) return '한줄평을 적어 주세요.';
        return null;
      }, function (c) {
        return Store.addReview({ code: c, slug: b.slug, rating: rating, one: one.value.trim(), body: body.value.trim() });
      }, function () {
        rating = 0; paint(); one.value = ''; body.value = '';
        one.dispatchEvent(new Event('input')); body.dispatchEvent(new Event('input'));
        msg.className = 'msg ok'; msg.textContent = '서평이 올라갔습니다. 고맙습니다.';
        done();
      });
    });
    return f;
  }

  function reviewItem(r, showBook) {
    var b = bookBy(r.book_slug);
    return h('article', { class: 'card item' },
      showBook ? h('a', { class: 'book', href: '#/book/' + r.book_slug }, bookName(b)) : null,
      h('div', { class: 'meta' }, h('span', { class: 'stars' }, starText(r.rating)), h('span', null, r.nickname), h('span', null, fmtTime(r.created_at))),
      h('div', { class: 'one' }, r.one_liner),
      r.body ? h('div', { class: 'body' }, r.body) : null);
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
    root.appendChild(h('h1', { class: 'h2' }, '나눔', h('small', null, '이름 없이 나누는 자리')));
    root.appendChild(h('p', { class: 'lead' }, '책을 읽으며 든 생각, 기도 제목, 마음에 남은 문장을 편하게 나눠 주세요. 글마다 임의의 별명이 붙고, 이름은 남지 않습니다.'));
    var title = h('input', { name: 'title', maxlength: String(LIMITS.title), placeholder: '제목' });
    var body = h('textarea', { name: 'body', maxlength: String(LIMITS.post), placeholder: '나누고 싶은 이야기' });
    var code = codeField();
    var msg = h('div', { class: 'msg', role: 'status' });
    var btn = h('button', { class: 'btn', type: 'submit' }, '올리기');
    var f = h('form', { class: 'fm', novalidate: true },
      h('label', null, h('span', { class: 'row' }, '제목', counter(title, LIMITS.title)), title),
      h('label', null, h('span', { class: 'row' }, '내용', counter(body, LIMITS.post)), body),
      code.el, anonNote(), h('div', { class: 'row' }, msg, btn));
    var box = h('div', { class: 'card', hidden: true }, f);
    var toggle = h('button', { class: 'btn', type: 'button', onclick: function () {
      box.hidden = !box.hidden; toggle.textContent = box.hidden ? '글쓰기' : '닫기'; if (!box.hidden) title.focus();
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
      submitWith(btn, msg, code.input, function () {
        if (!title.value.trim()) return '제목을 적어 주세요.';
        if (!body.value.trim()) return '내용을 적어 주세요.';
        return null;
      }, function (c) { return Store.addPost({ code: c, title: title.value.trim(), body: body.value.trim() }); },
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
        box.appendChild(h('article', { class: 'card post item' },
          h('div', { class: 'meta' }, h('span', null, p.nickname), h('span', null, fmtTime(p.created_at))),
          h('h1', null, p.title), h('div', { class: 'body' }, p.body)));
        box.appendChild(h('section', { class: 'sec' }, h('h2', null, '댓글', h('small', null, r.comments.length + '개')),
          r.comments.length ? h('div', { class: 'list' }, r.comments.map(function (c) {
            return h('div', { class: 'card item' }, h('div', { class: 'meta' }, h('span', null, c.nickname), h('span', null, fmtTime(c.created_at))),
              h('div', { class: 'body', style: 'margin-top:4px' }, c.body));
          })) : h('p', { class: 'empty' }, '아직 댓글이 없습니다.')));
        box.appendChild(h('div', { class: 'card sec' }, commentForm(p.id, refresh)));
      }, function () { box.textContent = ''; box.appendChild(failed()); });
    }
    refresh();
  }

  function commentForm(postId, done) {
    var body = h('textarea', { name: 'comment', maxlength: String(LIMITS.comment), placeholder: '따뜻한 한마디를 남겨 주세요' });
    var code = codeField();
    var msg = h('div', { class: 'msg', role: 'status' });
    var btn = h('button', { class: 'btn', type: 'submit' }, '댓글 달기');
    var f = h('form', { class: 'fm', novalidate: true },
      h('label', null, h('span', { class: 'row' }, '댓글', counter(body, LIMITS.comment)), body), code.el, anonNote(),
      h('div', { class: 'row' }, msg, btn));
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      submitWith(btn, msg, code.input, function () { return body.value.trim() ? null : '댓글 내용을 적어 주세요.'; },
        function (c) { return Store.addComment({ code: c, postId: postId, body: body.value.trim() }); },
        function () { done(); });
    });
    return f;
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
    var tab = 'home';
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
    window.addEventListener('hashchange', route);
    route();
  }

  // ---------- gate: reuse the hub's encrypted blob to check the session key / password ----------
  var b64 = function (s) { return Uint8Array.from(atob(s), function (c) { return c.charCodeAt(0); }); };
  function hubBlob() {
    return fetch('../index.html', { cache: 'no-store' }).then(function (r) { return r.text(); }).then(function (t) {
      var m = t.match(/<script id="d" type="application\/json">([\s\S]*?)<\/script>/);
      if (!m) throw new Error('no blob');
      return JSON.parse(m[1]);
    });
  }
  function verify(D, raw) {
    return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']).then(function (k) {
      return crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(D.iv) }, k, b64(D.ct));
    });
  }
  function unlock(D, pw) {
    return crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveBits']).then(function (base) {
      return crypto.subtle.deriveBits({ name: 'PBKDF2', salt: b64(D.pw.salt), iterations: D.pw.iter, hash: 'SHA-256' }, base, 256);
    }).then(function (bits) {
      return crypto.subtle.importKey('raw', bits, 'AES-GCM', false, ['decrypt']);
    }).then(function (kek) {
      return crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(D.pw.iv) }, kek, b64(D.pw.wrapped));
    }).then(function (raw) {
      sset(GATE_KEY, btoa(String.fromCharCode.apply(null, new Uint8Array(raw))));
      return raw;
    });
  }
  function showGate(D) {
    $('gate').hidden = false;
    var b = $('gb'), p = $('gp'), m = $('gm');
    p.focus();
    function go() {
      b.disabled = true; m.textContent = '여는 중…';
      unlock(D, p.value).then(function (raw) { return verify(D, raw); }).then(start, function () {
        m.textContent = '암호가 맞지 않습니다.'; b.disabled = false; p.value = ''; p.focus();
      });
    }
    b.onclick = go;
    p.onkeydown = function (e) { if (e.key === 'Enter') go(); };
  }
  hubBlob().then(function (D) {
    var cached = sget(GATE_KEY);
    if (!cached) return showGate(D);
    verify(D, b64(cached).buffer).then(start, function () {
      try { sessionStorage.removeItem(GATE_KEY); } catch (e) { }
      showGate(D);
    });
  }, function () {
    $('gate').hidden = false;
    $('gm').textContent = '페이지를 불러오지 못했습니다. 잠시 후 다시 열어 주세요.';
    $('gb').disabled = true;
  });
})();
