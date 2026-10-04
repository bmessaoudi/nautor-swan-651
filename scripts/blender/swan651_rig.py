"""Swan 651: armo (albero, boma, sartiame, vele) e attrezzatura di coperta.

Va eseguito dopo swan651_hull.py nello stesso namespace, perché riusa le sue funzioni:
    ns = {}
    exec(open(".../swan651_hull.py").read(), ns)
    exec(open(".../swan651_rig.py").read(), ns)

Misure dell'armo dal certificato IRC 40418 (Lunz am Meer, 2026):
J 8,05  P 24,00  E 7,04  HLU 26,56  HLP 7,81  3 coppie di crocette.
"""
import math
import os

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
# Riferimenti: reference/photos_web/deck (verricelli Barient e Lewmar anni Ottanta con base nera,
# tamburo cromato rigato e self-tailing nero, bozzelli al piede d'albero, stopper sulla tuga) e
# la pianta di coperta in reference/photos_web/drawings/swan651_deck_layout_1.jpg.
#
# I pezzi che si ripetono (verricelli, bitte, bozzelli, stopper, passacavi, carrelli) sono mesh
# condivise: più oggetti Blender puntano agli stessi dati, l'export glTF scrive la mesh una volta
# sola e scripts/optimize_glb.mjs ne fa istanze GPU (EXT_mesh_gpu_instancing).
# Le loro mesh sono in coordinate locali: Z in alto, X lungo il pezzo, origine sulla base.
# Tutto il resto (rotaie, osteriggi, candelieri, ruota) resta in un oggetto per gruppo.

MAT_HATCH = material("Hatch_Frame", (0.74, 0.75, 0.76), 0.32, metallic=0.85)
DECK_PREFIXES = ("Winch", "Cleat", "Block_", "Stopper", "Fairlead", "GenoaCar", "Hatches")


def clear_deck_objects():
    """Toglie gli oggetti di coperta di un giro precedente: nomi e numero possono cambiare."""
    for o in list(bpy.data.objects):
        if o.name.startswith(DECK_PREFIXES):
            bpy.data.objects.remove(o, do_unlink=True)
    for m in list(bpy.data.meshes):
        if m.users == 0 and m.name.startswith(DECK_PREFIXES):
            bpy.data.meshes.remove(m)


def roof_z(x, y):
    """Quota della superficie calpestabile in (x, y): tetto della tuga se c'è, altrimenti coperta."""
    w = coachroof_half_width(x)
    if x >= COCKPIT_FWD and w > 1e-6:
        ztop = max(coachroof_side_height(x), deck_z(x, w))
        wt = coachroof_side_y(x, ztop)
        if wt > 1e-6 and abs(y) <= wt:
            r = abs(y) / wt
            return max(ztop, deck_z(x, y)) + CR_ROOF_CAMBER * (1 - r * r)
    return deck_z(x, y)


def lathe(bm, prof, seg, origin=None, rib_band=None, ribs=0):
    """Solido di rivoluzione attorno a Z, senza fondo (poggia sulla coperta).
    prof: (raggio, quota, materiale della fascia sopra, spigolo vivo) dal basso in alto.
    rib_band, ribs: fascia (fra gli anelli rib_band e rib_band + 1) che riceve le UV per la normal
    map delle righe del tamburo, ripetuta ribs volte sul giro (vedi winch_drum_normal).
    origin: punto in coordinate barca; senza, la mesh resta in coordinate locali."""
    rings = []
    for r, z, _, _ in prof:
        ring = []
        for i in range(seg):
            t = 2 * math.pi * i / seg
            px, py = r * math.cos(t), r * math.sin(t)
            co = to_world(origin[0] + px, origin[1] + py, origin[2] + z) if origin else (px, py, z)
            ring.append(bm.verts.new(co))
        rings.append(ring)
    uv = bm.loops.layers.uv.get("UVMap") or bm.loops.layers.uv.new("UVMap")
    for k in range(len(rings) - 1):
        r0, r1 = rings[k], rings[k + 1]
        for i in range(seg):
            j = (i + 1) % seg
            f = bm.faces.new((r0[i], r0[j], r1[j], r1[i]))
            f.smooth = True
            f.material_index = prof[k][2]
            if k == rib_band:
                f.tag = True
                u0, u1 = ribs * i / seg, ribs * (i + 1) / seg
                for loop, coord in zip(f.loops, ((u0, 0.55), (u1, 0.55), (u1, 0.95), (u0, 0.95))):
                    loop[uv].uv = coord
    cap = bm.faces.new(rings[-1])
    cap.material_index = prof[-1][2]
    for k, p in enumerate(prof):
        if p[3]:
            for i in range(seg):
                e = bm.edges.get((rings[k][i], rings[k][(i + 1) % seg]))
                if e is not None:
                    e.smooth = False
    return rings


