"""Swan 651: generatore parametrico di scafo, coperta, tuga e appendici.

Si esegue dentro Blender (via MCP) con:
    exec(open("<repo>/scripts/blender/swan651_hull.py").read())

Fonte geometrica: reference/swan651-002-profile-layout.jpeg (tavola Nautor, scafo 651-002).
Le coordinate della tavola sono in pixel dell'immagine originale (4960x3507) e vengono
convertite in metri con la lunghezza fuori tutto nota (19,98 m).

Sistema di riferimento Blender: X verso prua, Y verso sinistra, Z in alto,
origine a mezza lunghezza sul piano di galleggiamento.
"""
import json
import math
import os

import bmesh
import bpy

REPO = os.environ.get("SWAN_REPO", "/Users/bilalmessaoudi/Desktop/coding/nautor-swan")
DRAWING = os.path.join(REPO, "reference/swan651-002-profile-layout.jpeg")
OUTLINES = os.path.join(REPO, "reference/drawing_outlines_px.json")

# ---------------------------------------------------------------------------
# Scala della tavola
# ---------------------------------------------------------------------------
LOA = 19.98
PX_STERN, PX_BOW = 452, 4216          # estremi del profilo
PX_WL = 769                           # riga del galleggiamento
# La tavola è dello scafo 651-002 Adrienne II, versione con poppa allungata (~21 m).
# Scalata su 21,0 m tornano baglio 5,31, pescaggio 3,23 e slancio di prua 1,63 (IRC).
# Il 651 standard (Lunz am Meer, LH 19,97) si ottiene tagliando l'allungamento a poppa.
DRAWING_LOA = 21.0
STERN_CUT = DRAWING_LOA - LOA          # metri di poppa allungata da togliere
S = DRAWING_LOA / (PX_BOW - PX_STERN)  # metri per pixel nel profilo

PLAN_STERN, PLAN_BOW = 444, 4240      # estremi della pianta
SP = DRAWING_LOA / (PLAN_BOW - PLAN_STERN)    # metri per pixel nella pianta
PLAN_CL = 2292                        # asse longitudinale della pianta

BEAM_MAX = 5.31                       # baglio massimo (scheda modello)
DRAFT = 3.23                          # pescaggio misurato IRC (Lunz am Meer)
DECK_CAMBER = 0.10                    # bolzone della coperta
BOTTOM_PAINT_Z = 0.06                 # linea dell'antivegetativa
STRIPE_Z = (0.17, 0.24)               # filetto rosso sopra il galleggiamento
SHEER_STRIPE = (0.07, 0.11)           # filetto rosso sotto la coperta (distanza dalla coperta)
CR_SIDE_TILT = 0.30                   # rientro dei fianchi della tuga per metro di altezza
CR_RED_BAND = 0.45                    # quota della fascia rossa sul fianco della tuga (frazione)


def px_x(px):
    """Pixel orizzontale del profilo -> metri dallo specchio di poppa del 651 standard."""
    return (px - PX_STERN) * S - STERN_CUT


def px_z(py):
    """Pixel verticale del profilo -> metri sopra il galleggiamento."""
    return (PX_WL - py) * S


def interp(table, x):
    """Interpolazione lineare in una lista ordinata di (x, valore)."""
    if x <= table[0][0]:
        return table[0][1]
    if x >= table[-1][0]:
        return table[-1][1]
    for (x0, v0), (x1, v1) in zip(table, table[1:]):
        if x0 <= x <= x1:
            t = (x - x0) / (x1 - x0) if x1 > x0 else 0.0
            return v0 + (v1 - v0) * t
    return table[-1][1]


def smooth(table, x, window=0.35, n=7):
    """Media mobile su interp, per togliere il rumore del ricalco."""
    acc = 0.0
    for i in range(n):
        acc += interp(table, x + window * (i / (n - 1) - 0.5))
    return acc / n


