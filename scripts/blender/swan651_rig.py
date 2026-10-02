"""Swan 651: armo (albero, boma, sartiame, vele) e attrezzatura di coperta.

Va eseguito dopo swan651_hull.py nello stesso namespace, perché riusa le sue funzioni:
    ns = {}
    exec(open(".../swan651_hull.py").read(), ns)
    exec(open(".../swan651_rig.py").read(), ns)

Misure dell'armo dal certificato IRC 40418 (Lunz am Meer, 2026):
J 8,05  P 24,00  E 7,04  HLU 26,56  HLP 7,81  3 coppie di crocette.
"""
import math

import bmesh
import bpy
from mathutils import Matrix, Vector

# ---------------------------------------------------------------------------
# Misure IRC
# ---------------------------------------------------------------------------
J = 8.05
P = 24.00
E = 7.04
HLU = 26.56
HLP = 7.81
MAIN_WIDTHS = [(0.0, E), (0.5, 4.67), (0.75, 2.82), (0.875, 1.63), (1.0, 0.18)]
JIB_WIDTHS = [(0.5, 4.09), (0.75, 2.22), (0.875, 1.21), (1.0, 0.05)]

MAST_CHORD = 0.36         # profilo albero longitudinale
MAST_WIDTH = 0.22         # profilo albero trasversale
STEMHEAD_X = LOA - 0.05   # attacco dello strallo sulla prua (albero in pianta a ~11,9 m)
MAST_FRONT_X = STEMHEAD_X - J
MAST_X = MAST_FRONT_X - MAST_CHORD / 2
MAST_AFT_X = MAST_X - MAST_CHORD / 2
DECK_AT_MAST = deck_z(MAST_X, 0.0)
I_HEIGHT = math.sqrt(HLU ** 2 - J ** 2)       # stimato: il certificato non riporta I
MASTHEAD_Z = interp(SHEER, STEMHEAD_X) + 0.1 + I_HEIGHT + 0.25
BOOM_Z = MASTHEAD_Z - 0.55 - P                # P si misura dalla fascia del boma
MAST_FOOT_Z = smooth(CANOE, MAST_X) + 0.15    # albero passante, in chiglia

MAT_SPAR = material("Spar_Aluminium", (0.78, 0.79, 0.8), 0.3, metallic=0.9)
MAT_WIRE = material("Rigging_Wire", (0.55, 0.56, 0.58), 0.25, metallic=1.0)
MAT_SAIL = material("Sail_Laminate", (0.62, 0.64, 0.66), 0.55)
MAT_STEEL = material("Stainless", (0.85, 0.86, 0.88), 0.12, metallic=1.0)
MAT_WINCH = material("Winch_Chrome", (0.75, 0.75, 0.76), 0.15, metallic=1.0)
MAT_BLACK = material("Black_Plastic", (0.02, 0.02, 0.02), 0.5)


# ---------------------------------------------------------------------------
# Primitive
# ---------------------------------------------------------------------------
def add_tube(bm, p0, p1, r, seg=8, cap=True):
    """Cilindro tra due punti (coordinate barca, poi convertite)."""
    a, b = Vector(to_world(*p0)), Vector(to_world(*p1))
    axis = b - a
    if axis.length < 1e-6:
        return
    z = axis.normalized()
    x = z.orthogonal().normalized()
    y = z.cross(x)
    ra, rb = [], []
    for i in range(seg):
        t = 2 * math.pi * i / seg
        off = (x * math.cos(t) + y * math.sin(t)) * r
        ra.append(bm.verts.new(a + off))
        rb.append(bm.verts.new(b + off))
    for i in range(seg):
        j = (i + 1) % seg
        f = bm.faces.new((ra[i], ra[j], rb[j], rb[i]))
        f.smooth = True
    if cap:
        bm.faces.new(list(reversed(ra)))
        bm.faces.new(rb)


def add_box(bm, center, size):
    cx, cy, cz = center
    sx, sy, sz = size
    vs = []
    for dx in (-1, 1):
        for dy in (-1, 1):
            for dz in (-1, 1):
                vs.append(bm.verts.new(to_world(cx + dx * sx / 2, cy + dy * sy / 2, cz + dz * sz / 2)))
    idx = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
    for q in idx:
        bm.faces.new([vs[i] for i in q])