def tube_local(bm, a, b, r, seg=6, cap=True, mat=0, smooth=True):
    """Come add_tube ma in coordinate locali, con l'indice del materiale."""
    a, b = Vector(a), Vector(b)
    axis = b - a
    z = axis.normalized()
    x = z.orthogonal().normalized()
    y = z.cross(x)
    ra, rb = [], []
    for i in range(seg):
        t = 2 * math.pi * i / seg
        off = (x * math.cos(t) + y * math.sin(t)) * r
        ra.append(bm.verts.new(a + off))
        rb.append(bm.verts.new(b + off))
    faces = [bm.faces.new((ra[i], ra[(i + 1) % seg], rb[(i + 1) % seg], rb[i])) for i in range(seg)]
    for f in faces:
        f.smooth = smooth
    if cap:
        faces += [bm.faces.new(list(reversed(ra))), bm.faces.new(rb)]
    for f in faces:
        f.material_index = mat


def box_local(bm, c, s, mat=0, bottom=True, top_scale=1.0):
    """Parallelepipedo in coordinate locali; top_scale < 1 lo rastrema verso l'alto."""
    vs = []
    for dz in (-1, 1):
        k = top_scale if dz > 0 else 1.0
        for dx, dy in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
            vs.append(bm.verts.new((c[0] + dx * s[0] / 2 * k, c[1] + dy * s[1] / 2 * k, c[2] + dz * s[2] / 2)))
    quads = [(4, 5, 6, 7)] + [(i, (i + 1) % 4, 4 + (i + 1) % 4, 4 + i) for i in range(4)]
    if bottom:
        quads.append((3, 2, 1, 0))
    for q in quads:
        f = bm.faces.new([vs[i] for i in q])
        f.material_index = mat


def shared_mesh(name, bm, mats, recalc=False):
    """Mesh da riusare su più oggetti (diventa un'istanza GPU nel GLB ottimizzato)."""
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    if recalc:
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    triangulate_ngons(bm)
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    for m in mats:
        mesh.materials.append(m)
    return mesh


def place(mesh, name, col, x, y, z, rot=0.0):
    obj = bpy.data.objects.new(name, mesh)
    col.objects.link(obj)
    obj.location = to_world(x, y, z)
    obj.rotation_euler = (0.0, 0.0, rot)
    return obj


def side_name(side):
    return "S" if side > 0 else "D"     # +Y in Blender è la sinistra (diventa -Z nel web)


# ---------------------------------------------------------------------------
# Verricelli
# ---------------------------------------------------------------------------
# Raggio del tamburo, altezza, segmenti, profilo completo (con flangia e gola del self-tailing)
WINCHES = {
    "Winch_Primary": (0.130, 0.30, 24, True),
    "Winch_Secondary": (0.115, 0.27, 20, True),
    "Winch_Main": (0.100, 0.24, 20, True),
    "Winch_Small": (0.092, 0.22, 16, False),
}
C, B = 0, 1     # indici dei materiali dei verricelli: cromo e nero


