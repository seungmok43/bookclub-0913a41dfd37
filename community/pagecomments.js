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
    '.blk-cm h2 small{font-size:.8rem;opacity:.6;font-weight:400}' +
    '.blk-cm .it{border-top:1px solid rgba(128,128,128,.25);padding:12px 2px}' +
    '.blk-cm .mt{font-size:.8rem;opacity:.65;display:flex;gap:10px;align-items:center}' +
    '.blk-cm .bd{margin-top:4px;line-height:1.7;white-space:pre-wrap;word-break:keep-all;overflow-wrap:break-word}' +
    '.blk-cm .em{opacity:.6;font-size:.9rem;padding:8px 2px 14px}' +
    '.blk-cm form{margin-top:14px;display:grid;gap:8px}' +
    '.blk-cm textarea{width:100%;min-height:90px;padding:11px 12px;border:1px solid rgba(128,128,128,.35);border-radius:10px;font:inherit;font-size:16px;background:rgba(255,255,255,.55);color:inherit;resize:vertical;box-sizing:border-box}' +
    '@media(prefers-color-scheme:dark){.blk-cm textarea{background:rgba(0,0,0,.25)}}' +
    '.blk-cm .rw{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap}' +
    '.blk-cm .who{font-size:.85rem;opacity:.7}' +
    '.blk-cm .btn{border:0;border-radius:10px;background:#8C2F39;color:#fff;font-weight:700;padding:10px 16px;font-size:.92rem;cursor:pointer;text-decoration:none;display:inline-block}' +
    '.blk-cm .btn:disabled{opacity:.5}' +
    '.blk-cm .lnk{background:none;border:0;padding:0;color:#8C2F39;font-size:.8rem;cursor:pointer;text-decoration:underline;margin-left:auto}' +
    '.blk-cm .msg{font-size:.85rem;min-height:1.2em;color:#8C2F39}' +
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
})();