def finish(bm, name, mats, col):
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    triangulate_ngons(bm)
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    obj = replace_object(name, mesh, col)
    for m in mats:
        obj.data.materials.append(m)
    return obj


# ---------------------------------------------------------------------------
# Albero e boma
# ---------------------------------------------------------------------------
def mast_section(z):
    """Profilo ellittico che si rastrema negli ultimi metri."""
    taper = 1.0 - 0.45 * smoothstep(MASTHEAD_Z - 7.0, MASTHEAD_Z, z)
    return MAST_CHORD / 2 * taper, MAST_WIDTH / 2 * taper


def build_mast(col):
    bm = bmesh.new()
    seg = 16
    zs = [MAST_FOOT_Z] + [DECK_AT_MAST + i * (MASTHEAD_Z - DECK_AT_MAST) / 40 for i in range(41)]
    rings = []
    for z in zs:
        a, b = mast_section(z)
        ring = []
        for i in range(seg):
            t = 2 * math.pi * i / seg
            ring.append(bm.verts.new(to_world(MAST_X + a * math.cos(t), b * math.sin(t), z)))
        rings.append(ring)
    for r0, r1 in zip(rings, rings[1:]):
        for i in range(seg):
            j = (i + 1) % seg
            f = bm.faces.new((r0[i], r0[j], r1[j], r1[i]))
            f.smooth = True
    bm.faces.new(list(reversed(rings[0])))
    bm.faces.new(rings[-1])
    # Testa d'albero e crocette
    add_box(bm, (MAST_X, 0, MASTHEAD_Z + 0.06), (0.5, 0.16, 0.12))
    for z, half_span in spreaders():
        for side in (-1, 1):
            add_tube(bm, (MAST_X, side * 0.1, z), (MAST_X, side * half_span, z), 0.035, seg=6)
    return finish(bm, "Mast", [MAT_SPAR], col)


def spreaders():
    """Tre coppie di crocette: quota e semiapertura."""
    h = MASTHEAD_Z - DECK_AT_MAST
    return [(DECK_AT_MAST + h * 0.28, 1.85), (DECK_AT_MAST + h * 0.52, 1.45),
            (DECK_AT_MAST + h * 0.76, 0.95)]


BOOM_ANGLE = math.radians(7)   # boma leggermente lascato a dritta


def boom_point(dist, dz=0.0):
    """Punto lungo il boma a distanza dist dal lato poppiero dell'albero."""
    return (MAST_AFT_X - dist * math.cos(BOOM_ANGLE), -dist * math.sin(BOOM_ANGLE), BOOM_Z + dz)


def build_boom(col):
    bm = bmesh.new()
    length = E + 0.45
    seg = 12
    rings = []
    n = 12
    for i in range(n + 1):
        d = length * i / n
        hh = 0.16 * (1 - 0.35 * (abs(i / n - 0.45) / 0.55) ** 2)   # più alto a metà
        x, y, z = boom_point(d)
        ring = []
        for k in range(seg):
            t = 2 * math.pi * k / seg
            ring.append(bm.verts.new(to_world(x, y + 0.08 * math.cos(t), z - hh / 2 + hh / 2 * math.sin(t))))
        rings.append(ring)
    for r0, r1 in zip(rings, rings[1:]):
        for k in range(seg):
            j = (k + 1) % seg
            f = bm.faces.new((r0[k], r0[j], r1[j], r1[k]))
            f.smooth = True
    bm.faces.new(list(reversed(rings[0])))
    bm.faces.new(rings[-1])
    # Vang
    add_tube(bm, boom_point(1.6, -0.1), (MAST_AFT_X - 0.05, 0, DECK_AT_MAST + 0.35), 0.03, seg=6)
    return finish(bm, "Boom", [MAT_SPAR], col)


# ---------------------------------------------------------------------------
# Sartiame
# ---------------------------------------------------------------------------
def chainplate(x, inset=0.32):
    _, _, yd, _, _, _ = station_params(x)
    return yd - inset