def winch_profile(R, H, full):
    if full:
        return [
            (1.22 * R, -0.01, B, False),       # base nera, appena dentro la coperta
            (1.18 * R, 0.28 * H, C, True),     # spalla della base
            (1.08 * R, 0.30 * H, C, True),     # piede cromato del tamburo
            (0.99 * R, 0.38 * H, C, False),    # svasatura
            (0.94 * R, 0.45 * H, C, True),     # inizio delle righe
            (0.94 * R, 0.70 * H, C, True),     # fine delle righe
            (1.05 * R, 0.75 * H, B, True),     # flangia sotto il self-tailing
            (1.03 * R, 0.80 * H, B, False),
            (0.86 * R, 0.86 * H, B, False),    # gola delle ganasce
            (0.98 * R, 0.92 * H, C, True),
            (0.60 * R, 1.00 * H, C, True),     # cappello cromato
            (0.20 * R, 1.00 * H, B, True),     # al centro la presa nera della maniglia
        ], 4
    return [
        (1.20 * R, -0.01, B, False),
        (1.16 * R, 0.32 * H, C, True),
        (0.95 * R, 0.42 * H, C, True),
        (0.95 * R, 0.72 * H, C, True),
        (1.03 * R, 0.78 * H, B, True),
        (0.88 * R, 0.87 * H, B, False),
        (0.96 * R, 0.93 * H, C, True),
        (0.56 * R, 1.00 * H, C, True),
        (0.20 * R, 1.00 * H, B, True),
    ], 2


def winch_drum_normal():
    """Normal map delle righe del tamburo (64x64, salvata in models/textures).
    Metà alta: un periodo di righe lungo U (una gola stretta fra due creste tonde); metà bassa
    piatta, per tutte le altre facce del verricello, che così usano lo stesso materiale."""
    name = "winch_drum_normal"
    n = 64
    old = bpy.data.images.get(name)
    if old is not None:
        bpy.data.images.remove(old)
    img = bpy.data.images.new(name, n, n, alpha=False)
    img.colorspace_settings.name = "Non-Color"      # prima dei pixel: cambiarlo dopo li azzera
    px = []
    for row in range(n):
        for col in range(n):
            nx = 0.0
            if row >= n // 2:
                u = (col + 0.5) / n - 0.5
                # pendenza di una gola gaussiana larga 0,14 del periodo
                nx = (2 * u / 0.14) * math.exp(-(u / 0.14) ** 2)
            ln = math.sqrt(nx * nx + 1)
            px += [(-nx / ln) * 0.5 + 0.5, 0.5, (1 / ln) * 0.5 + 0.5, 1.0]
    img.pixels.foreach_set(px)
    img.filepath_raw = os.path.join(REPO, "models/textures", name + ".png")
    img.file_format = "PNG"
    img.save()
    nt = MAT_WINCH.node_tree
    bsdf = next(nd for nd in nt.nodes if nd.type == "BSDF_PRINCIPLED")
    tex = next((nd for nd in nt.nodes if nd.type == "TEX_IMAGE"), None) or nt.nodes.new("ShaderNodeTexImage")
    nmap = next((nd for nd in nt.nodes if nd.type == "NORMAL_MAP"), None) or nt.nodes.new("ShaderNodeNormalMap")
    tex.image = img
    nt.links.new(tex.outputs["Color"], nmap.inputs["Color"])
    nt.links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])


def winch_mesh(name, R, H, seg, full):
    bm = bmesh.new()
    prof, band = winch_profile(R, H, full)
    # righe del tamburo: circa una ogni 2,3 cm di circonferenza
    lathe(bm, prof, seg, rib_band=band, ribs=round(2 * math.pi * R / 0.023))
    # stripper: il braccio cromato che stacca la scotta dalle ganasce, verso l'esterno (+X)
    tube_local(bm, (0.40 * R, 0, 0.99 * H), (1.20 * R, 0, 0.83 * H), 0.016, seg=4, mat=C, smooth=False)
    uv = bm.loops.layers.uv["UVMap"]
    for f in bm.faces:
        if not f.tag:
            for loop in f.loops:
                loop[uv].uv = (0.5, 0.25)      # zona piatta della normal map
    return shared_mesh(name, bm, [MAT_WINCH, MAT_BLACK])


