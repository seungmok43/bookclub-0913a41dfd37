#!/usr/bin/env python3
"""Verify emphasis marking changed no text: each session page, with the four mark tags and the
legend removed, must equal the version at git tag pre-emphasis-20261123.
Usage: python3 tools/check_marks.py [paths...]"""
import re, subprocess, sys, glob
LEG = re.compile(r'<p class="mkey">.*?</p>', re.S)
PAT = [r'<span class="(?:tm|u)">((?:(?!<span|</span>).)*?)</span>', r'<mark class="pt">((?:(?!<mark).)*?)</mark>', r'<b class="k">((?:(?!<b[ >]).)*?)</b>']
def strip(s):
    s = LEG.sub('', s)
    for _ in range(4):
        for p in PAT: s = re.sub(p, r'\1', s, flags=re.S)
    return s
bad = 0
for f in (sys.argv[1:] or sorted(glob.glob('*/20*/index.html'))):
    new = open(f, encoding='utf8').read()
    old = subprocess.run(['git', 'show', 'pre-emphasis-20261123:' + f], capture_output=True, text=True).stdout
    ok = strip(new) == old
    bad += (not ok)
    c = lambda t: new.count(t)
    print('OK  ' if ok else 'DIFF', f, 'pt=%d k=%d tm=%d u=%d' % (c('<mark class="pt">'), c('<b class="k">'), c('<span class="tm">'), c('<span class="u">')), 'legend' if c('class="mkey"') else 'NO-LEGEND')
sys.exit(1 if bad else 0)