def build_rigging(col):
    bm = bmesh.new()
    r = 0.009
    top = (MAST_X, 0, MASTHEAD_Z)
    stem = (STEMHEAD_X, 0, interp(SHEER, STEMHEAD_X) + 0.1)
    add_tube(bm, stem, (MAST_FRONT_X, 0, MASTHEAD_Z - 0.1), 0.011, seg=6)        # strallo
    stern = (TRANSOM_TOP[0] + 0.15, 0, TRANSOM_TOP[1] + 0.1)
    add_tube(bm, (MAST_AFT_X, 0, MASTHEAD_Z - 0.05), stern, 0.010, seg=6)        # paterazzo
    sp = spreaders()
    for side in (-1, 1):
        cy = side * chainplate(MAST_X)
        deck_pt = (MAST_X, cy, deck_z(MAST_X, cy) + 0.05)
        # Sartie alte: testa d'albero -> estremità crocette -> lande
        pts = [(MAST_X, side * 0.1, MASTHEAD_Z - 0.3)] + \
              [(MAST_X, side * hs, z) for z, hs in reversed(sp)] + [deck_pt]
        for a, b in zip(pts, pts[1:]):
            add_tube(bm, a, b, r, seg=6)
        # Sartie basse: dalla prima crocetta alle lande prodiere e poppiere
        z1 = sp[0][0]
        for dx in (-0.55, 0.55):
            x = MAST_X + dx
            yy = side * chainplate(x, 0.38)
            add_tube(bm, (MAST_X, side * 0.11, z1), (x, yy, deck_z(x, yy) + 0.05), r, seg=6)
        # Volanti (runner) dalla terza crocetta verso poppa
        x = 4.2
        yy = side * chainplate(x, 0.12)
        add_tube(bm, (MAST_AFT_X, side * 0.08, sp[2][0]), (x, yy, deck_z(x, yy) + 0.1), 0.007, seg=6)
    return finish(bm, "Rigging", [MAT_WIRE], col)


# ---------------------------------------------------------------------------
# Vele (con morph "gonfia" per il web)
# ---------------------------------------------------------------------------
def width_at(table, f):
    return interp(table, f)


def build_sail(col, name, rows, depth, side_offset):
    """rows: lista di (punto luff, direzione corda, larghezza) dal basso all'alto."""
    nu = 14
    bm = bmesh.new()
    grid = []
    for (lp, d, w, off) in rows:
        row = []
        for j in range(nu + 1):
            v = j / nu
            x = lp[0] + d[0] * w * v
            z = lp[2] + d[1] * w * v
            camber = depth * w * 4 * v * (1 - v) * (1.15 - 0.3 * v)
            y = lp[1] + off * v - camber * side_offset
            row.append(bm.verts.new(to_world(x, y, z)))
        grid.append(row)
    for a, b in zip(grid, grid[1:]):
        for j in range(nu):
            f = bm.faces.new((a[j], a[j + 1], b[j + 1], b[j]))
            f.smooth = True
    obj = finish(bm, name, [MAT_SAIL], col)
    # Morph target: vela che fileggia (camber e svergolamento quasi nulli)
    obj.shape_key_add(name="Basis")
    flat = obj.shape_key_add(name="Luffing")
    for k in flat.data:
        k.co.y *= 0.2
    obj.data.shape_keys.use_relative = True
    return obj


