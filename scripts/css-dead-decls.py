#!/usr/bin/env python3
"""Delete provably-dead declarations from earlier duplicate rules.

Safe by construction: identical selector text in the same at-rule context means
identical specificity, so a later rule's declaration of property P always beats
an earlier one's. The earlier declaration can never apply, in any state, scheme
or media context. Removing it cannot change any computed style.

Never moves a declaration. Never touches the later rule.
"""
import re, sys

def parse(src):
    """-> list of rules: dict(ctx, sel, sel_start, body_start, body_end, end)."""
    # mask comments, preserving length
    masked = list(src)
    for m in re.finditer(r'/\*.*?\*/', src, flags=re.S):
        for i in range(m.start(), m.end()):
            if masked[i] != '\n':
                masked[i] = ' '
    masked = ''.join(masked)
    rules, stack, pos = [], [], 0
    for m in re.finditer(r'[{}]', masked):
        if m.group() == '{':
            raw = src[pos:m.start()]
            # The head may be preceded by a comment. Strip comments BEFORE the
            # at-rule test — a `/* … */ @media (…)` head that fails startswith('@')
            # makes every rule inside it look top-level, which silently groups it
            # with an unrelated rule of the same name. That was the bug behind
            # three corrupted merges.
            head = re.sub(r'/\*.*?\*/', '', raw, flags=re.S).strip()
            offset = raw.rfind('*/') + 2 if '*/' in raw else 0
            tail = raw[offset:]
            sel_start = pos + offset + (len(tail) - len(tail.lstrip()))
            stack.append((head, sel_start, m.end()))
            pos = m.end()
        else:
            head, sel_start, body_start = stack.pop()
            ctx = ' | '.join(h for h, _, _ in stack if h.startswith('@'))
            if not head.startswith('@'):
                sel = re.sub(r'\s+', ' ', head).strip()
                rules.append(dict(ctx=ctx, sel=sel, sel_start=sel_start,
                                  body_start=body_start, body_end=m.start(), end=m.end()))
            pos = m.end()
    assert not stack, 'unbalanced braces'
    rules.sort(key=lambda r: r['sel_start'])
    return rules

def decls(body):
    """-> [(prop, start, end)] relative to body; splits only on top-level ';'."""
    b = re.sub(r'/\*.*?\*/', lambda m: ' ' * len(m.group()), body, flags=re.S)
    out, depth, start = [], 0, 0
    for i, c in enumerate(b):
        if c == '(':
            depth += 1
        elif c == ')':
            depth -= 1
        elif c == ';' and depth == 0:
            seg = b[start:i]
            if ':' in seg and seg.strip():
                out.append((seg.split(':', 1)[0].strip(), start, i + 1))
            start = i + 1
    seg = b[start:]
    if ':' in seg and seg.strip():
        out.append((seg.split(':', 1)[0].strip(), start, len(body)))
    return out

def fold(src):
    assert '!important' not in src, '!important breaks the equal-specificity argument'
    rules = parse(src)
    groups = {}
    for r in rules:
        groups.setdefault((r['ctx'], r['sel']), []).append(r)

    edits, killed, dropped = [], 0, 0
    for bl in groups.values():
        if len(bl) < 2:
            continue
        for i, e in enumerate(bl[:-1]):
            later = set()
            for l in bl[i + 1:]:
                later |= {d[0] for d in decls(src[l['body_start']:l['body_end']])}
            body = src[e['body_start']:e['body_end']]
            ds = decls(body)
            dead = [d for d in ds if d[0] in later]
            if not dead:
                continue
            if len(dead) == len(ds):
                edits.append((e['sel_start'], e['end']))
                dropped += 1
                killed += len(dead)
            else:
                for _, a, b in dead:
                    edits.append((e['body_start'] + a, e['body_start'] + b))
                    killed += 1

    # INVARIANT 1: no edit may overlap another
    edits = sorted(set(edits))
    for (a1, b1), (a2, b2) in zip(edits, edits[1:]):
        assert b1 <= a2, f'overlapping edits {(a1, b1)} {(a2, b2)}'

    out = src
    for a, b in sorted(edits, reverse=True):
        out = out[:a] + out[b:]
    out = re.sub(r'\{\s*;', '{', out)
    out = re.sub(r';[ \t]*;', ';', out)
    out = re.sub(r'[ \t]+\n', '\n', out)
    out = re.sub(r'\n{3,}', '\n\n', out)

    # INVARIANT 2: every surviving rule's SELECTOR TEXT is untouched.
    # This is what catches a span that wandered into a selector.
    before = [(r['ctx'], r['sel']) for r in rules]
    after = [(r['ctx'], r['sel']) for r in parse(out)]
    assert len(before) - len(after) == dropped, \
        f'rule count moved by {len(before) - len(after)}, expected {dropped}'
    bi = iter(after)
    cur = next(bi, None)
    for x in before:
        if cur == x:
            cur = next(bi, None)
    assert cur is None, 'surviving selectors are not a subsequence of the originals'

    # INVARIANT 3: no surviving declaration text was altered
    keep_before = []
    for r in rules:
        body = src[r['body_start']:r['body_end']]
        keep_before += [body[a:b].strip() for _, a, b in decls(body)]
    keep_after = []
    for r in parse(out):
        body = out[r['body_start']:r['body_end']]
        keep_after += [body[a:b].strip() for _, a, b in decls(body)]
    assert len(keep_before) - len(keep_after) == killed, \
        f'declaration count moved by {len(keep_before) - len(keep_after)}, expected {killed}'
    for d in keep_after:
        assert d in keep_before, f'declaration text changed: {d[:60]!r}'
    return out, killed, dropped

if __name__ == '__main__':
    path = sys.argv[1]
    src = open(path).read()
    out, killed, dropped = fold(src)
    if len(sys.argv) > 2 and sys.argv[2] == '--write':
        open(path, 'w').write(out)
    print(f'deleted {killed} dead declarations; {dropped} rules emptied and removed')
    if killed and '--write' not in sys.argv:
        sys.exit(f'{killed} dead declarations in {path} — run with --write to remove them')