def build_winches(col):
    winch_drum_normal()
    meshes = {n: winch_mesh(n, *v) for n, v in WINCHES.items()}
    w = cockpit_half_width()
    for side in (-1, 1):
        s = side_name(side)
        # in pozzetto il braccio guarda a poppa e verso l'interno, sulla tuga verso poppa
        aft_in = math.atan2(-side * 0.7, -1.0)
        for kind, x, off in (("Winch_Primary", 5.3, 0.38), ("Winch_Secondary", 6.6, 0.42),
                             ("Winch_Main", 3.7, 0.32)):
            y = side * (w + off)
            place(meshes[kind], f"{kind}_{s}", col, x, y, deck_z(x, y), aft_in)
        # drizze al piede d'albero
        x, y = MAST_X - 0.9, side * 0.55
        place(meshes["Winch_Small"], f"Winch_Small_{s}0", col, x, y, roof_z(x, y), math.pi)
        # tre coppie sulla tuga (pianta di coperta)
        for k, xw in enumerate((8.75, 9.45, 10.15)):
            yw = side * coachroof_side_y(xw, coachroof_side_height(xw)) * 0.72
            place(meshes["Winch_Small"], f"Winch_Small_{s}{k + 1}", col, xw, yw, roof_z(xw, yw), math.pi)


# ---------------------------------------------------------------------------
# Bitte, bozzelli, stopper, passacavi, carrelli
# ---------------------------------------------------------------------------
def cleat_mesh():
    bm = bmesh.new()
    L = 0.26
    # corna a sezione esagonale che si stringono verso le punte
    rings = []
    for x, k in ((-L / 2, 0.5), (-L * 0.22, 1.0), (L * 0.22, 1.0), (L / 2, 0.5)):
        rings.append([bm.verts.new((x, 0.019 * k * math.cos(2 * math.pi * i / 6),
                                    0.056 + 0.013 * k * math.sin(2 * math.pi * i / 6))) for i in range(6)])
    for r0, r1 in zip(rings, rings[1:]):
        for i in range(6):
            j = (i + 1) % 6
            bm.faces.new((r0[i], r0[j], r1[j], r1[i])).smooth = True
    bm.faces.new(list(reversed(rings[0])))
    bm.faces.new(rings[-1])
    for x in (-L * 0.2, L * 0.2):     # piedi rastremati
        box_local(bm, (x, 0, 0.026), (0.05, 0.032, 0.056), bottom=False, top_scale=0.7)
    return shared_mesh("Cleat", bm, [MAT_STEEL], recalc=True)


def block_mesh(name, mats, stand=True):
    """Bozzello con le guance nere: puleggia con l'asse lungo Y, la cima corre lungo X."""
    bm = bmesh.new()
    R, W, zc = 0.055, 0.04, 0.095 if stand else 0.075
    tube_local(bm, (0, -W / 2, zc), (0, W / 2, zc), R, seg=14, mat=0)
    if stand:
        tube_local(bm, (0, 0, 0.0), (0, 0, zc - R + 0.005), 0.011, seg=6, mat=1)   # molla del piede
        box_local(bm, (0, 0, 0.006), (0.075, 0.055, 0.012), mat=1, bottom=False)
    else:
        box_local(bm, (0, 0, 0.013), (0.2, 0.05, 0.026), mat=1, bottom=False)       # slitta sulla rotaia
        box_local(bm, (0, 0, 0.026 + 0.012), (0.03, 0.03, 0.024), mat=1, bottom=False)
    return shared_mesh(name, bm, mats, recalc=True)