def build_sails(col):
    # Randa: inferitura lungo il lato poppiero dell'albero, base lungo il boma
    rows = []
    n = 24
    for i in range(n + 1):
        f = i / n
        z = BOOM_Z + 0.12 + f * P
        w = width_at(MAIN_WIDTHS, f)
        # la corda segue la rotazione del boma
        off = -w * math.sin(BOOM_ANGLE) * (1 - 0.4 * f)
        rows.append(((MAST_AFT_X - 0.02, 0.0, z), (-1.0, 0.0), w, off))
    main = build_sail(col, "Mainsail", rows, 0.08, 1.0)

    # Fiocco: inferitura sullo strallo; LP perpendicolare alla bugna
    tack = Vector((STEMHEAD_X - 0.15, interp(SHEER, STEMHEAD_X) + 0.55))
    head = Vector((MAST_FRONT_X + 0.25, MASTHEAD_Z - 0.35))
    d = (head - tack).normalized()
    perp = Vector((-d.y, d.x))
    if perp.x > 0:
        perp = -perp
    # La bugna sta dove la perpendicolare lunga LP cade a circa 2,3 m sopra la coperta
    f_clew = 0.12
    rows = []
    n = 24
    for i in range(n + 1):
        f = i / n
        lp2 = tack + d * (HLU * f)
        if f <= f_clew:
            w = HLP * f / f_clew
        else:
            w = width_at([(f_clew, HLP)] + JIB_WIDTHS, f)
        off = -1.25 * (1 - f) * (w / HLP)
        # direzione corda: perpendicolare all'inferitura, tirata verso il basso vicino alla base
        cd = (perp * (1 - 0.25 * (1 - f))).normalized() if f > f_clew else perp
        rows.append(((lp2.x, 0.0, lp2.y), (cd.x, cd.y), w, off))
    jib = build_sail(col, "Headsail", rows, 0.10, 1.0)
    return main, jib


# ---------------------------------------------------------------------------
# Attrezzatura di coperta
# ---------------------------------------------------------------------------
def winch(bm, x, y, r=0.13, h=0.24, z0=None):
    if z0 is None:
        z0 = deck_z(x, y)
    add_tube(bm, (x, y, z0), (x, y, z0 + h * 0.55), r, seg=16)
    add_tube(bm, (x, y, z0 + h * 0.55), (x, y, z0 + h), r * 0.78, seg=16)


def build_winches(col):
    bm = bmesh.new()
    w = cockpit_half_width()
    for side in (-1, 1):
        winch(bm, 5.3, side * (w + 0.38), 0.16, 0.28)      # primari
        winch(bm, 6.6, side * (w + 0.42), 0.14, 0.25)      # secondari
        winch(bm, 3.7, side * (w + 0.32), 0.12, 0.22)      # randa e volanti
        winch(bm, MAST_X - 0.9, side * 0.55, 0.11, 0.2,
              coachroof_side_height(MAST_X - 0.9) + CR_ROOF_CAMBER * 0.6)   # drizze
        for xw in (8.75, 9.45, 10.15):                     # tre coppie sulla tuga (pianta di coperta)
            yw = side * coachroof_side_y(xw, coachroof_side_height(xw)) * 0.72
            winch(bm, xw, yw, 0.12, 0.22, coachroof_side_height(xw) + CR_ROOF_CAMBER * 0.45)
    return finish(bm, "Winches", [MAT_WINCH], col)


def build_wheel(col):
    bm = bmesh.new()
    x = COCKPIT_AFT + 1.1
    zf = cockpit_floor(x)
    cz = zf + 1.05
    rad = 0.82
    seg = 40
    ring = []
    for i in range(seg + 1):
        t = 2 * math.pi * i / seg
        ring.append((x, rad * math.cos(t), cz + rad * math.sin(t)))
    for a, b in zip(ring, ring[1:]):
        add_tube(bm, a, b, 0.018, seg=6, cap=False)
    for k in range(6):
        t = 2 * math.pi * k / 6
        add_tube(bm, (x, 0, cz), (x, rad * math.cos(t), cz + rad * math.sin(t)), 0.012, seg=6)
    add_tube(bm, (x + 0.05, 0, cz), (x + 0.35, 0, cz), 0.05, seg=10)          # mozzo
    add_tube(bm, (x + 0.35, 0, zf), (x + 0.35, 0, cz + 0.1), 0.11, seg=12)    # colonnina
    return finish(bm, "Wheel", [MAT_STEEL], col)


