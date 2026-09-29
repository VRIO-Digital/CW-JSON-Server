import json, re, sys
def ty(v):
    if v is None: return 'null'
    if isinstance(v, bool): return 'boolean'
    if isinstance(v, (int, float)): return 'number'
    if isinstance(v, str): return 'string'
    if isinstance(v, list): return 'array'
    return 'object'
def is_map(o, p):
    ks = list(o.keys())
    if len(ks) < 8: return bool(re.search(r'authoring_fixture\.derived$|expansions$|headroom$', p))
    vs = list(o.values()); t0 = ty(vs[0])
    if not all(ty(v) == t0 for v in vs): return False
    if t0 not in ('object', 'array'): return len(ks) > 20
    return True
def schema(db):
    S = {}
    def walk(v, p):
        t = ty(v); S.setdefault(p, set()).add(t)
        if t == 'array':
            for x in v: walk(x, p + '[]')
        if t == 'object':
            if is_map(v, p):
                for x in v.values(): walk(x, p + '{*}')
            else:
                for k, x in v.items(): walk(x, p + '.' + k)
    for k, v in db.items(): walk(v, k)
    return {p: s for p, s in S.items() if not p.startswith('reports.reports[].blocks[]') and not p.startswith('settings.') and not p.startswith('_provenance')}
if __name__ == '__main__':
    db = json.load(open(sys.argv[1]))
    s = schema(db)
    out = "\n".join(f"{p}|{'/'.join(sorted(t))}" for p, t in s.items())
    open(sys.argv[2], 'w').write(out); print(len(out), len(s))