def stopper_mesh():
    """Batteria di quattro stopper su una base: le cime entrano da prua (+X) verso i verricelli."""
    bm = bmesh.new()
    box_local(bm, (0, 0, 0.008), (0.21, 0.31, 0.016), mat=0, bottom=False)
    for k in range(4):
        y = -0.105 + k * 0.07
        box_local(bm, (0, y, 0.046), (0.17, 0.052, 0.06), mat=0, bottom=False, top_scale=0.85)
        tube_local(bm, (-0.065, y, 0.08), (0.06, y, 0.092), 0.008, seg=4, mat=1, smooth=False)  # leva
    return shared_mesh("Stopper_Bank", bm, [MAT_BLACK, MAT_STEEL], recalc=True)


def fairlead_mesh():
    """Passacavo chiuso sulla falchetta: due montanti e un ponte tondo."""
    bm = bmesh.new()
    box_local(bm, (0, 0, 0.006), (0.17, 0.06, 0.012), bottom=False)
    for x in (-0.058, 0.058):
        box_local(bm, (x, 0, 0.032), (0.034, 0.05, 0.05), bottom=False, top_scale=0.85)
    tube_local(bm, (-0.08, 0, 0.062), (0.08, 0, 0.062), 0.013, seg=6)
    return shared_mesh("Fairlead", bm, [MAT_HATCH], recalc=True)


def build_deck_fittings(col):
    cleat = cleat_mesh()
    for side in (-1, 1):
        s = side_name(side)
        for k, (x, inset) in enumerate(((18.55, 0.17), (11.0, 0.16), (1.7, 0.2))):   # prua, traverso, poppa
            yd = station_params(x)[2]
            y = side * (yd - inset)
            # la bitta segue la falchetta
            dy = station_params(x + 0.2)[2] - station_params(x - 0.2)[2]
            place(cleat, f"Cleat_{s}{k}", col, x, y, deck_z(x, y), side * math.atan2(dy, 0.4))

    fair = fairlead_mesh()
    for side in (-1, 1):
        s = side_name(side)
        for k, x in enumerate((19.0, 1.25)):
            yd = station_params(x)[2]
            y = side * (yd - 0.09)
            dy = station_params(x + 0.2)[2] - station_params(x - 0.2)[2]
            place(fair, f"Fairlead_{s}{k}", col, x, y, deck_z(x, y), side * math.atan2(dy, 0.4))

    # Stopper sulla tuga, davanti alla fila di verricelli; bozzelli di rinvio al piede d'albero
    stop = stopper_mesh()
    block = block_mesh("Block_MastFoot", [MAT_BLACK, MAT_STEEL])
    xs = 10.6
    for side in (-1, 1):
        ys = side * coachroof_side_y(xs, coachroof_side_height(xs)) * 0.72
        place(stop, f"Stopper_{side_name(side)}", col, xs, ys, roof_z(xs, ys))
        for k, a in enumerate((14, 38, 62)):
            ang = math.radians(180 - side * a)
            x = MAST_X + 0.30 * math.cos(ang)
            y = 0.30 * math.sin(ang)
            rot = math.atan2(ys - y, xs - x)
            place(block, f"Block_{side_name(side)}{k}", col, x, y, roof_z(x, y), rot)

    # Carrelli del genoa sulle rotaie e carrello del trasto della randa (stessa mesh)
    car = block_mesh("GenoaCar", [MAT_BLACK, MAT_HATCH], stand=False)
    for side in (-1, 1):
        x = 6.9
        y = side * station_params(x)[2] * 0.78
        place(car, f"GenoaCar_{side_name(side)}", col, x, y, deck_z(x, y) + 0.016)
    xt = COCKPIT_FWD + 0.1
    place(car, "GenoaCar_Trasto", col, xt, 0.25, roof_z(xt, 0.25) + 0.022, math.pi / 2)