def build_lifelines(col):
    bm = bmesh.new()
    h = 0.68
    xs = [TRANSOM_DECK_X + 0.5 + i * 1.97 for i in range(9)]
    tops = {}
    for side in (-1, 1):
        posts = []
        for x in xs:
            _, _, yd, _, _, _ = station_params(x)
            y = side * (yd - 0.07)
            z0 = deck_z(x, y)
            add_tube(bm, (x, y, z0), (x, y, z0 + h), 0.014, seg=6)
            posts.append((x, y, z0))
        tops[side] = posts
        for (a, b) in zip(posts, posts[1:]):
            for hh in (h * 0.5, h):
                add_tube(bm, (a[0], a[1], a[2] + hh), (b[0], b[1], b[2] + hh), 0.004, seg=4, cap=False)
    # Pulpito di prua
    xb = LOA - 0.6
    pts = []
    for k in range(9):
        t = math.pi * k / 8
        x = xb - 0.9 * math.sin(t)
        _, _, yd, _, _, _ = station_params(x)
        y = -(yd - 0.07) * math.cos(t)
        pts.append((x, y, deck_z(x, y) + h))
    for a, b in zip(pts, pts[1:]):
        add_tube(bm, a, b, 0.016, seg=6, cap=False)
    for p in (pts[0], pts[4], pts[-1]):
        add_tube(bm, (p[0], p[1], deck_z(p[0], p[1])), p, 0.016, seg=6)
    for side in (-1, 1):
        last = tops[side][-1]
        add_tube(bm, (last[0], last[1], last[2] + h), pts[0 if side < 0 else -1], 0.004, seg=4, cap=False)
    # Pulpito di poppa
    xs0 = TRANSOM_DECK_X + 0.15
    pts = []
    for k in range(9):
        t = math.pi * k / 8
        x = xs0 + 0.5 * math.sin(t)
        _, _, yd, _, _, _ = station_params(x)
        y = -(yd - 0.08) * math.cos(t)
        pts.append((x, y, deck_z(x, y) + h))
    for a, b in zip(pts, pts[1:]):
        add_tube(bm, a, b, 0.016, seg=6, cap=False)
    for p in (pts[0], pts[4], pts[-1]):
        add_tube(bm, (p[0], p[1], deck_z(p[0], p[1])), p, 0.016, seg=6)
    return finish(bm, "Lifelines", [MAT_STEEL], col)


def build_hatches(col):
    bm = bmesh.new()
    # Osteriggi dalla pianta di coperta del cantiere: (x, y, lato)
    for x, y, size in ((17.2, 0.0, 0.55), (15.8, 0.0, 0.9), (13.0, 0.45, 0.4), (13.0, -0.45, 0.4),
                       (9.85, 0.0, 0.65)):
        top = max(coachroof_side_height(x) + CR_ROOF_CAMBER, deck_z(x, y)) if x < CR_FWD else deck_z(x, y)
        add_box(bm, (x, y, top + 0.04), (size, size, 0.08))
    # Gavone dell'ancora a prua
    add_box(bm, (18.4, 0, deck_z(18.4, 0) + 0.02), (0.9, 0.5, 0.04))
    # Tambuccio scorrevole all'estremità poppiera della tuga
    x = COCKPIT_FWD + 0.45
    add_box(bm, (x, 0, coachroof_side_height(x) + CR_ROOF_CAMBER + 0.08), (0.9, 0.8, 0.12))
    # Rotaie del genoa e trasto della randa
    for side in (-1, 1):
        x0, x1 = 5.4, 8.6
        y0 = side * (station_params(x0)[2] * 0.78)
        y1 = side * (station_params(x1)[2] * 0.78)
        add_tube(bm, (x0, y0, deck_z(x0, y0) + 0.02), (x1, y1, deck_z(x1, y1) + 0.02), 0.022, seg=4)
    xt = COCKPIT_FWD + 0.1
    zt = coachroof_side_height(xt) + CR_ROOF_CAMBER + 0.03
    w = coachroof_half_width(xt)
    add_tube(bm, (xt, -w * 0.9, zt), (xt, w * 0.9, zt), 0.03, seg=6)
    return finish(bm, "DeckHardware", [MAT_BLACK], col)


def build_rig_all():
    col = get_collection("Swan651")
    build_mast(col)
    build_boom(col)
    build_rigging(col)
    build_sails(col)
    build_winches(col)
    build_wheel(col)
    build_lifelines(col)
    build_hatches(col)
    return {"mast_x_from_stern": round(MAST_X, 2), "masthead_z": round(MASTHEAD_Z, 2),
            "boom_z": round(BOOM_Z, 2), "I_est": round(I_HEIGHT, 2),
            "air_draft": round(MASTHEAD_Z, 2)}


rig_result = build_rig_all()
print(rig_result)
