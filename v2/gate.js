/* BooKLove — login first (로그인 화면). Include in <head> of every page:
     <script src="<site root>/v2/gate.js"></script>
   A visitor with no saved login (localStorage 'blk_acct', the same key the whole site uses) sees only
   a login / 회원가입 screen. After one login the member is never asked again on that device until they
   press 로그아웃. This is a screen, not encryption: the page files can still be fetched directly, and
   link previews (og: tags in <head>) are untouched because crawlers do not run scripts.
   Sign-up follows the server: before migrate_06 it logs in at once; after it, it answers 「승인 대기」. */
(function () {
  'use strict';
  var KEY = 'blk_acct';
  function acct() { try { var a = JSON.parse(localStorage.getItem(KEY)); return a && a.t && a.id ? a : null; } catch (e) { return null; } }
  if (acct()) return;

  var me = document.currentScript, ROOT = me ? me.src.replace(/v2\/gate\.js(\?.*)?$/, '') : '/';
  var de = document.documentElement;
  de.classList.add('blk-gate');
  var css = 'html.blk-gate body>*:not(#blk-gate){display:none!important}' +
    'html.blk-gate body{background:#FBF9F4!important;padding:0!important}' +
    '#blk-gate{min-height:100vh;display:flex;align-items:flex-start;justify-content:center;padding:48px 16px 40px;box-sizing:border-box;' +
    'font-family:Pretendard,"Apple SD Gothic Neo","맑은 고딕",system-ui,sans-serif;color:#23201B;background:#FBF9F4;word-break:keep-all;line-height:1.6}' +
    '#blk-gate *{box-sizing:border-box}#blk-gate [hidden]{display:none!important}' +
    '#blk-gate .gx{width:100%;max-width:400px}' +
    '#blk-gate .br{font-family:"Nanum Myeongjo",Georgia,serif;font-weight:700;font-size:30px;text-align:center;margin:0 0 6px}' +
    '#blk-gate .tl{text-align:center;color:#6B6459;font-size:16px;margin:0 0 22px}' +
    '#blk-gate form{background:#fff;border:1px solid #E3DCCF;border-radius:16px;padding:20px;display:flex;flex-direction:column;gap:14px}' +
    '#blk-gate h2{font-size:19px;margin:0;font-weight:700}' +
    '#blk-gate label{display:flex;flex-direction:column;gap:6px;font-size:15px;font-weight:700}' +
    '#blk-gate label small{font-weight:400;color:#6B6459;font-size:14px}' +
    '#blk-gate input{font:inherit;font-size:17px;min-height:48px;padding:10px 12px;border:1px solid #d8d0c2;border-radius:10px;background:#FBF9F4;color:#23201B;width:100%}' +
    '#blk-gate .bt{min-height:48px;border:0;border-radius:24px;background:#8C2F39;color:#fff;font:inherit;font-size:17px;font-weight:700;cursor:pointer}' +
    '#blk-gate .bt:disabled{opacity:.55}' +
    '#blk-gate .sw{display:block;margin:18px auto 0;min-height:48px;padding:0 20px;border:1px solid #8C2F39;border-radius:24px;background:#fff;color:#8C2F39;font:inherit;font-size:16px;font-weight:700;cursor:pointer}' +
    '#blk-gate .ms{font-size:15px;min-height:1.2em;color:#6B6459;margin:0}#blk-gate .ms.er{color:#b3261e}#blk-gate .ms.ok{color:#2f5e53;font-weight:700}' +
    '#blk-gate .ft{text-align:center;color:#6B6459;font-size:14px;margin-top:22px}';
  var st = document.createElement('style'); st.id = 'blk-gate-css'; st.textContent = css;
  (document.head || de).appendChild(st);

  var ERR = {
    bad_login: '이름 또는 비밀번호가 맞지 않습니다.',
    name_taken: '이미 쓰이는 이름입니다. 다른 이름이나 별명을 정해 주세요.',
    invalid_name: '이름이나 별명을 적어 주세요.',
    weak_password: '비밀번호는 4자 이상으로 정해 주세요.',
    rate_limited: '잠시 후 다시 시도해 주세요.',
    pending_approval: '가입 신청이 접수되었습니다. 목사님 승인 후 로그인할 수 있습니다.',
    not_approved: '가입이 승인되지 않았습니다. 모임 진행자에게 문의해 주세요.',
    network: '연결이 원활하지 않습니다. 잠시 후 다시 시도해 주세요.'
  };
  function cfg() {
    var c = window.BOOKLOVE_CONFIG;
    if (c && c.supabaseUrl) return Promise.resolve(c);
    return new Promise(function (ok) {
      var s = document.createElement('script'); s.src = ROOT + 'community/config.js';
      s.onload = s.onerror = function () { ok(window.BOOKLOVE_CONFIG || {}); };
      document.head.appendChild(s);
    });
  }
  function rpc(name, body) {
    return cfg().then(function (c) {
      if (!c.supabaseUrl || !c.supabaseAnonKey) return { ok: false, error: 'network' };
      return fetch(c.supabaseUrl.replace(/\/$/, '') + '/rest/v1/rpc/' + name, {
        method: 'POST', body: JSON.stringify(body),
        headers: { apikey: c.supabaseAnonKey, Authorization: 'Bearer ' + c.supabaseAnonKey, 'Content-Type': 'application/json' }
      }).then(function (r) { return r.json().catch(function () { return null; }); })
        .then(function (j) { return j && typeof j === 'object' ? j : { ok: false, error: 'network' }; }, function () { return { ok: false, error: 'network' }; });
    });
  }
  function el(tag, attrs, kids) {
    var e = document.createElement(tag);
    for (var k in attrs || {}) e.setAttribute(k, attrs[k]);
    (kids || []).forEach(function (c) { e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  }
  function name(v) { return (v || '').replace(/\s+/g, ' ').trim().slice(0, 20); }
  function done(res) {
    try { localStorage.setItem(KEY, JSON.stringify({ t: res.token, id: res.id, name: res.name })); } catch (e) { }
    location.reload();
  }
  function build() {
    if (document.getElementById('blk-gate')) return;
    var ln = el('input', { type: 'text', autocomplete: 'username', maxlength: '20', autocapitalize: 'off' });
    var lp = el('input', { type: 'password', autocomplete: 'current-password', maxlength: '72' });
    var lm = el('p', { class: 'ms', role: 'status' }), lb = el('button', { class: 'bt', type: 'submit' }, ['로그인']);
    var lf = el('form', { novalidate: '' }, [el('h2', null, ['로그인']), el('label', null, ['이름 또는 별명', ln]), el('label', null, ['비밀번호', lp]), lb, lm]);
    var rn = el('input', { type: 'text', autocomplete: 'username', maxlength: '20', placeholder: '예: 김집사, 들꽃' });
    var rp = el('input', { type: 'password', autocomplete: 'new-password', maxlength: '72' });
    var rp2 = el('input', { type: 'password', autocomplete: 'new-password', maxlength: '72' });
    var rm = el('p', { class: 'ms', role: 'status' }), rb = el('button', { class: 'bt', type: 'submit' }, ['회원가입']);
    var rf = el('form', { novalidate: '' }, [el('h2', null, ['회원가입']),
      el('label', null, [el('span', null, ['이름 또는 별명 ', el('small', null, ['서평에 이 이름이 보입니다. 20자까지.'])]), rn]),
      el('label', null, [el('span', null, ['비밀번호 ', el('small', null, ['4자 이상'])]), rp]),
      el('label', null, ['비밀번호 한 번 더', rp2]), rb, rm]);
    rf.hidden = true;
    var sw = el('button', { class: 'sw', type: 'button' }, ['처음이신가요? 회원가입']);
    sw.addEventListener('click', function () {
      var toJoin = rf.hidden; rf.hidden = !toJoin; lf.hidden = toJoin;
      sw.textContent = toJoin ? '이미 회원이신가요? 로그인' : '처음이신가요? 회원가입';
      (toJoin ? rn : ln).focus();
    });
    function go(btn, msg, bad, send, ok) {
      msg.className = 'ms'; msg.textContent = '';
      if (bad) { msg.className = 'ms er'; msg.textContent = bad; return; }
      btn.disabled = true; msg.textContent = '잠시만요…';
      send().then(function (res) {
        btn.disabled = false;
        if (res && res.ok) { msg.textContent = ''; ok(res); return; }
        var e = (res && res.error) || 'network';
        msg.className = 'ms er'; msg.textContent = ERR[e] || ERR.network;
      });
    }
    lf.addEventListener('submit', function (e) {
      e.preventDefault();
      go(lb, lm, !name(ln.value) ? ERR.invalid_name : !lp.value ? '비밀번호를 적어 주세요.' : null,
        function () { return rpc('login', { p_name: name(ln.value), p_password: lp.value }); }, done);
    });
    rf.addEventListener('submit', function (e) {
      e.preventDefault();
      go(rb, rm, !name(rn.value) ? ERR.invalid_name : rp.value.length < 4 ? ERR.weak_password : rp.value !== rp2.value ? '비밀번호가 서로 다릅니다.' : null,
        function () { return rpc('register', { p_code: '', p_name: name(rn.value), p_password: rp.value }); },
        function (res) {
          if (res.token) { done(res); return; }   // before migrate_06: signed up and logged in
          rn.value = rp.value = rp2.value = ''; rm.className = 'ms ok'; rm.textContent = ERR.pending_approval;
        });
    });
    var box = el('div', { id: 'blk-gate', role: 'main' }, [el('div', { class: 'gx' }, [
      el('p', { class: 'br' }, ['BooKLove']), el('p', { class: 'tl' }, ['책으로 삶을 읽는 북클럽 멤버 공간입니다.']),
      lf, rf, sw, el('p', { class: 'ft' }, ['한 번 로그인하면 이 기기에서는 로그아웃할 때까지 다시 묻지 않습니다.'])])]);
    document.body.insertBefore(box, document.body.firstChild);
  }
  if (document.body) build(); else document.addEventListener('DOMContentLoaded', build);
})();
