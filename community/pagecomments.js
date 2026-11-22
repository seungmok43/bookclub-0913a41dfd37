/* BooKLove — comments under a session page (회차 기록 아래 댓글).
 * A session page loads ../../community/config.js and this file inside its locked content.
 * It mounts into <div id="comments"></div> (or the end of <main>/<body>).
 * Reading needs only the site key; writing uses the member login from the community page
 * (same site, localStorage 'blk_acct'). User text is always inserted as text, never as HTML.
 */
(function () {
  'use strict';
  var CFG = window.BOOKLOVE_CONFIG || {};
  if (!CFG.supabaseUrl || !CFG.supabaseAnonKey) return;
  var ROOT = '/bookclub-0913a41dfd37/';
  var path = location.pathname.replace(/index\.html$/, '').replace(/\/+$/, '');
  var i = path.indexOf(ROOT.replace(/\/$/, ''));
  var PAGE = (i >= 0 ? path.slice(i + ROOT.length - 1) : path).replace(/^\/+/, '');
  if (!/^[a-z0-9-]{1,40}(\/[a-z0-9-]{1,40})?$/.test(PAGE)) return;
  var COMMUNITY = (i >= 0 ? path.slice(0, i) + ROOT : '/') + 'community/';

  function acc() { try { var a = JSON.parse(localStorage.getItem('blk_acct')); return a && a.t && a.id ? a : null; } catch (e) { return null; } }
  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      var v = attrs[k]; if (v == null || v === false) continue;
      if (k === 'class') el.className = v; else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v); else el.setAttribute(k, v);
    }
    for (var j = 2; j < arguments.length; j++) { var c = arguments[j]; if (c == null || c === false) continue; el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); }
    return el;
  }
  function api(p, body) {
    var hd = { apikey: CFG.supabaseAnonKey, Authorization: 'Bearer ' + CFG.supabaseAnonKey };
    if (body) hd['Content-Type'] = 'application/json';
    return fetch(CFG.supabaseUrl.replace(/\/$/, '') + p, { method: body ? 'POST' : 'GET', headers: hd, body: body ? JSON.stringify(body) : undefined })
      .then(function (r) { return r.json().catch(function () { return null; }).then(function (j) { if (!r.ok) throw new Error('http ' + r.status); return j; }); });
  }
  function rpc(n, b) { return api('/rest/v1/rpc/' + n, b).then(function (j) { return j && typeof j === 'object' ? j : { ok: false, error: 'network' }; }, function () { return { ok: false, error: 'network' }; }); }
  function fmt(iso) { var d = new Date(iso); if (isNaN(d)) return ''; function p(n) { return (n < 10 ? '0' : '') + n; } return d.getFullYear() + '.' + p(d.getMonth() + 1) + '.' + p(d.getDate()); }
  var ERR = {
    login_required: '로그인이 필요합니다. 다시 로그인해 주세요.',
    rate_limited: '짧은 시간에 글이 많이 올라왔어요. 잠시 후 다시 시도해 주세요.',
    invalid_input: '댓글 내용을 확인해 주세요.',
    not_found: '댓글을 찾을 수 없습니다.',
    network: '연결이 원활하지 않습니다. 잠시 후 다시 시도해 주세요.'
  };

  var css = '.blk-cm{margin:28px auto 8px;max-width:680px;padding:0 4px;font-family:inherit;color:inherit}' +
    '.blk-cm h2{font-size:1.05rem;margin:0 0 12px;display:flex;align-items:baseline;gap:8px}' +
    '.blk-cm h2 small{font-size:.875rem;color:#6B6459;font-weight:400}' +
    '.blk-cm .it{border-top:1px solid rgba(128,128,128,.25);padding:12px 2px}' +
    '.blk-cm .mt{font-size:.875rem;color:#6B6459;display:flex;gap:10px;align-items:center}' +
    '.blk-cm .bd{margin-top:4px;line-height:1.7;white-space:pre-wrap;word-break:keep-all;overflow-wrap:break-word}' +
    '.blk-cm .em{color:#6B6459;font-size:.9375rem;padding:8px 2px 14px}' +
    '.blk-cm form{margin-top:14px;display:grid;gap:8px}' +
    '.blk-cm textarea{width:100%;min-height:90px;padding:11px 12px;border:1px solid rgba(128,128,128,.35);border-radius:10px;font:inherit;font-size:16px;background:rgba(255,255,255,.55);color:inherit;resize:vertical;box-sizing:border-box}' +
    '@media(prefers-color-scheme:dark){.blk-cm textarea{background:rgba(0,0,0,.25)}}' +
    '.blk-cm .rw{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap}' +
    '.blk-cm .who{font-size:.875rem;color:#6B6459}' +
    '.blk-cm .btn{border:0;border-radius:10px;background:#8C2F39;color:#fff;font-weight:700;padding:0 18px;min-height:44px;font-size:.9375rem;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center}' +
    '.blk-cm .btn:disabled{opacity:.5}' +
    '.blk-cm .lnk{background:none;border:0;padding:0 6px;min-height:44px;color:#8C2F39;font-size:.875rem;cursor:pointer;text-decoration:underline;margin-left:auto}' +
    '.blk-cm .msg{font-size:.875rem;min-height:1.2em;color:#8C2F39}' +
    '.blk-cm .ask{margin-top:12px;font-size:.92rem;display:flex;gap:10px;align-items:center;flex-wrap:wrap}';
  document.head.appendChild(h('style', null, css));

  var host = document.getElementById('comments') || (function () {
    var d = h('div', { id: 'comments' }); (document.querySelector('main') || document.body).appendChild(d); return d;
  })();
  var box = h('section', { class: 'blk-cm', 'aria-label': '댓글' });
  host.appendChild(box);

  function draw(rows) {
    var me = acc();
    box.textContent = '';
    box.appendChild(h('h2', null, '댓글', h('small', null, rows.length + '개')));
    if (!rows.length) box.appendChild(h('div', { class: 'em' }, '이 회차에 남기고 싶은 생각이 있으면 첫 댓글을 남겨 주세요.'));
    rows.forEach(function (c) {
      box.appendChild(h('div', { class: 'it' },
        h('div', { class: 'mt' }, h('span', null, c.nickname), h('span', null, fmt(c.created_at)),
          me && c.member_id === me.id ? h('button', { type: 'button', class: 'lnk', onclick: function () {
            if (!window.confirm('이 댓글을 지울까요?')) return;
            rpc('m_delete_page_comment', { p_token: me.t, p_id: c.id }).then(function (r) {
              if (r && r.ok) load(); else window.alert(ERR[(r && r.error)] || ERR.network);
            });
          } }, '지우기') : null),
        h('div', { class: 'bd' }, c.body)));
    });
    if (!me) {
      box.appendChild(h('div', { class: 'ask' }, h('span', null, '댓글은 로그인한 멤버만 남길 수 있습니다.'),
        h('a', { class: 'btn', href: COMMUNITY + '#/account', onclick: function () {
          try { sessionStorage.setItem('blk_return_url', location.href); } catch (e) { }
        } }, '로그인 · 가입')));
      return;
    }
    var ta = h('textarea', { maxlength: '1000', placeholder: '따뜻한 한마디를 남겨 주세요' });
    var msg = h('div', { class: 'msg', role: 'status' });
    var btn = h('button', { class: 'btn', type: 'submit' }, '댓글 달기');
    var f = h('form', { novalidate: true }, h('div', { class: 'who' }, me.name + ' 이름으로 올립니다.'), ta, h('div', { class: 'rw' }, msg, btn));
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var body = ta.value.trim(); if (!body) { msg.textContent = '댓글 내용을 적어 주세요.'; return; }
      btn.disabled = true; msg.textContent = '';
      rpc('m_add_page_comment', { p_token: me.t, p_page: PAGE, p_body: body }).then(function (r) {
        btn.disabled = false;
        if (r && r.ok) { load(); return; }
        var er = (r && r.error) || 'network'; msg.textContent = ERR[er] || ERR.network;
        if (er === 'login_required') { try { localStorage.removeItem('blk_acct'); } catch (x) { } }
      });
    });
    box.appendChild(f);
  }
  function load() {
    api('/rest/v1/page_comments?select=id,body,nickname,member_id,created_at&order=created_at.asc&page=eq.' + encodeURIComponent(PAGE))
      .then(draw, function () { box.textContent = ''; box.appendChild(h('div', { class: 'em' }, ERR.network)); });
  }
  load();

  // 출석 (attendance) for this meeting: logged-in members only, meeting date within the last 60 days.
  // Needs supabase/migrate_05_attendance.sql. Until that RPC exists the block stays hidden (404 → nothing shown).
  (function () {
    var m = /^([a-z0-9-]{1,40})\/(\d{4}-\d{2}-\d{2})$/.exec(PAGE), me = acc();
    if (!m || !me) return;
    var slug = m[1], date = m[2];
    var today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
    var dd = Math.round((Date.parse(today) - Date.parse(date)) / 864e5);
    if (!(dd >= -1 && dd <= 60)) return;
    document.head.appendChild(h('style', null, '.blk-att{margin:22px auto 0;max-width:680px;padding:12px 14px;border:1px solid rgba(128,128,128,.28);border-radius:12px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;font-size:.92rem}' +
      '.blk-att .btn{border:0;border-radius:10px;background:#8C2F39;color:#fff;font-weight:700;padding:0 18px;min-height:44px;font-size:.9375rem;cursor:pointer}.blk-att .btn:disabled{opacity:.5}' +
      '.blk-att .lnk{background:none;border:0;padding:0 6px;min-height:44px;color:#8C2F39;font-size:.875rem;cursor:pointer;text-decoration:underline}.blk-att .msg{font-size:.875rem;color:#8C2F39}' +
      '.blk-att .stp{display:inline-block;width:40px;height:40px}.blk-att .stp svg{width:100%;height:100%;display:block}.blk-att .stp.drop{animation:blkStamp .62s cubic-bezier(.25,.7,.3,1) both}' +
      '@keyframes blkStamp{0%{transform:translateY(-30px) scale(1.7);opacity:0}45%{opacity:1}62%{transform:translateY(0) scale(.9)}80%{transform:scale(1.05)}100%{transform:scale(1);opacity:1}}@media (prefers-reduced-motion:reduce){.blk-att .stp.drop{animation:none}}' +
      '.blk-att .host{flex-basis:100%}.blk-att .hl{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:6px 12px;margin-top:8px}.blk-att .hl label{display:flex;gap:8px;align-items:center;min-height:44px;font-size:.9375rem}.blk-att .hl input{width:18px;height:18px}'));
    var bar = h('section', { class: 'blk-att', 'aria-label': '출석' });
    bar.hidden = true;
    host.insertBefore(bar, box);
    var AERR = { rate_limited: ERR.rate_limited, login_required: ERR.login_required, invalid_input: '이 모임은 지금 출석할 수 없습니다.', too_late: '출석 취소는 출석한 날에만 할 수 있습니다.', not_host: '진행자 계정만 출석을 관리할 수 있습니다.' };
    // A small round ink stamp that drops in once, right after a successful 출석.
    var just = false, STAMP = '<svg viewBox="0 0 100 100"><g transform="rotate(-8 50 50)" fill="none" stroke="#b23a2b" opacity=".9"><circle cx="50" cy="50" r="44" stroke-width="5.5"/><circle cx="50" cy="50" r="36" stroke-width="1.8"/>' +
      '<path d="M30 40c6-3 13-3 20 1 7-4 14-4 20-1v20c-6-3-13-3-20 1-7-4-14-4-20-1z" stroke-width="3.4" stroke-linejoin="round"/><path d="M50 41v20" stroke-width="2.6"/></g></svg>';
    function paint() {
      rpc('m_my_attendance', { p_token: me.t }).then(function (r) {
        bar.textContent = '';
        if (!r || !r.ok) { bar.hidden = true; return; }
        var row = (r.rows || []).filter(function (x) { return x.book_slug === slug && x.date === date; })[0];
        var msg = h('span', { class: 'msg', role: 'status' });
        function act(name, b) {
          b.disabled = true;
          rpc(name, { p_token: me.t, p_book_slug: slug, p_date: date }).then(function (x) {
            b.disabled = false;
            if (x && x.ok) { just = name === 'm_check_in'; paint(); return; }
            msg.textContent = AERR[(x && x.error)] || ERR.network;
          });
        }
        if (row) {
          if (just) { just = false; var st = h('span', { class: 'stp drop', 'aria-hidden': 'true' }); st.innerHTML = STAMP; bar.appendChild(st); }
          bar.appendChild(h('span', null, '✓ 이 모임에 함께했습니다.'));
          if (row.undo_ok) { var u = h('button', { class: 'lnk', type: 'button' }, '출석 취소'); u.addEventListener('click', function () { act('m_undo_check_in', u); }); bar.appendChild(u); }
        } else {
          var b = h('button', { class: 'btn', type: 'button' }, '출석');
          b.addEventListener('click', function () { act('m_check_in', b); });
          bar.appendChild(h('span', null, '이 모임에 함께하셨나요?')); bar.appendChild(b);
        }
        bar.appendChild(msg);
        if (r.is_host) bar.appendChild(hostBox());
        bar.hidden = false;
      });
    }
    // Host (진행자·반장, members.is_host): mark members present for this meeting. Names + checkboxes only.
    function hostBox() {
      var wrap = h('div', { class: 'host' });
      var open = h('button', { class: 'lnk', type: 'button' }, '출석 관리 (진행자)');
      var list = h('div', { class: 'hl' }), hm = h('div', { class: 'msg', role: 'status' });
      wrap.appendChild(open); wrap.appendChild(list); wrap.appendChild(hm);
      function load() {
        rpc('m_host_roster', { p_token: me.t, p_book_slug: slug, p_date: date }).then(function (x) {
          list.textContent = '';
          if (!x || !x.ok) { hm.textContent = AERR[(x && x.error)] || ERR.network; return; }
          (x.rows || []).forEach(function (m) {
            var cb = h('input', { type: 'checkbox' }); cb.checked = !!m.present;
            cb.addEventListener('change', function () {
              cb.disabled = true; hm.textContent = '';
              rpc('m_host_mark', { p_token: me.t, p_member: m.id, p_book_slug: slug, p_date: date, p_present: cb.checked }).then(function (y) {
                cb.disabled = false;
                if (!(y && y.ok)) { cb.checked = !cb.checked; hm.textContent = AERR[(y && y.error)] || ERR.network; }
              });
            });
            list.appendChild(h('label', null, cb, ' ' + m.name));
          });
        });
      }
      open.addEventListener('click', function () { open.remove(); load(); });
      return wrap;
    }
    paint();
  })();

  // Footer nav: fill 「이 책의 서평 N건 보기」 with the live count (text only).
  Array.prototype.forEach.call(document.querySelectorAll('[data-blk-reviews]'), function (el) {
    var slug = el.getAttribute('data-blk-reviews');
    if (!/^[a-z0-9-]{1,40}$/.test(slug)) return;
    api('/rest/v1/reviews?select=id&book_slug=eq.' + encodeURIComponent(slug)).then(function (rows) {
      if (rows && rows.length) el.textContent = rows.length + '건 ';
    }, function () { });
  });
})();