def smoothstep(e0, e1, x):
    t = max(0.0, min(1.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


# ---------------------------------------------------------------------------
# Linee ricavate dalla tavola (pixel -> metri)
# ---------------------------------------------------------------------------
# Linea di coperta (insellatura) al fianco
SHEER = [(px_x(px), px_z(py)) for px, py in [
    (452, 528), (800, 528), (1000, 526), (1300, 523), (1700, 518), (2100, 512),
    (2500, 505), (2900, 498), (3300, 488), (3500, 483), (3700, 475), (3850, 468),
    (3950, 462), (4050, 461), (4216, 461)]]

# Cielo della tuga (linea superiore del profilo)
COACHROOF_TOP = [(px_x(px), px_z(py)) for px, py in [
    (834, 474), (1000, 470), (1700, 457), (2100, 452), (2500, 449), (2900, 449),
    (3300, 450), (3500, 452), (3700, 454), (3850, 456), (3950, 459)]]

# Specchio di poppa inclinato: dal cielo (452,528) al fondo (520,657)
# Specchio di poppa ROVESCIO del 651 standard (piano velico del cantiere, foto di Second Wind):
# lo spigolo basso (knuckle) è l'estremo poppiero della barca, il bordo della coperta sta più a prua.
TRANSOM_DECK_X = 0.89      # bordo poppiero della coperta, a proravia dello spigolo
Z_KNUCKLE = 0.60           # quota dello spigolo basso sopra il galleggiamento
RUDDER_SHIFT = 0.30        # timone e skeg verso prua rispetto alla tavola (piano velico)

# Fondo dello scafo nudo (senza chiglia, skeg e timone)
CANOE_AFT = [(px_x(px), px_z(py)) for px, py in [
    (520, 657), (680, 702), (845, 752), (955, 812), (1100, 862), (1400, 893),
    (1700, 918), (2150, 940), (2780, 942)]]


def load_outlines():
    with open(OUTLINES) as f:
        data = json.load(f)
    # Fondo e dritto di prua dal ricalco automatico (da 2800 px in avanti)
    fwd = [(px_x(x), px_z(bot)) for x, _top, bot in data["profile"] if x >= 2800]
    canoe = CANOE_AFT + fwd
    canoe.append((LOA, SHEER[-1][1]))
    # Mezza larghezza in coperta dalla pianta
    plan = []
    for x, ymin, ymax in data["plan"]:
        xm = (x - PLAN_STERN) * SP - STERN_CUT
        plan.append((xm, (ymax - ymin) / 2 * SP))
    plan.append((LOA, 0.0))
    return canoe, plan


CANOE, PLAN_HALF = load_outlines()


# Il fondo parte dallo spigolo dello specchio e si raccorda alla carena della tavola
CANOE = [(0.0, Z_KNUCKLE)] + [p for p in CANOE if p[0] > 0.3]
TRANSOM_TOP = (TRANSOM_DECK_X, interp(SHEER, TRANSOM_DECK_X))
TRANSOM_BOTTOM = (0.0, Z_KNUCKLE)


def transom_z(x):
    """Quota del piano dello specchio alla stazione x (sopra non c'è scafo)."""
    if x >= TRANSOM_DECK_X:
        return float("inf")
    tx, tz = TRANSOM_TOP
    return Z_KNUCKLE + (tz - Z_KNUCKLE) * x / tx
DECK_BEAM_MAX = 2 * max(v for _, v in PLAN_HALF)


# ---------------------------------------------------------------------------
# Forma delle sezioni
# ---------------------------------------------------------------------------
def station_params(x):
    zs = interp(SHEER, x)
    zk = smooth(CANOE, x, window=0.25)
    yd = max(smooth(PLAN_HALF, x, window=0.3), 0.0)
    u = x / LOA
    # Rientranza dei fianchi (tumblehome): massima a poppa, nulla a prua
    tumble = max(BEAM_MAX / DECK_BEAM_MAX - 1.0, 0.012) * (1.0 - smoothstep(0.55, 0.85, u)) \
        + 0.04 * (1.0 - smoothstep(0.0, 0.35, u))
    yb = yd * (1.0 + tumble)
    # Quota del baglio massimo: sotto la coperta a poppa e a centro barca, in coperta a prua
    drop = 0.2 + 0.25 * (1.0 - smoothstep(0.6, 0.9, u))
    zb = zs - drop
    # Esponente della superellisse: V a prua, piena a centro, piatta a poppa
    n = N_BOW + (N_MID - N_BOW) * smoothstep(0.95, 0.5, u) + (N_AFT - N_MID) * smoothstep(0.45, 0.05, u)
    return zs, zk, yd, yb, zb, n


# Esponenti della superellisse delle sezioni (tarati sul dislocamento IRC)
N_BOW, N_MID, N_AFT = 1.45, 2.1, 2.5

N_TOP = 6       # punti nella zona di rientranza (sopra il baglio massimo)
N_LOW = 26      # punti nella superellisse (dal baglio massimo alla chiglia)


def half_section(x):
    """Punti (y, z) dalla coperta al fondo, lato dritta (y negativa)."""
    zs, zk, yd, yb, zb, n = station_params(x)
    pts = []
    zl = [zs, zs - SHEER_STRIPE[0], zs - SHEER_STRIPE[1]]
    zl += [zl[-1] + (zb - zl[-1]) * (i + 1) / (N_TOP - 2) for i in range(N_TOP - 3)]
    for z in zl:
        t = (zs - z) / (zs - zb) if zs > zb else 1.0
        y = yd + (yb - yd) * (1 - (1 - t) ** 1.6)
        pts.append((y, z))
    for i in range(N_LOW + 1):
        t = (math.pi / 2) * i / N_LOW
        c, s_ = math.cos(t), math.sin(t)
        y = yb * (c ** (2 / n) if c > 0 else 0.0)
        z = zb - (zb - zk) * (s_ ** (2 / n))
        pts.append((y, z))
    pts[-1] = (0.0, zk)
    ztp = transom_z(x)
    if ztp < zs:
        pts = clip_section(pts, ztp)
    return pts


def clip_section(pts, ztop):
    """Taglia la sezione alla quota ztop e la ricampiona con lo stesso numero di punti."""
    n = len(pts)
    poly = []
    for (y0, z0), (y1, z1) in zip(pts, pts[1:]):
        if z0 >= ztop >= z1 and z0 != z1:
            t = (ztop - z1) / (z0 - z1)
            poly = [(y1 + (y0 - y1) * t, ztop)]
            break
    start = len(poly) == 1
    if not start:
        return [pts[-1]] * n
    idx = next(i for i, (_, z) in enumerate(pts) if z < ztop)
    poly += pts[idx:]
    seg = [math.dist(a, b) for a, b in zip(poly, poly[1:])]
    total = sum(seg) or 1e-9
    out = []
    for k in range(n):
        d = total * k / (n - 1)
        acc = 0.0
        for (a, b), L in zip(zip(poly, poly[1:]), seg):
            if acc + L >= d or L == seg[-1] and b == poly[-1]:
                t = (d - acc) / L if L > 0 else 0.0
                out.append((a[0] + (b[0] - a[0]) * min(t, 1.0), a[1] + (b[1] - a[1]) * min(t, 1.0)))
                break
            acc += L
    out[-1] = poly[-1]
    return out


def stations():
    """Stazioni piu fitte alle estremita."""
    xs = [0.004 + (TRANSOM_DECK_X - 0.004) * (i / 14) ** 1.5 for i in range(14)]
    x0 = TRANSOM_DECK_X
    n = 120
    for i in range(n + 1):
        t = i / n
        t = 0.5 - 0.5 * math.cos(math.pi * t)  # addensa a poppa e a prua
        xs.append(x0 + (LOA - 0.02 - x0) * t)
    return xs


def deck_stations(xs):
    return [x for x in xs if x >= TRANSOM_DECK_X - 1e-6]


# ---------------------------------------------------------------------------
# Utilità mesh
# ---------------------------------------------------------------------------
def get_collection(name):
    col = bpy.data.collections.get(name)
    if col is None:
        col = bpy.data.collections.new(name)
        bpy.context.scene.collection.children.link(col)
    return col


def triangulate_ngons(bm):
    """Le facce con più di 4 lati (tutte piane: specchio, tappi, paratie) diventano triangoli
    ben proporzionati, invece di lasciare la triangolazione all'esportatore glTF."""
    faces = [f for f in bm.faces if len(f.verts) > 4]
    if not faces:
        return
    try:
        bmesh.ops.triangulate(bm, faces=faces, quad_method="BEAUTY", ngon_method="BEAUTY")
    except (TypeError, ValueError):
        bmesh.ops.triangulate(bm, faces=faces)


def replace_object(name, mesh, col):
    old = bpy.data.objects.get(name)
    if old is not None:
        old_mesh = old.data
        bpy.data.objects.remove(old, do_unlink=True)
        if old_mesh is not None and old_mesh.users == 0:
            bpy.data.meshes.remove(old_mesh)
    mesh.name = name
    obj = bpy.data.objects.new(name, mesh)
    col.objects.link(obj)
    return obj


def to_world(x, y, z):
    return (x - LOA / 2, y, z)


def material(name, color, roughness=0.4, metallic=0.0, clearcoat=0.0):
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    if "Coat Weight" in bsdf.inputs:
        bsdf.inputs["Coat Weight"].default_value = clearcoat
    mat.diffuse_color = (*color, 1.0)
    return mat


MAT_GELCOAT_RGB = (0.92, 0.92, 0.9)
ANTIFOUL_RGB = (0.45, 0.03, 0.03)
STRIPE_RGB = (0.6, 0.04, 0.04)
MAT_GELCOAT = material("Gelcoat_White", MAT_GELCOAT_RGB, 0.18, clearcoat=0.6)
MAT_ANTIFOUL = material("Antifouling_Red", (0.45, 0.03, 0.03), 0.65)
MAT_STRIPE = material("Stripe_Red", (0.6, 0.04, 0.04), 0.25)
def textured_material(name, tex_file, roughness):
    """Materiale con texture tileabile (mappata in metri: 1 ripetizione per metro)."""
    mat = material(name, (1, 1, 1), roughness)
    nt = mat.node_tree
    bsdf = next(nd for nd in nt.nodes if nd.type == "BSDF_PRINCIPLED")
    tex = next((nd for nd in nt.nodes if nd.type == "TEX_IMAGE"), None) or nt.nodes.new("ShaderNodeTexImage")
    tex.image = bpy.data.images.load(os.path.join(REPO, "models/textures", tex_file), check_existing=True)
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    return mat


def planar_uv(bm, along_x=True):
    """UV in metri: u lungo la barca, v trasversale (le doghe corrono da prua a poppa)."""
    uv = bm.loops.layers.uv.get("UVMap") or bm.loops.layers.uv.new("UVMap")
    for f in bm.faces:
        for loop in f.loops:
            co = loop.vert.co
            loop[uv].uv = (co.x, co.y) if along_x else (co.y, co.x)


MAT_TEAK = textured_material("Teak_Deck", "teak_deck.png", 0.75)
MAT_LEAD = material("Keel_Antifoul", (0.45, 0.03, 0.03), 0.65)
MAT_GLASS = material("Portlight_Glass", (0.02, 0.03, 0.04), 0.05)
MAT_ALU = material("Toerail_Aluminium", (0.7, 0.71, 0.72), 0.35, metallic=0.9)


# ---------------------------------------------------------------------------
# Scafo
# ---------------------------------------------------------------------------
# ---------------------------------------------------------------------------
# Texture della vernice dello scafo (generata qui, così le quote restano una sola fonte)
# ---------------------------------------------------------------------------
HULL_TEX = 2048
U_RANGE = (-3.6, 0.2)      # distanza dalla coperta (m)
V_RANGE = (-1.2, 1.9)      # quota sul galleggiamento (m)


def hull_u(d):
    return (d - U_RANGE[0]) / (U_RANGE[1] - U_RANGE[0])


def hull_v(z):
    return (z - V_RANGE[0]) / (V_RANGE[1] - V_RANGE[0])


def hull_paint_material():
    import numpy as np
    n = HULL_TEX
    u = np.linspace(U_RANGE[0], U_RANGE[1], n)[None, :]     # colonne: distanza dalla coperta
    v = np.linspace(V_RANGE[0], V_RANGE[1], n)[:, None]     # righe: quota
    bottom = np.broadcast_to(v < BOTTOM_PAINT_Z, (n, n))
    boot = np.broadcast_to((v > STRIPE_Z[0]) & (v < STRIPE_Z[1]), (n, n))
    sheer = np.broadcast_to((u > -SHEER_STRIPE[1]) & (u < -SHEER_STRIPE[0]), (n, n)) & (v > 0.4)
    white = np.array(MAT_GELCOAT_RGB)
    red_bottom = np.array(ANTIFOUL_RGB)
    red_stripe = np.array(STRIPE_RGB)
    col = np.ones((n, n, 4), dtype=np.float32)
    col[..., :3] = white
    col[boot | sheer, :3] = red_stripe
    col[bottom, :3] = red_bottom
    rough = np.ones((n, n, 4), dtype=np.float32)
    rough[..., 0] = 1.0
    rough[..., 1] = np.where(bottom, 0.65, 0.16)          # G = ruvidità (glTF)
    rough[..., 2] = 0.0                                    # B = metallicità

    def image(name, data, colorspace):
        img = bpy.data.images.get(name)
        if img is None or tuple(img.size) != (n, n):
            if img is not None:
                bpy.data.images.remove(img)
            img = bpy.data.images.new(name, n, n, alpha=True)
        elif img.source != "GENERATED":
            bpy.data.images.remove(img)
            img = bpy.data.images.new(name, n, n, alpha=True)
        img.colorspace_settings.name = colorspace      # prima dei pixel: cambiarlo dopo li azzera
        img.pixels.foreach_set(data.ravel())
        path = os.path.join(REPO, "models/textures", name + ".png")
        img.filepath_raw = path
        img.file_format = "PNG"
        img.save()
        return img

    base = image("hull_paint_basecolor", col, "sRGB")
    orm = image("hull_paint_roughness", rough, "Non-Color")
    mat = bpy.data.materials.get("Hull_Paint") or bpy.data.materials.new("Hull_Paint")
    mat.use_nodes = True
    nt = mat.node_tree
    for nd in list(nt.nodes):
        if nd.type not in ("BSDF_PRINCIPLED", "OUTPUT_MATERIAL"):
            nt.nodes.remove(nd)
    bsdf = next(nd for nd in nt.nodes if nd.type == "BSDF_PRINCIPLED")
    tb = nt.nodes.new("ShaderNodeTexImage")
    tb.image = base
    tr = nt.nodes.new("ShaderNodeTexImage")
    tr.image = orm
    sep = nt.nodes.new("ShaderNodeSeparateColor")
    nt.links.new(tb.outputs["Color"], bsdf.inputs["Base Color"])
    nt.links.new(tr.outputs["Color"], sep.inputs["Color"])
    nt.links.new(sep.outputs[1], bsdf.inputs["Roughness"])
    nt.links.new(sep.outputs[2], bsdf.inputs["Metallic"])
    if "Coat Weight" in bsdf.inputs:
        bsdf.inputs["Coat Weight"].default_value = 0.5
    return mat


def sheer_stripe_hit(face):
    c = face.calc_center_median()
    zs = interp(SHEER, c.x + LOA / 2)
    return zs - SHEER_STRIPE[1] - 1e-3 < c.z < zs - SHEER_STRIPE[0] + 1e-3 and c.x + LOA / 2 > 0.3


def build_hull(col):
    xs = stations()
    bm = bmesh.new()
    rings = []
    for x in xs:
        half = half_section(x)
        ring_pts = [(-y, z) for y, z in half] + [(y, z) for y, z in reversed(half[:-1])]
        rings.append([bm.verts.new(to_world(x, y, z)) for y, z in ring_pts])
    for a, b in zip(rings, rings[1:]):
        for i in range(len(a) - 1):
            bm.faces.new((a[i], a[i + 1], b[i + 1], b[i]))
    # Specchio di poppa rovescio: poligono piano dai bordi superiori degli anelli tagliati
    aft = [r for r, x in zip(rings, xs) if x <= TRANSOM_DECK_X + 1e-6]
    outline = [r[0] for r in aft] + [r[-1] for r in reversed(aft)]
    outline.append(rings[0][len(rings[0]) // 2])     # spigolo basso al centro
    tf = bm.faces.new(outline)
    tf.smooth = False
    # chiude la punta dello spigolo (primo anello quasi degenere)
    bm.faces.new(list(reversed(rings[0])))
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)

    # Topologia pulita: solo quadrilateri sulla superficie curva. Le fasce di colore stanno
    # in una texture (UV: u = distanza dalla linea di coperta, v = quota), non nella mesh.
    uv = bm.loops.layers.uv.new("UVMap")
    for f in bm.faces:
        flat = len(f.verts) != 4            # specchio e punta: zona bianca della texture
        f.smooth = not flat
        for loop in f.loops:
            co = loop.vert.co
            x = co.x + LOA / 2
            if flat:
                loop[uv].uv = (0.97, 0.9)
            else:
                d = co.z - interp(SHEER, max(x, TRANSOM_DECK_X))
                loop[uv].uv = (hull_u(d), hull_v(co.z))
    triangulate_ngons(bm)
    mesh = bpy.data.meshes.new("Hull")
    bm.to_mesh(mesh)
    bm.free()
    obj = replace_object("Hull", mesh, col)
    obj.data.materials.append(hull_paint_material())
    return obj, xs


def deck_z(x, y):
    zs, _, yd, _, _, _ = station_params(x)
    if yd <= 1e-6:
        return zs
    r = min(1.0, abs(y) / yd)
    return zs + DECK_CAMBER * (1 - r * r)


def deck_lateral(yd, w, k_out=8, k_in=8):
    """Ascisse trasversali di una riga di coperta: passano esattamente per i bordi del pozzetto."""
    w = min(w, yd * 0.7)
    ys = [-yd + (yd - w) * i / k_out for i in range(k_out)]
    ys += [-w + 2 * w * i / k_in for i in range(k_in)]
    ys += [w + (yd - w) * i / k_out for i in range(k_out + 1)]
    return ys


def build_deck(col, xs):
    """Coperta a soli quadrilateri: la griglia passa per i bordi del pozzetto e della tuga,
    e dentro quei contorni non c'è coperta (sotto la tuga si vede il cielino, non il teak)."""
    bm = bmesh.new()
    rows = []
    wc = cockpit_half_width()
    k_out, k_in = 8, 8
    dxs = sorted(set(deck_stations(xs) + [COCKPIT_AFT, COCKPIT_FWD, CR_FWD]))
    for x in dxs:
        _, _, yd, _, _, _ = station_params(x)
        if COCKPIT_AFT <= x <= COCKPIT_FWD:
            w = wc
        elif COCKPIT_FWD < x < CR_FWD:
            w = coachroof_half_width(x)
        else:
            w = yd * 0.5
        row = [bm.verts.new(to_world(x, y, deck_z(x, y))) for y in deck_lateral(yd, w, k_out, k_in)]
        rows.append((x, row))
    for (xa, a), (xb, b) in zip(rows, rows[1:]):
        open_zone = COCKPIT_AFT <= xa and xb <= CR_FWD
        for j in range(len(a) - 1):
            if open_zone and k_out <= j < k_out + k_in:
                continue                                   # pozzetto o tuga: niente coperta
            f = bm.faces.new((a[j], b[j], b[j + 1], a[j + 1]))
            f.smooth = True
    mesh = bpy.data.meshes.new("Deck")
    bm.to_mesh(mesh)
    bm.free()
    obj = replace_object("Deck", mesh, col)
    obj.data.materials.append(MAT_TEAK)
    return obj


# ---------------------------------------------------------------------------
# Tuga (cuneo lungo e basso che a poppa diventa le mastre del pozzetto)
# ---------------------------------------------------------------------------
CR_AFT = px_x(800)       # spigolo inclinato di poppa (800 -> 834 px)
CR_AFT_TOP = px_x(834)
CR_FWD = px_x(3950)      # si raccorda alla coperta
CR_WIDTH = 0.52          # frazione della mezza larghezza di coperta (pianta di coperta del cantiere)
CR_ROOF_CAMBER = 0.06


def coachroof_half_width(x):
    _, _, yd, _, _, _ = station_params(x)
    taper = 1.0 - smoothstep(px_x(3000), CR_FWD, x)
    return yd * CR_WIDTH * (0.25 + 0.75 * taper) if x < CR_FWD else 0.0


def coachroof_side_height(x):
    if x <= CR_AFT_TOP:
        t = (x - CR_AFT) / (CR_AFT_TOP - CR_AFT)
        top = interp(COACHROOF_TOP, CR_AFT_TOP)
        return interp(SHEER, x) + (top - interp(SHEER, x)) * max(0.0, t)
    return interp(COACHROOF_TOP, x)


def coachroof_side_y(x, z):
    """Mezza larghezza del fianco inclinato della tuga alla quota z."""
    w = coachroof_half_width(x)
    zb = deck_z(x, w)
    return max(w - CR_SIDE_TILT * max(z - zb, 0.0), 0.0)


def build_coachroof(col):
    bm = bmesh.new()
    n = 90
    xa = COCKPIT_FWD
    xs = [xa + (CR_FWD - xa) * i / n for i in range(n + 1)]
    nlat = 12
    sections = []
    side_faces = []
    for x in xs:
        w = coachroof_half_width(x)
        zbase = deck_z(x, w)
        ztop = max(coachroof_side_height(x), zbase)
        zband = zbase + (ztop - zbase) * CR_RED_BAND
        wt = coachroof_side_y(x, ztop)
        pts = [(-w, zbase - 0.02), (-coachroof_side_y(x, zband), zband)]
        for j in range(nlat + 1):
            y = -wt + 2 * wt * j / nlat
            r = abs(y) / wt if wt > 1e-6 else 0
            pts.append((y, max(ztop, deck_z(x, y)) + CR_ROOF_CAMBER * (1 - r * r)))
        pts += [(coachroof_side_y(x, zband), zband), (w, zbase - 0.02)]
        sections.append([bm.verts.new(to_world(x, y, z)) for y, z in pts])
    for a, b in zip(sections, sections[1:]):
        m = len(a) - 1
        for i in range(m):
            f = bm.faces.new((a[i], b[i], b[i + 1], a[i + 1]))
            f.smooth = False
            if i == 0 or i == m - 1:
                f.material_index = 1          # fascia rossa bassa
    bm.faces.new(sections[0])  # parete di poppa
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    triangulate_ngons(bm)
    mesh = bpy.data.meshes.new("Coachroof")
    bm.to_mesh(mesh)
    bm.free()
    obj = replace_object("Coachroof", mesh, col)
    obj.data.materials.append(MAT_GELCOAT)
    obj.data.materials.append(MAT_STRIPE)
    return obj


# ---------------------------------------------------------------------------
# Appendici: chiglia con bulbo, skeg, timone (profili NACA simmetrici)
# ---------------------------------------------------------------------------
def naca_half_thickness(xc, tc):
    return 5 * tc * (0.2969 * math.sqrt(max(xc, 0)) - 0.1260 * xc - 0.3516 * xc ** 2
                     + 0.2843 * xc ** 3 - 0.1036 * xc ** 4)


def foil_ring(le_x, te_x, z, tc, npts=24, thick_cap=None):
    """Anello di un profilo simmetrico a quota z, dal bordo d'uscita intorno al bordo d'attacco."""
    chord = le_x - te_x
    pts = []
    for i in range(npts + 1):
        b = math.pi * i / npts
        xc = 0.5 * (1 - math.cos(b))          # 0 = bordo d'attacco
        t = naca_half_thickness(xc, tc) * chord
        if thick_cap is not None:
            t = min(t, thick_cap)
        pts.append((le_x - xc * chord, t, z))
    lower = [(x, -y, z) for x, y, z in reversed(pts[1:-1])]
    return pts + lower


def loft(name, rings, mat, col, cap_top=True, cap_bottom=True):
    bm = bmesh.new()
    vrings = [[bm.verts.new(to_world(x, y, z)) for x, y, z in r] for r in rings]
    for a, b in zip(vrings, vrings[1:]):
        n = len(a)
        for i in range(n):
            j = (i + 1) % n
            f = bm.faces.new((a[i], a[j], b[j], b[i]))
            f.smooth = True
    if cap_top:
        bm.faces.new(vrings[0])
    if cap_bottom:
        bm.faces.new(list(reversed(vrings[-1])))
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    triangulate_ngons(bm)
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    obj = replace_object(name, mesh, col)
    obj.data.materials.append(mat)
    return obj


def build_keel(col):
    # Dalla tavola: radice a 943 px tra 2150 e 2780; bulbo da 1270 a 1352 px
    root_z = px_z(940) + 0.15          # affonda un poco nello scafo
    tip_z_drawing = px_z(1352)
    k = (DRAFT + px_z(940)) / (px_z(940) - tip_z_drawing)   # allunga fino al pescaggio IRC

    def zz(py):
        return px_z(940) - (px_z(940) - px_z(py)) * k

    rings = []
    # Pinna: dal piede allo scafo fino all'attacco del bulbo
    fin = [  # (quota px, bordo d'attacco px, bordo d'uscita px)
        (940, 2785, 2150), (1100, 2735, 2150), (1270, 2682, 2150)]
    rings.append(foil_ring(px_x(2790), px_x(2150), root_z, 0.12))
    for py, le, te in fin:
        rings.append(foil_ring(px_x(le), px_x(te), zz(py), 0.12))
    # Bulbo (scarpa in piombo): piu spesso, con raccordi tondi agli estremi
    bulb = [(1290, 2680, 2135, 0.15), (1310, 2672, 2115, 0.17), (1330, 2652, 2095, 0.17),
            (1342, 2628, 2085, 0.15), (1349, 2600, 2080, 0.11), (1352, 2560, 2090, 0.05)]
    for py, le, te, tc in bulb:
        rings.append(foil_ring(px_x(le), px_x(te), zz(py), tc))
    return loft("Keel", rings, MAT_LEAD, col)


def build_skeg_and_rudder(col):
    # Rispetto alla tavola di Adrienne II (poppa allungata) il piano velico del 651 standard
    # mette timone e skeg circa 0,3 m più a proravia dello spigolo dello specchio.
    def px_x(px, _f=globals()["px_x"]):
        return _f(px) + RUDDER_SHIFT
    # Skeg: radice nello scafo, bordo d'attacco da (955,847) a (848,1170), uscita a 845
    skeg_rings = [
        foil_ring(px_x(1010), px_x(845), px_z(760) + 0.2, 0.16),
        foil_ring(px_x(955), px_x(845), px_z(847), 0.16),
        foil_ring(px_x(905), px_x(845), px_z(1000), 0.20),
        foil_ring(px_x(852), px_x(840), px_z(1170), 0.5, thick_cap=0.03),
    ]
    skeg = loft("Skeg", skeg_rings, MAT_ANTIFOUL, col)
    # Timone: bordo d'attacco sulla cerniera (845), uscita da (680,702) a (722,1170)
    rudder_rings = [
        foil_ring(px_x(845), px_x(680), px_z(738), 0.11),
        foil_ring(px_x(845), px_x(695), px_z(880), 0.11),
        foil_ring(px_x(845), px_x(710), px_z(1030), 0.10),
        foil_ring(px_x(845), px_x(722), px_z(1170), 0.09),
    ]
    rudder = loft("Rudder", rudder_rings, MAT_ANTIFOUL, col)
    return skeg, rudder


# ---------------------------------------------------------------------------
# Riferimenti: la tavola in scala dietro e sotto la barca
# ---------------------------------------------------------------------------
def build_references(col):
    img = bpy.data.images.load(DRAWING, check_existing=True)
    w, h = img.size

    def empty(name, scale_m_per_px, loc, rot):
        old = bpy.data.objects.get(name)
        if old is not None:
            bpy.data.objects.remove(old, do_unlink=True)
        e = bpy.data.objects.new(name, None)
        e.empty_display_type = "IMAGE"
        e.data = img
        e.empty_display_size = w * scale_m_per_px
        e.location = loc
        e.rotation_euler = rot
        e.use_empty_image_alpha = True
        e.color[3] = 0.5
        e.hide_select = True
        e.hide_viewport = True
        col.objects.link(e)
        return e

    # Profilo nel piano XZ, guardato dal lato dritto (Y negativa)
    cx = (w / 2 - PX_STERN) * S - STERN_CUT - LOA / 2
    cz = (PX_WL - h / 2) * S
    empty("Ref_Profile", S, (cx, -3.5, cz), (math.radians(90), 0, 0))
    # Pianta nel piano XY, sopra la barca
    cxp = (w / 2 - PLAN_STERN) * SP - STERN_CUT - LOA / 2
    cyp = (PLAN_CL - h / 2) * SP
    empty("Ref_Plan", SP, (cxp, cyp, 3.0), (0, 0, 0))


# ---------------------------------------------------------------------------
# Controlli numerici
# ---------------------------------------------------------------------------
def hydro_report(xs):
    """Area delle sezioni immerse integrata lungo X: volume dello scafo nudo."""
    vol = 0.0
    lwl_pts = []
    bwl = 0.0
    prev = None
    for x in xs:
        half = half_section(x)
        area = 0.0
        for (y0, z0), (y1, z1) in zip(half, half[1:]):
            za, zb_ = min(z0, 0.0), min(z1, 0.0)
            area += abs((y0 + y1) / 2 * (za - zb_))
        area *= 2
        if prev is not None:
            vol += (area + prev[1]) / 2 * (x - prev[0])
        prev = (x, area)
        _, zk, _, _, _, _ = station_params(x)
        if zk < 0:
            lwl_pts.append(x)
        for (y0, z0), (y1, z1) in zip(half, half[1:]):
            if (z0 - 0) * (z1 - 0) <= 0 and z0 != z1:
                yw = y0 + (y1 - y0) * (0 - z0) / (z1 - z0)
                bwl = max(bwl, 2 * yw)
    lwl = (max(lwl_pts) - min(lwl_pts)) if lwl_pts else 0
    return {"canoe_volume_m3": round(vol, 2), "lwl_m": round(lwl, 2), "bwl_m": round(bwl, 2),
            "deck_beam_m": round(DECK_BEAM_MAX, 2)}


# ---------------------------------------------------------------------------
# Oblò sui fianchi della tuga, pozzetto, falchetta
# ---------------------------------------------------------------------------
# Finestrature dalla tavola: (x inizio px, x fine px, rientro del lato alto px)
PORTLIGHTS = [(1265, 1329, 0), (1587, 1652, 0), (1848, 1912, 0),
              (2076, 2195, 30), (2249, 2401, 40), (2473, 2621, 40)]


def build_portlights(col):
    bm = bmesh.new()
    for x0p, x1p, slant in PORTLIGHTS:
        x0, x1 = px_x(x0p), px_x(x1p)
        xm = (x0 + x1) / 2
        ztop = coachroof_side_height(xm)
        zbase = deck_z(xm, coachroof_half_width(xm))
        z0 = zbase + (ztop - zbase) * (CR_RED_BAND + 0.08)
        z1 = zbase + (ztop - zbase) * 0.9
        for side in (-1, 1):
            corners = [(x0, z0), (x1, z0), (x1 - slant * S, z1), (x0, z1)]
            vs = []
            for x, z in corners:
                if x < COCKPIT_FWD:
                    y = side * (cockpit_half_width() + 0.06 + 0.012)
                else:
                    y = side * (coachroof_side_y(x, z) + 0.012)
                vs.append(bm.verts.new(to_world(x, y, z)))
            bm.faces.new(vs if side > 0 else list(reversed(vs)))
    mesh = bpy.data.meshes.new("Portlights")
    bm.to_mesh(mesh)
    bm.free()
    obj = replace_object("Portlights", mesh, col)
    obj.data.materials.append(MAT_GLASS)
    return obj


# Pozzetto grande a centro-poppa (foto di Adrienne II, scafo 651-002): ruota a poppa,
# tambuccio principale all'estremità prodiera (scala in pianta a 8,4-9,0 m)
COCKPIT_AFT = 1.15        # pianta di coperta del cantiere: pozzetto da ~1,1 a ~8,1 m
COCKPIT_FWD = 8.1
COCKPIT_DEPTH = 0.40      # profondità del pagliolo del pozzetto sotto la coperta
COCKPIT_STEP = 4.4        # a poppa di qui la piattaforma del timoniere, sopra la cabina armatoriale
COCKPIT_HELM_DEPTH = 0.10


def cockpit_floor(x):
    return interp(SHEER, x) - (COCKPIT_HELM_DEPTH if x < COCKPIT_STEP else COCKPIT_DEPTH)


def cockpit_half_width():
    return coachroof_half_width(COCKPIT_FWD) * 0.95


def build_cockpit(col):
    """Vasca del pozzetto (pagliolo in teak e pareti bianche) e mastre laterali."""
    zs = interp(SHEER, (COCKPIT_AFT + COCKPIT_FWD) / 2)
    w = cockpit_half_width()
    floor = zs - COCKPIT_DEPTH
    x0, x1 = COCKPIT_AFT, COCKPIT_FWD
    bm = bmesh.new()

    def quad(pts, mat=0):
        f = bm.faces.new([bm.verts.new(to_world(*c)) for c in pts])
        f.material_index = mat

    zt = deck_z(x0, w)
    xs = COCKPIT_STEP
    fh = interp(SHEER, xs) - COCKPIT_HELM_DEPTH
    quad([(xs, -w, floor), (x1, -w, floor), (x1, w, floor), (xs, w, floor)], 1)   # pagliolo basso
    quad([(x0, -w, fh), (xs, -w, fh), (xs, w, fh), (x0, w, fh)], 1)               # piattaforma timoniere
    quad([(xs, -w, floor), (xs, w, floor), (xs, w, fh), (xs, -w, fh)])            # gradino
    quad([(x0, -w, floor), (x0, w, floor), (x0, w, zt), (x0, -w, zt)])            # parete di poppa
    quad([(x0, -w, floor), (x0, -w, zt), (x1, -w, zt), (x1, -w, floor)])          # fianco dritta
    quad([(x0, w, floor), (x1, w, floor), (x1, w, zt), (x0, w, zt)])              # fianco sinistra
    # Mastre: pareti spesse 6 cm dal cielo della tuga alla coperta, ai lati della vasca
    t = 0.06
    for side in (-1, 1):
        n = 12
        for i in range(n):
            xa = x0 + (x1 - x0) * i / n
            xb = x0 + (x1 - x0) * (i + 1) / n
            ha, hb = coachroof_side_height(max(xa, CR_AFT_TOP)), coachroof_side_height(max(xb, CR_AFT_TOP))
            yo, yi = side * (w + t), side * w
            quad([(xa, yo, deck_z(xa, w)), (xb, yo, deck_z(xb, w)), (xb, yo, hb), (xa, yo, ha)])
            quad([(xa, yi, ha), (xb, yi, hb), (xb, yi, deck_z(xb, w)), (xa, yi, deck_z(xa, w))])
            quad([(xa, yo, ha), (xb, yo, hb), (xb, yi, hb), (xa, yi, ha)])
    # Panche lungo le mastre (dalla ruota in avanti)
    seat_h, seat_d = 0.40, 0.46
    for side in (-1, 1):
        y_out, y_in = side * w, side * (w - seat_d)
        xa, xb = COCKPIT_STEP + 0.2, x1 - 0.15
        zt = floor + seat_h
        quad([(xa, y_in, zt), (xb, y_in, zt), (xb, y_out, zt), (xa, y_out, zt)], 1)
        quad([(xa, y_in, floor), (xb, y_in, floor), (xb, y_in, zt), (xa, y_in, zt)])
        quad([(xa, y_in, floor), (xa, y_in, zt), (xa, y_out, zt), (xa, y_out, floor)])
        quad([(xb, y_in, floor), (xb, y_out, floor), (xb, y_out, zt), (xb, y_in, zt)])
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    planar_uv(bm)
    mesh = bpy.data.meshes.new("Cockpit")
    bm.to_mesh(mesh)
    bm.free()
    obj = replace_object("Cockpit", mesh, col)
    obj.data.materials.append(MAT_GELCOAT)
    obj.data.materials.append(MAT_TEAK)
    return obj


def cut_cockpit_opening(deck):
    """L'apertura del pozzetto è già nella griglia della coperta (vedi build_deck)."""
    return deck


def build_toerail(col, xs):
    """Falchetta: profilo rettangolare che corre lungo l'insellatura, sui due lati."""
    bm = bmesh.new()
    h, t = 0.055, 0.04
    for side in (-1, 1):
        rings = []
        for x in deck_stations(xs):
            zs, _, yd, _, _, _ = station_params(x)
            xx = x
            y_out = side * yd
            y_in = side * max(yd - t, 0.0)
            ring = [(xx, y_out, zs), (xx, y_out, zs + h), (xx, y_in, zs + h), (xx, y_in, zs)]
            rings.append([bm.verts.new(to_world(*c)) for c in ring])
        for a, b in zip(rings, rings[1:]):
            for i in range(3):
                bm.faces.new((a[i], a[i + 1], b[i + 1], b[i]))
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    mesh = bpy.data.meshes.new("Toerail")
    bm.to_mesh(mesh)
    bm.free()
    obj = replace_object("Toerail", mesh, col)
    obj.data.materials.append(MAT_ALU)
    return obj


def build_transom_sign(col):
    """Cartello "Lunz am Meer" sullo specchio di poppa inclinato."""
    tex = os.path.join(REPO, "models/textures/lunz_transom_sign.png")
    img = bpy.data.images.load(tex, check_existing=True)
    mat = bpy.data.materials.get("Transom_Sign") or bpy.data.materials.new("Transom_Sign")
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    texn = next((n for n in nt.nodes if n.type == "TEX_IMAGE"), None) or nt.nodes.new("ShaderNodeTexImage")
    texn.image = img
    nt.links.new(texn.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.3

    tx, tz = TRANSOM_TOP
    bx, bz = TRANSOM_BOTTOM
    def on_transom(z, off=0.012):
        t = (z - bz) / (tz - bz)
        x = bx + (tx - bx) * t
        # normale dello specchio (verso poppa e in alto)
        nx, nz = -(tz - bz), (tx - bx)
        ln = math.hypot(nx, nz)
        return x + nx / ln * off, z + nz / ln * off
    zc = tz - 0.33
    hw, hh = 0.62, 0.115
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new("UVMap")
    corners = [(-hw, zc - hh, (1, 0)), (hw, zc - hh, (0, 0)), (hw, zc + hh, (0, 1)), (-hw, zc + hh, (1, 1))]
    vs = []
    for y, z, _ in corners:
        x, zz = on_transom(z)
        vs.append(bm.verts.new(to_world(x, y, zz)))
    f = bm.faces.new(vs)
    for loop, (_, _, uvc) in zip(f.loops, corners):
        loop[uv].uv = uvc
    mesh = bpy.data.meshes.new("TransomSign")
    bm.to_mesh(mesh)
    bm.free()
    obj = replace_object("TransomSign", mesh, col)
    obj.data.materials.append(mat)
    return obj


def build_all():
    col = get_collection("Swan651")
    ref = get_collection("Reference")
    hull, xs = build_hull(col)
    deck = build_deck(col, xs)
    coachroof = build_coachroof(col)
    build_portlights(col)
    cut_cockpit_opening(deck)
    build_cockpit(col)
    build_toerail(col, xs)
    # Niente cartello di poppa: il museo racconta il 651 in generale, non un singolo scafo.
    # Le scene costruite prima lo contengono ancora, quindi lo si toglie.
    old_sign = bpy.data.objects.get("TransomSign")
    if old_sign:
        bpy.data.objects.remove(old_sign, do_unlink=True)
    build_keel(col)
    build_skeg_and_rudder(col)
    build_references(ref)
    return hydro_report(xs)


result = build_all()
print(result)