# ---------------------------------------------------------------------------
# Rotaie e trasto
# ---------------------------------------------------------------------------
def deck_strip(bm, pts, w, h, mat=0):
    """Profilo rettangolare (senza fondo) che segue la coperta: pts in coordinate barca, z alla base."""
    secs = []
    n = len(pts)
    for i, p in enumerate(pts):
        a = Vector(pts[max(i - 1, 0)])
        b = Vector(pts[min(i + 1, n - 1)])
        t = Vector((b.x - a.x, b.y - a.y, 0)).normalized()
        nx, ny = -t.y * w / 2, t.x * w / 2
        x, y, z = p
        secs.append([bm.verts.new(to_world(*q)) for q in (
            (x - nx, y - ny, z - 0.006), (x - nx, y - ny, z + h), (x + nx, y + ny, z + h), (x + nx, y + ny, z - 0.006))])
    for s0, s1 in zip(secs, secs[1:]):
        for k in range(3):
            f = bm.faces.new((s0[k], s1[k], s1[k + 1], s0[k + 1]))
            f.material_index = mat
    for s, rev in ((secs[0], False), (secs[-1], True)):
        f = bm.faces.new(list(reversed(s)) if rev else s)
        f.material_index = mat


def build_deck_hardware(col):
    bm = bmesh.new()
    # Rotaie del genoa sul passavanti, a T d'alluminio con i fermi neri alle estremità
    for side in (-1, 1):
        pts = []
        for i in range(6):
            x = 5.0 + 3.6 * i / 5
            y = side * station_params(x)[2] * 0.78
            pts.append((x, y, deck_z(x, y)))
        deck_strip(bm, pts, 0.032, 0.016, mat=0)
        for p in (pts[0], pts[-1]):
            add_box_mat(bm, (p[0], p[1], p[2] + 0.014), (0.05, 0.045, 0.03), 1)
    # Trasto della randa sulla tuga, a proravia del pozzetto
    xt = COCKPIT_FWD + 0.1
    wt = coachroof_side_y(xt, coachroof_side_height(xt)) * 0.9
    pts = [(xt, -wt + 2 * wt * i / 6, 0.0) for i in range(7)]
    pts = [(x, y, roof_z(x, y)) for x, y, _ in pts]
    deck_strip(bm, pts, 0.055, 0.022, mat=0)
    for p in (pts[0], pts[-1]):
        add_box_mat(bm, (p[0], p[1], p[2] + 0.02), (0.07, 0.05, 0.04), 1)
    return finish(bm, "DeckHardware", [MAT_HATCH, MAT_BLACK], col)


def add_box_mat(bm, center, size, mat):
    n = len(bm.faces)
    add_box(bm, center, size)
    bm.faces.ensure_lookup_table()
    for f in bm.faces[n:]:
        f.material_index = mat


# ---------------------------------------------------------------------------
# Osteriggi e tambuccio
# ---------------------------------------------------------------------------
def hatch(bm, x, y, sx, sy, h=0.05, rim=0.035, ch=0.035, frame_mat=0, lid_mat=1):
    """Osteriggio: cornice d'alluminio con gli angoli smussati e coperchio in plexiglas fumé.
    La cornice è piana in cima e scende fino alla coperta, che sotto è bombata."""
    def outline(hx, hy, c):
        return [(hx - c, -hy), (hx, -hy + c), (hx, hy - c), (hx - c, hy),
                (-hx + c, hy), (-hx, hy - c), (-hx, -hy + c), (-hx + c, -hy)]
    out = outline(sx / 2, sy / 2, ch)
    inn = outline(sx / 2 - rim, sy / 2 - rim, ch * 0.6)
    ztop = max(roof_z(x + u, y + v) for u, v in out) + h
    rings = [
        [bm.verts.new(to_world(x + u, y + v, roof_z(x + u, y + v) - 0.012)) for u, v in out],
        [bm.verts.new(to_world(x + u, y + v, ztop)) for u, v in out],
        [bm.verts.new(to_world(x + u, y + v, ztop)) for u, v in inn],
        [bm.verts.new(to_world(x + u, y + v, ztop - 0.01)) for u, v in inn],
    ]
    for k in range(3):
        for i in range(8):
            j = (i + 1) % 8
            f = bm.faces.new((rings[k][i], rings[k][j], rings[k + 1][j], rings[k + 1][i]))
            f.material_index = frame_mat
    bm.faces.new(rings[3]).material_index = lid_mat


