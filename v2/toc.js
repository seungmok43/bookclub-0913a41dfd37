/* BooKLove v2 — tap-to-jump 목차 for a session page.
   Include with <script src=".../toc.js" defer></script>. Self-contained: reads the page's h2/h3,
   gives each an id, and inserts a small 목차 right after the page's one-line lead (p.oneliner /
   div.lead), or before the first subhead. Changes no text of the page. */
(function () {
  'use strict';
  function build() {
    if (document.querySelector('.v2toc')) return;
    var hs = [].slice.call(document.querySelectorAll('h2, h3')).filter(function (h) {
      return h.textContent.trim() && !h.closest('nav, footer, .v2toc, #comments');
    });
    if (hs.length < 2) return;
    var css = '.v2toc{margin:18px 0 22px;border:1px solid #E3DCCF;border-radius:14px;background:#fff;' +
      'font-family:Pretendard,"Apple SD Gothic Neo",system-ui,sans-serif;}' +
      '.v2toc summary{cursor:pointer;list-style:none;padding:13px 18px;font-weight:700;font-size:15px;color:#8C2F39;}' +
      '.v2toc summary::-webkit-details-marker{display:none}' +
      '.v2toc summary::after{content:" ▾";color:#6B6459;font-weight:400}' +
      '.v2toc[open] summary{border-bottom:1px solid #E3DCCF}' +
      '.v2toc ol{list-style:none;margin:0;padding:8px 8px 10px}' +
      '.v2toc a{display:block;padding:8px 10px;border-radius:9px;color:#23201B;text-decoration:none;font-size:15px;line-height:1.45;word-break:keep-all}' +
      '.v2toc a:hover,.v2toc a:active{background:#F3EEE4}' +
      '.v2toc li.l3 a{padding-left:24px;font-size:14px;color:#463f34}' +
      '.v2toc li.l3 a::before{content:"· ";color:#9a9488}';
    var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    var nav = document.createElement('details'); nav.className = 'v2toc'; nav.open = true;
    var sm = document.createElement('summary'); sm.textContent = '목차 · ' + hs.length + '개 소제목'; nav.appendChild(sm);
    var ol = document.createElement('ol');
    hs.forEach(function (h, i) {
      if (!h.id) h.id = 'toc-' + (i + 1);
      var li = document.createElement('li'); li.className = h.tagName === 'H3' ? 'l3' : 'l2';
      var a = document.createElement('a'); a.href = '#' + h.id; a.textContent = h.textContent.trim();
      a.addEventListener('click', function (e) {
        e.preventDefault(); h.scrollIntoView({ behavior: 'smooth', block: 'start' });
        try { history.replaceState(null, '', '#' + h.id); } catch (x) { }
      });
      li.appendChild(a); ol.appendChild(li);
    });
    nav.appendChild(ol);
    var anchor = document.querySelector('p.oneliner, div.lead');
    if (anchor && anchor.parentNode) {
      var host = anchor.closest('.hero') && !anchor.closest('.hero').contains(hs[0]) ? anchor.closest('.hero') : anchor;
      host.parentNode.insertBefore(nav, host.nextSibling);
    } else {
      var first = hs[0].closest('section') || hs[0];
      first.parentNode.insertBefore(nav, first);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build); else build();
})();
