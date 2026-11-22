/* BooKLove v2 — reading helpers for a meeting-record page.
   Include with <script src="../../v2/session.js" defer></script> (added by tools/session_pass.py).
   1) 가 / 가+ text-size control next to the back link. The choice is shared with the main site
      through localStorage 'blk_fs' (wrapped in try/catch; the page works without storage).
   2) A thin reading-position bar at the top of the screen. Changes no text of the page. */
(function () {
  'use strict';
  var KEY = 'blk_fs', STEPS = [1, 1.125, 1.25, 1.375];
  function get() { try { var v = parseFloat(localStorage.getItem(KEY)); return STEPS.indexOf(v) >= 0 ? v : 1; } catch (e) { return 1; } }
  function put(v) { try { if (v === 1) localStorage.removeItem(KEY); else localStorage.setItem(KEY, String(v)); } catch (e) { } }
  function apply(v) { document.documentElement.style.fontSize = v === 1 ? '' : (v * 100) + '%'; }
  apply(get());

  function build() {
    if (document.querySelector('.fsz')) return;
    var row = document.querySelector('.topbar, .top');
    if (row) {
      var box = document.createElement('span'); box.className = 'fsz'; box.setAttribute('role', 'group'); box.setAttribute('aria-label', '글자 크기');
      var dn = document.createElement('button'); dn.type = 'button'; dn.textContent = '가'; dn.setAttribute('aria-label', '글자 작게');
      var up = document.createElement('button'); up.type = 'button'; up.textContent = '가+'; up.setAttribute('aria-label', '글자 크게');
      function paint() { var i = STEPS.indexOf(get()); dn.disabled = i <= 0; up.disabled = i >= STEPS.length - 1; }
      function step(d) { var i = STEPS.indexOf(get()) + d; if (i < 0 || i >= STEPS.length) return; put(STEPS[i]); apply(STEPS[i]); paint(); onScroll(); }
      dn.addEventListener('click', function () { step(-1); });
      up.addEventListener('click', function () { step(1); });
      box.appendChild(dn); box.appendChild(up); row.appendChild(box); paint();
    }
    var bar = document.createElement('div'); bar.className = 'rprog'; bar.setAttribute('aria-hidden', 'true');
    document.body.appendChild(bar);
    var ticking = false;
    function onScroll() {
      if (ticking) return; ticking = true;
      requestAnimationFrame(function () {
        ticking = false;
        var de = document.documentElement, max = de.scrollHeight - window.innerHeight;
        bar.style.width = (max > 0 ? Math.min(100, Math.max(0, window.scrollY / max * 100)) : 0) + '%';
      });
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    onScroll();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build); else build();
})();