def build_hatches(col):
    bm = bmesh.new()
    # Osteriggi dalla pianta di coperta del cantiere: (x, y, lato)
    for x, y, size in ((17.2, 0.0, 0.55), (15.8, 0.0, 0.9), (13.0, 0.45, 0.4), (13.0, -0.45, 0.4),
                       (9.85, 0.0, 0.65)):
        hatch(bm, x, y, size, size)
    # Gavone dell'ancora a prua: coperchio a filo, in vetroresina
    hatch(bm, 18.4, 0.0, 0.9, 0.5, h=0.02, rim=0.03, lid_mat=2)
    # Tambuccio all'estremità poppiera della tuga: cappa rialzata con il plexiglas
    hatch(bm, COCKPIT_FWD + 0.45, 0.0, 0.9, 0.8, h=0.11, rim=0.07, ch=0.06, frame_mat=2)
    return finish(bm, "Hatches", [MAT_HATCH, MAT_GLASS, MAT_GELCOAT], col)


# ---------------------------------------------------------------------------
# Ruota, candelieri e pulpiti
# ---------------------------------------------------------------------------
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
    # bussola sulla colonnina: chiesuola nera e cupola scura
    lathe(bm, [(0.12, 0.0, 1, False), (0.125, 0.05, 1, True), (0.11, 0.06, 2, True),
               (0.095, 0.11, 2, False), (0.06, 0.15, 2, False), (0.02, 0.165, 2, True)],
          16, origin=(x + 0.35, 0, cz + 0.1))
    return finish(bm, "Wheel", [MAT_STEEL, MAT_BLACK, MAT_GLASS], col)


def smooth_path(pts, sub=2):
    """Catmull-Rom fra i punti dati (le curve dei pulpiti)."""
    P = [Vector(p) for p in pts]
    out = []
    for i in range(len(P) - 1):
        p0, p1, p2, p3 = P[max(i - 1, 0)], P[i], P[i + 1], P[min(i + 2, len(P) - 1)]
        for k in range(sub):
            t = k / sub
            out.append(0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t
                              + (3 * p1 - p0 - 3 * p2 + p3) * t ** 3))
    out.append(P[-1])
    return [tuple(v) for v in out]


def sweep(bm, pts, r, seg=8):
    """Tubo continuo lungo una polilinea in coordinate barca (corrimano dei pulpiti)."""
    up = Vector((0, 0, 1))
    rings = []
    n = len(pts)
    for i, p in enumerate(pts):
        t = (Vector(pts[min(i + 1, n - 1)]) - Vector(pts[max(i - 1, 0)])).normalized()
        nx = up.cross(t)
        nx = nx.normalized() if nx.length > 1e-4 else Vector((1, 0, 0))
        ny = t.cross(nx)
        c = Vector(p)
        rings.append([bm.verts.new(to_world(*(c + (nx * math.cos(a) + ny * math.sin(a)) * r)))
                      for a in (2 * math.pi * k / seg for k in range(seg))])
    for r0, r1 in zip(rings, rings[1:]):
        for k in range(seg):
            j = (k + 1) % seg
            bm.faces.new((r0[k], r0[j], r1[j], r1[k])).smooth = True
    bm.faces.new(list(reversed(rings[0])))
    bm.faces.new(rings[-1])


