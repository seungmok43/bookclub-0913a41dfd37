#!/usr/bin/env python3
"""Bring every meeting-record page (<book>/<YYYY-MM-DD>/index.html) to the v2 look — re-runnable.

What it changes, per page (page text is never touched):
  1. <head>: one marked block that loads v2/session.css (v2 fonts, colours, 13px floor, 44px taps)
     and v2/gate.js (login first: members only see the page after logging in once on the device).
  2. end of <body>: one marked block that loads v2/toc.js (목차) and v2/session.js (가/가+, reading bar).
  3. the top 「←」 link now goes to the v2 book screen  ../../#/book/<slug>  (text: ← <book title>).
  4. the <nav class="sn"> block is rebuilt from community/catalog.js:
       이전/다음 회차 within the book; where the book has none, the club's previous/next meeting
       (any book, by date); 서평 links go to the v2 book screen (#/book/<slug>, #/book/<slug>/write).
Also, for each one-page book summary (<book>/index.html): one marked <head> block loading
v2/bookpage.css (13px floor, 44px taps) and its 「서평」 link pointed at the v2 book screen.
Old blocks from an earlier run are replaced, so running it twice gives the same files.

Usage:  python3 tools/session_pass.py [--check]     (--check: report only, write nothing)
"""
import json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DAYS_OK = re.compile(r'^([a-z0-9-]+)/(\d{4}-\d{2}-\d{2})/$')
HEAD = ('<!-- v2:head -->\n<link rel="stylesheet" href="../../v2/session.css">\n'
        '<script src="../../v2/gate.js"></script>\n<!-- /v2:head -->\n')
TAIL = ('<!-- v2:tail -->\n<script src="../../v2/toc.js" defer></script>'
        '<script src="../../v2/session.js" defer></script>\n<!-- /v2:tail -->\n')


def catalog():
    with open(os.path.join(ROOT, 'community', 'catalog.js'), encoding='utf-8') as f:
        return [json.loads(l.rstrip().rstrip(',')) for l in f.read().splitlines() if l.startswith('{')]


def dot(d):
    return d.replace('-', '.')


def esc(s):
    return s.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;').replace('"', '&quot;')


def main():
    check = '--check' in sys.argv
    books = catalog()
    title = {b['slug']: b.get('title') or '' for b in books}
    per_book, timeline = {}, []
    for b in books:
        ss = sorted([s for s in b['sessions'] if DAYS_OK.match(s['href'])], key=lambda s: s['date'])
        per_book[b['slug']] = ss
        timeline += [(s['date'], b['slug'], s) for s in ss]
    timeline.sort(key=lambda x: (x[0], x[1]))
    pos = {x[2]['href']: i for i, x in enumerate(timeline)}

    def link(cls, label, s, slug, cross):
        href = '../../' + s['href']
        if cross:
            body = f'<small>{label}</small><b>{esc(title[slug])}</b>{dot(s["date"])} ({s["day"]})'
        else:
            body = f'<small>{label}</small>{s["round"]}회 · {dot(s["date"])} ({s["day"]})'
        return f'<a class="{cls}" href="{href}">{body}</a>'

    changed = 0
    report = []
    for slug, ss in per_book.items():
        for i, s in enumerate(ss):
            path = os.path.join(ROOT, s['href'], 'index.html')
            if not os.path.exists(path):
                report.append(f'MISSING {s["href"]}')
                continue
            t0 = open(path, encoding='utf-8').read()
            t = t0
            # prev / next
            if i > 0:
                pv = link('pv', '← 이전 회차', ss[i - 1], slug, False)
            else:
                g = pos[s['href']] - 1
                pv = link('pv', '← 이전 모임', timeline[g][2], timeline[g][1], True) if g >= 0 else '<span class="em"></span>'
            if i < len(ss) - 1:
                nx = link('nx', '다음 회차 →', ss[i + 1], slug, False)
            else:
                g = pos[s['href']] + 1
                nx = link('nx', '다음 모임 →', timeline[g][2], timeline[g][1], True) if g < len(timeline) else '<span class="em"></span>'
            nav = (f'<nav class="sn" aria-label="회차 이동"><div class="pn">{pv}{nx}</div>'
                   f'<div class="rv"><a href="../../#/book/{slug}">이 책의 서평 <span data-blk-reviews="{slug}"></span>보기</a>'
                   f'<a class="go" href="../../#/book/{slug}/write">서평 남기기</a></div>'
                   f'<div class="bk"><a href="../../#/book/{slug}">이 책의 모든 기록 보기</a></div></nav>')
            if re.search(r'<nav class="sn"[^>]*>.*?</nav>', t, re.S):
                t = re.sub(r'<nav class="sn"[^>]*>.*?</nav>', lambda m: nav, t, count=1, flags=re.S)
            elif '<div id="comments"></div>' in t:
                t = t.replace('<div id="comments"></div>', nav + '\n<div id="comments"></div>', 1)
            else:
                report.append(f'NO-NAV-SPOT {s["href"]}')
            # back link → v2 book screen
            bt = title[slug] or slug
            t, n = re.subn(r'<a class="back" href="[^"]*">[^<]*</a>',
                           lambda m: f'<a class="back" href="../../#/book/{slug}">← {esc(bt)}</a>', t, count=1)
            if not n:
                report.append(f'NO-BACK {s["href"]}')
            # head / tail blocks
            t = re.sub(r'<!-- v2:head -->.*?<!-- /v2:head -->\n?', '', t, flags=re.S)
            t = re.sub(r'<!-- v2:tail -->.*?<!-- /v2:tail -->\n?', '', t, flags=re.S)
            t = t.replace('</head>', HEAD + '</head>', 1)
            k = t.rfind('</body>')
            t = t[:k] + TAIL + t[k:]
            if t != t0:
                changed += 1
                if not check:
                    with open(path, 'w', encoding='utf-8') as f:
                        f.write(t)
    bchanged = 0
    for b in books:
        path = os.path.join(ROOT, b['slug'], 'index.html')
        if not os.path.exists(path):
            continue
        t0 = open(path, encoding='utf-8').read()
        t = re.sub(r'<!-- v2:head -->.*?<!-- /v2:head -->\n?', '', t0, flags=re.S)
        t = t.replace('</head>', '<!-- v2:head -->\n<link rel="stylesheet" href="../v2/bookpage.css">\n<script src="../v2/gate.js"></script>\n<!-- /v2:head -->\n</head>', 1)
        t = t.replace(f'class="rvl" href="../community/#/book/{b["slug"]}"', f'class="rvl" href="../#/book/{b["slug"]}"')
        if t != t0:
            bchanged += 1
            if not check:
                with open(path, 'w', encoding='utf-8') as f:
                    f.write(t)
    print(f'pages={sum(len(v) for v in per_book.values())} changed={changed} book_pages_changed={bchanged} {"(check only)" if check else ""}')
    for r in report:
        print(r)


if __name__ == '__main__':
    main()