def build_lifelines(col):
    bm = bmesh.new()
    h = 0.68

    def edge(x, inset):
        _, _, yd, _, _, _ = station_params(x)
        return yd - inset

    def post(x, y, top):
        z0 = deck_z(x, y)
        add_tube(bm, (x, y, z0 - 0.01), (x, y, z0 + 0.018), 0.03, seg=8)    # piede del candeliere
        add_tube(bm, (x, y, z0), (x, y, z0 + top), 0.014, seg=8)
        return (x, y, z0)

    # Candelieri: otto per lato fra il pulpito di poppa e quello di prua
    x_aft, x_fwd = 2.2, LOA - 1.6
    xs = [3.0 + i * (LOA - 2.4 - 3.0) / 7 for i in range(8)]
    for side in (-1, 1):
        posts = [post(x, side * edge(x, 0.07), h) for x in xs]
        ends = [(x_aft, side * edge(x_aft, 0.08)), (x_fwd, side * edge(x_fwd, 0.07))]
        line = [(ends[0][0], ends[0][1], deck_z(*ends[0]))] + posts + [(ends[1][0], ends[1][1], deck_z(*ends[1]))]
        for a, b in zip(line, line[1:]):
            for hh in (h * 0.5, h):
                add_tube(bm, (a[0], a[1], a[2] + hh), (b[0], b[1], b[2] + hh), 0.004, seg=4, cap=False)

    def pulpit(side, front, legs, inset):
        # corrimano alto e intermedio: lato sinistro, punta, lato destro.
        # side: (x, frazione della mezza larghezza), per arrotondare gli angoli
        for frac in (1.0, 0.52):
            pts = [(x, k * edge(x, inset), deck_z(x, k * edge(x, inset)) + h * frac) for x, k in side]
            fx, fy = front
            mid = [(fx, fy, deck_z(fx, fy) + h * frac)]
            pts = pts + mid + [(x, -y, z) for x, y, z in reversed(pts)]
            sweep(bm, smooth_path(pts, 2), 0.016)
        for x, y in legs:
            add_tube(bm, (x, y, deck_z(x, y) - 0.01), (x, y, deck_z(x, y) + h), 0.016, seg=8, cap=False)

    # Pulpito di prua: chiuso attorno allo strallo
    bow = [(x_fwd, 1), (LOA - 1.0, 1), (LOA - 0.5, 1)]
    pulpit(bow, (LOA - 0.1, 0.0),
           [(x, s * edge(x, 0.07)) for x in (x_fwd, LOA - 0.5) for s in (-1, 1)] + [(LOA - 0.1, 0.0)], 0.07)
    # Pulpito di poppa: avvolge la piattaforma del timoniere fino allo specchio
    stern = [(x_aft, 1), (1.5, 1), (1.12, 0.96), (0.98, 0.72)]
    pulpit(stern, (TRANSOM_DECK_X + 0.05, 0.0),
           [(x, s * edge(x, 0.08)) for x in (x_aft, 1.05) for s in (-1, 1)], 0.08)
    return finish(bm, "Lifelines", [MAT_STEEL], col)


def deck_stats():
    """Triangoli disegnati dall'attrezzatura di coperta (le istanze contano una volta per oggetto)."""
    names = ("Winch", "Cleat", "Block_", "Stopper", "Fairlead", "GenoaCar", "Hatches", "DeckHardware",
             "Wheel", "Lifelines")
    drawn, unique, seen = 0, 0, set()
    for o in bpy.data.objects:
        if o.type == "MESH" and o.name.startswith(names):
            t = sum(len(p.vertices) - 2 for p in o.data.polygons)
            drawn += t
            if o.data.name not in seen:
                seen.add(o.data.name)
                unique += t
    print("DECK_STATS triangoli disegnati", drawn, "unici", unique, "mesh", len(seen))


def build_rig_all():
    col = get_collection("Swan651")
    build_mast(col)
    build_boom(col)
    build_rigging(col)
    build_sails(col)
    clear_deck_objects()
    build_winches(col)
    build_wheel(col)
    build_lifelines(col)
    build_deck_fittings(col)
    build_deck_hardware(col)
    build_hatches(col)
    deck_stats()
    return {"mast_x_from_stern": round(MAST_X, 2), "masthead_z": round(MASTHEAD_Z, 2),
            "boom_z": round(BOOM_Z, 2), "I_est": round(I_HEIGHT, 2),
            "air_draft": round(MASTHEAD_Z, 2)}


rig_result = build_rig_all()
print(rig_result)
