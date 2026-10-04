"""Swan 651: interni ricostruiti dalla pianta della tavola Nautor (scafo 651-002).

Va eseguito dopo swan651_hull.py nello stesso namespace (riusa scala, sezioni, materiali).
Tutte le posizioni sono in pixel dell'immagine originale della tavola (4960x3507),
convertite con la scala della pianta: X = (px - 444) * SP, Y = (2292 - py) * SP.

Layout (da poppa a prua): gavoni, generatore e cabina armatoriale di poppa con due cuccette,
bagno di poppa e doccia, sala macchine sotto il pozzetto, scala principale, cucina a sinistra,
cabina ospiti e carteggio a dritta, dinette con tavolo a U, albero, due cabine e due bagni
prodieri, cabina di prua a V, gavone delle vele.

Dettagli (Interior_Details): bagni con WC marino, lavabo incassato, mobile in vetroresina bianca,
specchio e pagliolo a grigliato; doccia nell'armatoriale; letti a castello nelle cabine prodiere,
armadi, cassetti e mensole; bordini antirollio, cornici scure sugli spigoli, maniglie e pomelli,
tientibene sul cielino. La trapuntatura dei cuscini è nello shader del web (materials.js).
Le superfici di una faccia sola (paratie) hanno spessore, e le normali puntano verso la cabina:
la lightmap di bake_interior.py cuoce la luce dal lato della normale.
"""
import math
import random

import bmesh
import bpy
from mathutils import Vector


def plan_x(px):
    return (px - PLAN_STERN) * SP - STERN_CUT


def plan_y(py):
    return (PLAN_CL - py) * SP


SOLE_Z = -0.30            # pagliolo della dinette (sotto il galleggiamento)

# Dalle foto degli scafi standard (Show Me, Aurora, 651-001): teak color miele satinato,
# pagliolo teak e holly, cielo in vinile bianco con listelli. Tessuti: pelle rossa (scelta del cliente).
# I bianchi stanno sotto 0,75: più chiari finivano nella spalla del tone mapping, dove le zone in
# piena luce si sbiancano e quelle appena in ombra restano crema, e ogni ombra morbida (occlusione,
# luce cotta) disegnava una chiazza rosata dai bordi netti sui fianchi.
MAT_JOINERY = material("Interior_Teak_Honey", (0.29, 0.115, 0.04), 0.38)
MAT_SOLE = textured_material("Interior_Sole_TeakHolly", "teak_holly_sole.png", 0.3)
MAT_UPHOLSTERY = material("Upholstery_Leather_Red", (0.36, 0.025, 0.03), 0.6)
MAT_MATTRESS = material("Mattress_Cream", (0.7, 0.66, 0.58), 0.9)
MAT_HEADLINER = material("Headliner_White_Vinyl", (0.7, 0.7, 0.68), 0.55)
MAT_WHITE = material("Interior_White", (0.74, 0.74, 0.72), 0.3)
MAT_ENGINE = material("Engine_Grey", (0.25, 0.3, 0.33), 0.5, metallic=0.3)
MAT_COUNTER = material("Galley_Counter", (0.68, 0.66, 0.61), 0.25)
MAT_STEEL_IN = material("Stainless", (0.85, 0.86, 0.88), 0.12, metallic=1.0)

MAT_INSTR = material("Instrument_Black", (0.01, 0.012, 0.015), 0.2)
MAT_BOOKS = [
    material("Book_Oxblood", (0.3, 0.04, 0.03), 0.6),
    material("Book_Navy", (0.03, 0.06, 0.15), 0.6),
    material("Book_Cream", (0.7, 0.62, 0.48), 0.7),
    material("Book_Green", (0.05, 0.15, 0.1), 0.6),
]
# teak più scuro di bordini, cornici e tientibene; specchi dei bagni; vetroresina bianca dei bagni
MAT_TEAK_DARK = material("Interior_Teak_Dark", (0.11, 0.04, 0.014), 0.32)
MAT_MIRROR = material("Interior_Mirror", (0.85, 0.87, 0.88), 0.03, metallic=1.0)
MAT_GRP = material("Interior_GRP_White", (0.7, 0.69, 0.66), 0.2)

MATS = [MAT_JOINERY, MAT_SOLE, MAT_UPHOLSTERY, MAT_MATTRESS, MAT_WHITE, MAT_ENGINE,
        MAT_COUNTER, MAT_STEEL_IN, MAT_HEADLINER, MAT_INSTR, *MAT_BOOKS,
        MAT_TEAK_DARK, MAT_MIRROR, MAT_GRP]
J_, SOLE_, UPH, MATT, WHITE, ENG, CNT, STEEL_, HEAD, INSTR = range(10)
BOOKS = list(range(10, 10 + len(MAT_BOOKS)))
DARK, MIRROR, GRP = range(10 + len(MAT_BOOKS), 13 + len(MAT_BOOKS))


# ---------------------------------------------------------------------------
# Geometria dello scafo all'interno
# ---------------------------------------------------------------------------
def hull_half_breadth(x, z, inset=0.04):
    """Mezza larghezza interna dello scafo alla quota z (dalla sezione generata)."""
    half = half_section(x)
    for (y0, z0), (y1, z1) in zip(half, half[1:]):
        if min(z0, z1) <= z <= max(z0, z1) and z0 != z1:
            y = y0 + (y1 - y0) * (z - z0) / (z1 - z0)
            return max(y - inset, 0.0)
    return 0.0


def underdeck(x, y):
    return deck_z(x, y) - 0.06


def ceiling(x, y):
    """Cielo interno: sotto la tuga, sotto il pagliolo del pozzetto o sotto la coperta."""
    if COCKPIT_FWD <= x < CR_FWD and abs(y) < coachroof_side_y(x, coachroof_side_height(x)):
        return coachroof_side_height(x) - 0.04
    if COCKPIT_AFT <= x < COCKPIT_FWD and abs(y) < cockpit_half_width() + 0.06:
        return cockpit_floor(x) - 0.06
    return underdeck(x, y)


def clamp_to_hull(bm, inset=0.05):
    """Adatta ogni vertice alla forma interna dello scafo e al soffitto."""
    cache = {}
    for v in bm.verts:
        x = v.co.x + LOA / 2
        key = round(x, 2)
        if key not in cache:
            cache[key] = half_section(x)
        half = cache[key]
        z = v.co.z
        y_lim = 0.0
        for (y0, z0), (y1, z1) in zip(half, half[1:]):
            if min(z0, z1) <= z <= max(z0, z1) and z0 != z1:
                y_lim = max(y0 + (y1 - y0) * (z - z0) / (z1 - z0) - inset, 0.0)
                break
        else:
            y_lim = max(half[0][0] - inset, 0.0) if z > half[0][1] else 0.0
        if abs(v.co.y) > y_lim:
            v.co.y = math.copysign(y_lim, v.co.y)
        top = ceiling(x, v.co.y)
        if v.co.z > top:
            v.co.z = top


# ---------------------------------------------------------------------------
# Primitive
# ---------------------------------------------------------------------------
def _frame(d, up):
    """Due assi perpendicolari alla direzione d, il secondo il più vicino possibile a up."""
    d = d.normalized()
    u = Vector(up)
    if abs(d.dot(u)) > 0.95:
        u = Vector((0, 1, 0)) if abs(d.y) < 0.9 else Vector((1, 0, 0))
    s_ = d.cross(u).normalized()
    return s_, s_.cross(d).normalized()

class Builder:
    def __init__(self):
        self.bm = bmesh.new()

    def box(self, x0, x1, y0, y1, z0, z1, mat):
        """Scatola allineata agli assi in coordinate barca (metri)."""
        xa, xb = sorted((x0, x1))
        ya, yb = sorted((y0, y1))
        za, zb = sorted((z0, z1))
        bm = self.bm
        v = [bm.verts.new(to_world(x, y, z)) for x in (xa, xb) for y in (ya, yb) for z in (za, zb)]
        for q in ((0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)):
            f = bm.faces.new([v[i] for i in q])
            f.material_index = mat
            f.smooth = False

    def rbox(self, x0, x1, y0, y1, z0, z1, mat, r=0.04, seg=3):
        """Scatola con spigoli arrotondati: cuscini, materassi, piani dei tavoli."""
        xa, xb = sorted((x0, x1))
        ya, yb = sorted((y0, y1))
        za, zb = sorted((z0, z1))
        r = min(r, (xb - xa) / 2.2, (yb - ya) / 2.2, (zb - za) / 2.2)
        tmp = bmesh.new()
        bmesh.ops.create_cube(tmp, size=1.0)
        for v in tmp.verts:
            v.co = to_world(xa if v.co.x < 0 else xb, ya if v.co.y < 0 else yb, za if v.co.z < 0 else zb)
        bmesh.ops.bevel(tmp, geom=list(tmp.edges), offset=r, segments=seg, profile=0.5, affect="EDGES")
        for f in tmp.faces:
            f.material_index = mat
            f.smooth = True
        me = bpy.data.meshes.new("_rbox_tmp")
        tmp.to_mesh(me)
        tmp.free()
        self.bm.from_mesh(me)
        bpy.data.meshes.remove(me)

    def prbox(self, px0, px1, py0, py1, z0, z1, mat, r=0.04):
        self.rbox(plan_x(px0), plan_x(px1), plan_y(py0), plan_y(py1), z0, z1, mat, r)

    def pbox(self, px0, px1, py0, py1, z0, z1, mat):
        """Scatola da coordinate in pixel della pianta."""
        self.box(plan_x(px0), plan_x(px1), plan_y(py0), plan_y(py1), z0, z1, mat)

    def cyl(self, x, y, z0, z1, r, mat, seg=16):
        bm = self.bm
        a = [bm.verts.new(to_world(x + r * math.cos(2 * math.pi * i / seg),
                                   y + r * math.sin(2 * math.pi * i / seg), z0)) for i in range(seg)]
        b = [bm.verts.new(to_world(x + r * math.cos(2 * math.pi * i / seg),
                                   y + r * math.sin(2 * math.pi * i / seg), z1)) for i in range(seg)]
        for i in range(seg):
            j = (i + 1) % seg
            f = bm.faces.new((a[i], a[j], b[j], b[i]))
            f.material_index = mat
            f.smooth = True
        for ring in (list(reversed(a)), b):
            f = bm.faces.new(ring)
            f.material_index = mat

    def poly(self, pts, mat):
        """Faccia piana da punti barca (x, y, z)."""
        f = self.bm.faces.new([self.bm.verts.new(to_world(*p)) for p in pts])
        f.material_index = mat
        return f

    def _faces(self, vs, quads, mat, smooth=False):
        for q in quads:
            f = self.bm.faces.new([vs[i] for i in q])
            f.material_index = mat
            f.smooth = smooth

    def beam(self, p0, p1, w, h, mat, up=(0, 0, 1)):
        """Listello a sezione rettangolare w x h da p0 a p1 (coordinate barca): bordini, cornici,
        stecche dei grigliati, montanti. h è misurato lungo up."""
        a, c = Vector(p0), Vector(p1)
        s_, u = _frame(c - a, up)
        prof = ((-w / 2, -h / 2), (w / 2, -h / 2), (w / 2, h / 2), (-w / 2, h / 2))
        vs = [self.bm.verts.new(to_world(*(p + s_ * x + u * y))) for p in (a, c) for x, y in prof]
        self._faces(vs, ((0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7), (3, 2, 1, 0), (4, 5, 6, 7)), mat)

    def tube(self, p0, p1, r, mat, seg=8, caps=True):
        """Cilindro tra due punti qualsiasi: pomelli, tientibene, rubinetti, tubi."""
        a, c = Vector(p0), Vector(p1)
        s_, u = _frame(c - a, (0, 0, 1))
        ring = [s_ * (r * math.cos(2 * math.pi * i / seg)) + u * (r * math.sin(2 * math.pi * i / seg)) for i in range(seg)]
        ra = [self.bm.verts.new(to_world(*(a + q))) for q in ring]
        rb = [self.bm.verts.new(to_world(*(c + q))) for q in ring]
        for i in range(seg):
            j = (i + 1) % seg
            f = self.bm.faces.new((ra[i], ra[j], rb[j], rb[i]))
            f.material_index = mat
            f.smooth = True
        if caps:
            for rr in (list(reversed(ra)), rb):
                f = self.bm.faces.new(rr)
                f.material_index = mat

    def lathe(self, cx, cy, rings, mat, seg=20, cap_top=True, cap_bottom=True):
        """Solido di rivoluzione a superellissi: rings = [(z, rx, ry, n)], n alto = quasi rettangolo.
        Ceramiche dei bagni: tazza del WC, vasca del lavabo."""
        loops = []
        for z, rx, ry, n in rings:
            loop = []
            for i in range(seg):
                t = 2 * math.pi * i / seg
                c_, s_ = math.cos(t), math.sin(t)
                x = rx * math.copysign(abs(c_) ** (2 / n), c_)
                y = ry * math.copysign(abs(s_) ** (2 / n), s_)
                loop.append(self.bm.verts.new(to_world(cx + x, cy + y, z)))
            loops.append(loop)
        for la, lb in zip(loops, loops[1:]):
            for i in range(seg):
                j = (i + 1) % seg
                f = self.bm.faces.new((la[i], la[j], lb[j], lb[i]))
                f.material_index = mat
                f.smooth = True
        # tappi a ventaglio: triangoli piccoli attorno a un centro, invece di un n-gono lungo
        for loop, z, on in ((loops[0], rings[0][0], cap_bottom), (loops[-1], rings[-1][0], cap_top)):
            if not on:
                continue
            cen = self.bm.verts.new(to_world(cx, cy, z))
            for i in range(seg):
                f = self.bm.faces.new((loop[i], loop[(i + 1) % seg], cen))
                f.material_index = mat
                f.smooth = True

    def finish(self, name, col, clamp=True, thickness=0.0, facing=None):
        bm = self.bm
        if clamp:
            clamp_to_hull(bm)
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
        if facing is None:
            # gusci chiusi (scatole, cilindri): normali verso l'esterno, come le vuole la cottura
            bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        else:
            # superfici aperte: normali verso la cabina, dove si vede (e si cuoce) la luce
            bm.normal_update()
            for f in bm.faces:
                c_ = f.calc_center_median()
                if f.normal.dot(Vector(facing(c_))) < 0:
                    f.normal_flip()
        for f, fn in getattr(self, "want", []):
            if f.is_valid and f.normal.dot(Vector(fn(f.calc_center_median()))) < 0:
                f.normal_flip()
        if thickness:
            # paratie con spessore: le due facce hanno ciascuna la sua luce nella lightmap
            bmesh.ops.solidify(bm, geom=bm.faces[:], thickness=thickness)
            bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        triangulate_ngons(bm)
        planar_uv(bm)
        mesh = bpy.data.meshes.new(name)
        bm.to_mesh(mesh)
        bm.free()
        obj = replace_object(name, mesh, col)
        for m in MATS:
            obj.data.materials.append(m)
        return obj


# ---------------------------------------------------------------------------
# Pagliolo e paratie
# ---------------------------------------------------------------------------
def sole_z_at(x):
    """Pagliolo un po' più alto a poppa (sopra il serbatoio) e a prua (scafo stretto)."""
    if x < plan_x(1610):
        return SOLE_Z + 0.12
    if x > plan_x(3404):
        return SOLE_Z + 0.45
    if x > plan_x(3087):
        return SOLE_Z + 0.15
    return SOLE_Z


def build_sole(col):
    b = Builder()
    x0, x1 = plan_x(1070), plan_x(3720)
    n = 60
    xs = [x0 + (x1 - x0) * i / n for i in range(n + 1)]
    for xa, xb in zip(xs, xs[1:]):
        za, zb = sole_z_at(xa), sole_z_at(xb)
        if abs(za - zb) > 1e-6:
            # gradino tra due livelli
            yb_ = hull_half_breadth(xb, zb)
            b.poly([(xb, -yb_, za), (xb, yb_, za), (xb, yb_, zb), (xb, -yb_, zb)], SOLE_)
        ya = hull_half_breadth(xa, za)
        yb_ = hull_half_breadth(xb, za)
        b.poly([(xa, -ya, za), (xb, -yb_, za), (xb, yb_, za), (xa, ya, za)], SOLE_)
    return b.finish("Interior_Sole", col, facing=lambda c: (0, 0, 1))


def bulkhead(b, px, door_half=0.33, door_h=1.9, door_y=0.0, solid=False):
    """Paratia trasversale sagomata sullo scafo, con porta centrale."""
    x = plan_x(px)
    z0 = sole_z_at(x + 0.01)
    for side in (-1, 1):
        pts = []
        zs_side = interp(SHEER, x)
        n = 14
        for i in range(n + 1):
            z = z0 + (zs_side - 0.05 - z0) * i / n
            pts.append((x, side * hull_half_breadth(x, z), z))
        yd = station_params(x)[2]
        for i in range(1, 9):
            y = side * yd * (1 - i / 8)
            pts.append((x, y, ceiling(x, y)))
        if solid:
            pts.append((x, 0.0, z0))
        else:
            # vano porta con gli angoli alti arrotondati, come nelle paratie Swan
            rc = min(0.24, door_half * 0.9)
            pts.append((x, door_y, z0 + door_h))
            for k in range(1, 8):
                a = math.pi / 2 * k / 7
                pts.append((x, door_y + side * (door_half - rc + rc * math.sin(a)),
                            z0 + door_h - rc + rc * math.cos(a)))
            pts.append((x, door_y + side * door_half, z0))
        # ordine coerente della faccia
        if side < 0:
            pts = list(reversed(pts))
        b.poly(pts, J_)


def wall(b, px0, px1, py, z_top=None, mat=None):
    """Paratia longitudinale da px0 a px1 alla riga py della pianta."""
    x0, x1 = plan_x(px0), plan_x(px1)
    y = plan_y(py)
    z0 = sole_z_at((x0 + x1) / 2)
    pts = [(x0, y, z0), (x1, y, z0)]
    n = 6
    for i in range(n + 1):
        x = x1 + (x0 - x1) * i / n
        pts.append((x, y, ceiling(x, y) if z_top is None else z_top))
    b.poly(pts, J_ if mat is None else mat)


def build_bulkheads(col):
    b = Builder()
    bulkhead(b, 1065, solid=True)          # gavoni di poppa
    bulkhead(b, 1432, door_half=0.45)      # cabina di poppa / spogliatoio
    bulkhead(b, 1610, door_half=0.32, door_y=-0.62)   # bagno di poppa, passaggio a dritta
    bulkhead(b, 2030, door_half=0.38)      # sala macchine / scala principale
    bulkhead(b, 2722, door_half=0.35)      # dinette / cabine prodiere
    bulkhead(b, 3404, door_half=0.3)       # cabina di prua
    bulkhead(b, 3727, solid=True)          # gavone delle vele (collisione)
    # Pareti longitudinali: cabina di poppa, sala macchine, corridoio prodiero
    wall(b, 1148, 1432, 2203)
    wall(b, 1148, 1432, 2435)
    wall(b, 1745, 2030, 2205)
    wall(b, 1745, 2030, 2380)
    wall(b, 1615, 1745, 2207)
    wall(b, 2030, 2030 + 1, 2460)
    wall(b, 2986, 3404, 2284)
    wall(b, 2727, 3306, 2430)
    return b.finish("Interior_Bulkheads", col, thickness=0.022)


# ---------------------------------------------------------------------------
# Arredi
# ---------------------------------------------------------------------------
def berth(b, px0, px1, py0, py1, h=0.45, z0=None, drawers=0):
    """Cuccetta: cassone in teak, materasso e listello scuro sul bordo verso la cabina.
    drawers: cassetti (gavoni) sul fronte del cassone."""
    x0, x1 = plan_x(px0), plan_x(px1)
    if z0 is None:
        z0 = sole_z_at((x0 + x1) / 2)
    b.pbox(px0, px1, py0, py1, z0, z0 + h - 0.14, J_)
    b.prbox(px0 + 6, px1 - 6, py0 + 6, py1 - 6, z0 + h - 0.15, z0 + h, MATT, r=0.05)
    ya, yb = plan_y(py0), plan_y(py1)
    inner = ya if abs(ya) < abs(yb) else yb
    sg = 1 if inner > (ya + yb) / 2 else -1           # verso del fronte, dalla cuccetta alla cabina
    b.box(x0, x1, inner - sg * 0.01, inner + sg * 0.012, z0 + h - 0.17, z0 + h - 0.13, DARK)
    if drawers:
        doors(b, px0 + 15, px1 - 15, py0 if inner == ya else py1, z0 + 0.04, z0 + h - 0.18, drawers, sg, knob="pull")


def settee(b, px0, px1, py0, py1, back_side):
    """Divano: seduta, cuscino e schienale verso back_side ('out' = verso lo scafo)."""
    x0 = plan_x(px0)
    z0 = sole_z_at(x0)
    b.pbox(px0, px1, py0, py1, z0, z0 + 0.3, J_)
    yy0, yy1 = plan_y(py0), plan_y(py1)
    outward = yy0 if abs(yy0) > abs(yy1) else yy1
    t = 0.14 if outward > 0 else -0.14
    xa, xb = plan_x(px0), plan_x(px1)
    # seduta e schienale a moduli di circa 60 cm, con bordi arrotondati
    n = max(1, round((xb - xa) / 0.6))
    w = (xb - xa) / n
    for i in range(n):
        x0_, x1_ = xa + i * w + 0.006, xa + (i + 1) * w - 0.006
        b.rbox(x0_, x1_, yy0, yy1, z0 + 0.3, z0 + 0.45, UPH, r=0.045)
        b.rbox(x0_, x1_, outward, outward - t, z0 + 0.45, z0 + 0.92, UPH, r=0.05)


def doors(b, px0, px1, py, z0, z1, n, toward, knob="knob", mat=J_):
    """Ante con pannello in rilievo sul fronte di un mobile; toward = verso del fronte in y (+1/-1).
    knob: pomello d'acciaio vicino al bordo d'apertura, "pull" una maniglia a incasso scura in
    alto al centro (cassetti), None nessuna."""
    x0, x1 = plan_x(px0), plan_x(px1)
    y = plan_y(py)
    w = (x1 - x0) / n
    for i in range(n):
        xa, xb = x0 + i * w + 0.015, x0 + (i + 1) * w - 0.015
        b.box(xa, xb, y, y + toward * 0.012, z0 + 0.05, z1 - 0.04, mat)
        if xb - xa > 0.16 and z1 - z0 > 0.25:
            b.box(xa + 0.05, xb - 0.05, y + toward * 0.012, y + toward * 0.022, z0 + 0.11, z1 - 0.1, mat)
        yf = y + toward * 0.022
        if knob == "knob":
            # ante a coppie che si aprono dal centro, le altre dal lato verso prua
            xk = xb - 0.045 if (i % 2 == 0 and n > 1) or n == 1 else xa + 0.045
            zk = min(z1 - 0.12, z0 + 0.75)
            b.tube((xk, yf, zk), (xk, yf + toward * 0.028, zk), 0.013, STEEL_, seg=8)
        elif knob == "pull":
            xm = (xa + xb) / 2
            b.box(xm - 0.05, xm + 0.05, yf - toward * 0.004, yf + toward * 0.003, z1 - 0.1, z1 - 0.075, INSTR)


def fiddle(b, x0, x1, y0, y1, z, h=0.04):
    """Bordino anti-rollio lungo un lato di un piano, in teak scuro."""
    b.box(x0, x1, y0, y1, z, z + h, DARK)


def fiddle_rim(b, x0, x1, y0, y1, z, h=0.035, t=0.02):
    """Bordino su tutti e quattro i lati di un piano (tavoli, mensole, carteggio)."""
    xa, xb = sorted((x0, x1))
    ya, yb = sorted((y0, y1))
    b.box(xa, xb, ya, ya + t, z, z + h, DARK)
    b.box(xa, xb, yb - t, yb, z, z + h, DARK)
    b.box(xa, xa + t, ya + t, yb - t, z, z + h, DARK)
    b.box(xb - t, xb, ya + t, yb - t, z, z + h, DARK)


def bookshelf(b, px0, px1, py0, py1, z0, z1, seed=0):
    """Libreria sopra i divani: fondo, cielo, montanti, bordino e una fila di libri."""
    rng = random.Random(seed)
    x0, x1 = plan_x(px0), plan_x(px1)
    ya, yb = plan_y(py0), plan_y(py1)
    outer = ya if abs(ya) > abs(yb) else yb
    inner = yb if outer == ya else ya
    sg = 1 if outer > 0 else -1
    b.box(x0, x1, ya, yb, z0, z0 + 0.03, J_)
    b.box(x0, x1, ya, yb, z1 - 0.03, z1, J_)
    n = max(1, round((x1 - x0) / 0.65))
    posts = [x0 + (x1 - x0) * i / n for i in range(n + 1)]
    for xx in posts:
        b.box(xx - 0.012, xx + 0.012, ya, yb, z0, z1, J_)
    fiddle(b, x0, x1, inner, inner + sg * 0.02, z0 + 0.03, 0.07)
    x = x0 + 0.02
    while x < x1 - 0.06:
        if any(abs(x - p) < 0.03 for p in posts):
            x += 0.03
            continue
        if rng.random() < 0.06:
            x += rng.uniform(0.05, 0.12)
            continue
        wb = rng.uniform(0.022, 0.05)
        hb = rng.uniform(0.17, min(0.27, z1 - z0 - 0.08))
        d = rng.uniform(0.13, 0.18)
        b.box(x, x + wb, outer - sg * 0.02, outer - sg * (0.02 + d), z0 + 0.03, z0 + 0.03 + hb,
              rng.choice(BOOKS))
        x += wb + 0.003


def build_furniture(col):
    b = Builder()
    # --- Poppa: generatore, cuccette armatoriali, scaletta di poppa
    z = sole_z_at(plan_x(1150))
    b.pbox(1093, 1193, 2223, 2412, z, z + 0.65, ENG)                     # generatore
    berth(b, 1148, 1432, 1960, 2203, drawers=2)                         # cuccetta sinistra
    berth(b, 1148, 1432, 2435, 2628, drawers=2)                         # cuccetta dritta
    b.pbox(1435, 1605, 2012, 2090, z, z + 1.85, J_)                     # armadio
    b.cyl(plan_x(1492), plan_y(2142), z, z + 0.45, 0.17, UPH)           # sgabello toilette
    b.pbox(1435, 1605, 1960, 2010, z + 0.7, z + 0.78, J_)               # mensola toilette
    # scaletta di poppa (dal pozzetto)
    zt = cockpit_floor(plan_x(1340))
    for i in range(5):
        x = plan_x(1300) + i * 0.1
        zz = z + (zt - z) * (i + 1) / 6
        b.box(x, x + 0.07, plan_y(2250), plan_y(2335), zz - 0.03, zz, J_)

    # --- Bagno di poppa (sinistra) e doccia centrale: in build_details
    z = sole_z_at(plan_x(1700))

    # --- Sala macchine e scala principale
    b.pbox(1870, 2025, 2245, 2355, z, z + 0.85, ENG)                    # motore Perkins
    b.pbox(1760, 1820, 2265, 2345, z, z + 0.6, ENG)                     # trasmissione / pompe
    zt = coachroof_side_height(plan_x(2150)) - 0.05
    for i in range(7):
        x = plan_x(2030) + i * (plan_x(2150) - plan_x(2030)) / 7
        zz = z + (zt - z) * (7 - i) / 8
        b.box(x, x + 0.09, plan_y(2250), plan_y(2365), zz - 0.04, zz, J_)

    # --- Cucina (sinistra): banco esterno a L, penisola, fornello, lavelli, frigo
    z = sole_z_at(plan_x(2000))
    b.pbox(1825, 2275, 1900, 2005, z, z + 0.92, J_)
    b.pbox(1825, 2275, 1900, 2005, z + 0.92, z + 0.95, CNT)
    b.pbox(1950, 2145, 2135, 2225, z, z + 0.92, J_)
    b.pbox(1950, 2145, 2135, 2225, z + 0.92, z + 0.95, CNT)
    b.pbox(2085, 2195, 1910, 2015, z + 0.95, z + 0.99, STEEL_)          # fornello basculante
    b.pbox(1960, 2075, 2140, 2180, z + 0.9, z + 0.955, STEEL_)          # lavelli
    b.pbox(1885, 1950, 2040, 2130, z, z + 0.92, WHITE)                  # frigo
    # fuochi del fornello, vasche dei lavelli, rubinetto, bordini e ante
    for bx in (2110, 2165):
        for by in (1935, 1985):
            b.cyl(plan_x(bx), plan_y(by), z + 0.99, z + 1.0, 0.045, INSTR, seg=20)
    b.pbox(1968, 2016, 2146, 2176, z + 0.951, z + 0.957, INSTR)
    b.pbox(2024, 2070, 2146, 2176, z + 0.951, z + 0.957, INSTR)
    b.cyl(plan_x(2020), plan_y(2190), z + 0.95, z + 1.2, 0.012, STEEL_, seg=10)
    b.box(plan_x(2020) - 0.01, plan_x(2020) + 0.01, plan_y(2190), plan_y(2160), z + 1.18, z + 1.2, STEEL_)
    fiddle(b, plan_x(1825), plan_x(2275), plan_y(2005), plan_y(2005) - 0.02, z + 0.95)
    fiddle(b, plan_x(1950), plan_x(2145), plan_y(2135), plan_y(2135) + 0.02, z + 0.95)
    fiddle(b, plan_x(1950), plan_x(2145), plan_y(2225), plan_y(2225) - 0.02, z + 0.95)
    doors(b, 1955, 2275, 2005, z, z + 0.92, 4, -1)
    doors(b, 1950, 2145, 2135, z, z + 0.92, 3, 1)
    doors(b, 1950, 2145, 2225, z, z + 0.92, 3, -1)

    # --- Cabina ospiti di dritta e carteggio
    berth(b, 1620, 1975, 2560, 2740, drawers=3)
    b.pbox(2125, 2215, 2520, 2650, z, z + 0.78, J_)                     # tavolo da carteggio
    b.pbox(2125, 2215, 2520, 2650, z + 0.78, z + 0.82, CNT)
    b.pbox(2035, 2115, 2540, 2630, z, z + 0.45, UPH)                    # seduta
    b.pbox(2215, 2275, 2500, 2700, z + 0.8, z + 1.5, J_)                # pannello strumenti
    # strumenti sul pannello (guardano a poppa) e schienale della seduta
    xf = plan_x(2215) - 0.012
    for (pa, pb_, za, zb) in ((2525, 2600, 1.02, 1.22), (2610, 2680, 1.02, 1.22),
                              (2525, 2570, 1.28, 1.42), (2580, 2625, 1.28, 1.42), (2635, 2680, 1.28, 1.42)):
        b.box(xf, xf + 0.012, plan_y(pa), plan_y(pb_), z + za, z + zb, INSTR)
    b.pbox(2125, 2215, 2520, 2650, z + 0.82, z + 0.83, J_)               # coperchio del tavolo
    b.prbox(2030, 2045, 2540, 2630, z + 0.45, z + 0.85, UPH, r=0.03)     # schienale
    doors(b, 2125, 2215, 2650, z, z + 0.78, 1, -1)
    fiddle_rim(b, plan_x(2125), plan_x(2215), plan_y(2520), plan_y(2650), z + 0.83, h=0.03)

    # --- Dinette: U a sinistra con tavolo, divano lineare a dritta, credenze
    z = sole_z_at(plan_x(2500))
    settee(b, 2306, 2692, 1968, 2075, "out")                            # schienale U (lato esterno)
    settee(b, 2306, 2412, 2075, 2257, "out")                            # braccio poppiero
    settee(b, 2590, 2692, 2075, 2257, "out")                            # braccio prodiero
    b.pbox(2425, 2580, 2085, 2245, z, z + 0.68, J_)                     # piede tavolo
    b.prbox(2412, 2590, 2072, 2247, z + 0.68, z + 0.74, J_, r=0.03)     # piano tavolo
    fiddle(b, plan_x(2420), plan_x(2582), plan_y(2160) + 0.01, plan_y(2160) - 0.01, z + 0.74, 0.03)
    fiddle_rim(b, plan_x(2416), plan_x(2586), plan_y(2076), plan_y(2243), z + 0.74, h=0.028, t=0.022)
    b.prbox(2458, 2552, 2260, 2310, z, z + 0.45, UPH, r=0.05)           # pouf
    settee(b, 2275, 2636, 2546, 2633, "out")                            # divano di dritta
    bookshelf(b, 2290, 2710, 1830, 1950, z + 0.95, z + 1.3, seed=1)    # libreria sinistra
    bookshelf(b, 2290, 2630, 2625, 2700, z + 0.95, z + 1.3, seed=2)    # libreria dritta
    doors(b, 2636, 2727, 2430, z, z + 0.95, 1, 1)                       # mobile a dritta
    b.pbox(2636, 2727, 2430, 2572, z, z + 0.95, J_)                     # mobile a dritta

    # --- Cabine prodiere: letti a castello (cuccetta bassa qui, alta e armadi in build_details)
    berth(b, 2722, 3087, 1942, 2145, h=0.4, drawers=2)                  # cuccetta sinistra
    berth(b, 2950, 3306, 2409, 2633, h=0.4, drawers=2)                  # cuccetta dritta
    # bagni prodieri: in build_details

    # --- Cabina di prua a V
    z = sole_z_at(plan_x(3550))
    for py0, py1 in ((2085, 2290), (2300, 2506)):
        x0, x1 = plan_x(3407), plan_x(3772)
        y0, y1 = plan_y(py0), plan_y(py1)
        # la V si stringe verso prua: rastrema la larghezza
        n = 4
        for i in range(n):
            xa = x0 + (x1 - x0) * i / n
            xb = x0 + (x1 - x0) * (i + 1) / n
            yo = min(hull_half_breadth(xb, z + 0.45), max(abs(y0), abs(y1)))
            yi = 0.06
            sgn = 1 if y0 > 0 else -1
            b.box(xa, xb, sgn * yi, sgn * yo, z, z + 0.31, J_)
            b.box(xa, xb, sgn * (yi + 0.03), sgn * (yo - 0.03), z + 0.31, z + 0.45, MATT)
    return b.finish("Interior_Furniture", col)


def build_mast_step_and_table_hint(col):
    """Il passaggio dell'albero è già nel modello dell'albero (passante fino in chiglia)."""
    return None


def build_lining(col):
    """Rivestimento interno dei fianchi (cielino laterale) dal pagliolo alla coperta."""
    b = Builder()
    x0, x1 = plan_x(1068), plan_x(3724)
    n, m = 80, 10
    rows = []
    for i in range(n + 1):
        x = x0 + (x1 - x0) * i / n
        z0 = sole_z_at(x) - 0.02
        z1 = interp(SHEER, x) - 0.03
        row = []
        for side in (-1, 1):
            pts = []
            for j in range(m + 1):
                z = z0 + (z1 - z0) * j / m
                pts.append((x, side * hull_half_breadth(x, z, inset=0.03), z))
            row.append(pts)
        rows.append(row)
    for a, c in zip(rows, rows[1:]):
        for side in range(2):
            for j in range(m):
                b.poly([a[side][j], c[side][j], c[side][j + 1], a[side][j + 1]], HEAD)
    # vinile bianco come il cielino (prima era il tessuto crema dei materassi)
    return b.finish("Interior_Lining", col, clamp=False, facing=lambda c: (0, -math.copysign(1, c.y), 0))


def build_headliner(col):
    """Cielo in vinile bianco sotto coperta e tuga, con listelli trasversali in teak."""
    b = Builder()
    x0, x1 = plan_x(1068), plan_x(3724)
    nx, ny = 70, 16
    grid = []
    for i in range(nx + 1):
        x = x0 + (x1 - x0) * i / nx
        yh = hull_half_breadth(x, interp(SHEER, x) - 0.05, inset=0.03)
        grid.append([(x, -yh + 2 * yh * j / ny, 0.0) for j in range(ny + 1)])
    for i in range(nx + 1):
        grid[i] = [(x, y, ceiling(x, y) - 0.01) for x, y, _ in grid[i]]
    for a, c in zip(grid, grid[1:]):
        for j in range(ny):
            b.poly([a[j], a[j + 1], c[j + 1], c[j]], HEAD)
    # listelli ogni 0,6 m
    x = x0 + 0.3
    while x < x1:
        yh = hull_half_breadth(x, interp(SHEER, x) - 0.05, inset=0.05)
        n = 10
        for j in range(n):
            ya = -yh + 2 * yh * j / n
            yb_ = -yh + 2 * yh * (j + 1) / n
            za, zb = ceiling(x, ya) - 0.015, ceiling(x, yb_) - 0.015
            b.poly([(x - 0.025, ya, za), (x + 0.025, ya, za), (x + 0.025, yb_, zb), (x - 0.025, yb_, zb)], J_)
        x += 0.6
    return b.finish("Interior_Headliner", col, clamp=False, facing=lambda c: (0, 0, -1))


def build_mast_post(col):
    """L'albero passante, rivestito in teak nella dinette (dettaglio ricorrente nelle foto)."""
    b = Builder()
    z0 = sole_z_at(MAST_X)
    b.cyl(MAST_X, 0.0, z0, ceiling(MAST_X, 0.0), 0.2, J_, seg=24)
    return b.finish("Interior_MastPost", col, clamp=False)


def build_portlight_trims(col):
    """Cornici in acciaio degli oblò, viste dall'interno della tuga e del pozzetto."""
    b = Builder()
    t, d = 0.035, 0.02
    for x0p, x1p, slant in PORTLIGHTS:
        x0, x1 = px_x(x0p), px_x(x1p)
        xm = (x0 + x1) / 2
        ztop = coachroof_side_height(xm)
        zbase = deck_z(xm, coachroof_half_width(xm))
        z0 = zbase + (ztop - zbase) * (CR_RED_BAND + 0.08)
        z1 = zbase + (ztop - zbase) * 0.9
        x1t = x1 - slant * S
        for side in (-1, 1):
            if xm < COCKPIT_FWD:
                y = side * (cockpit_half_width() + 0.06 - 0.03)
            else:
                y = side * (coachroof_side_y(xm, (z0 + z1) / 2) - 0.03)
            ya, yb = y, y - side * d
            b.box(x0 - t, x1 + t, ya, yb, z0 - t, z0, STEEL_)
            b.box(x0 - t, x1t + t, ya, yb, z1, z1 + t, STEEL_)
            b.box(x0 - t, x0, ya, yb, z0, z1, STEEL_)
            b.box((x1 + x1t) / 2, (x1 + x1t) / 2 + t, ya, yb, z0, z1, STEEL_)
    return b.finish("Interior_Trim", col, clamp=False)


# ---------------------------------------------------------------------------
# Dettagli: bagni, castelli, armadi, cornici, maniglie, tientibene
# ---------------------------------------------------------------------------
def grating(b, px0, px1, py0, py1, z, pitch=0.075):
    """Pagliolo a grigliato in teak dei bagni: fondo scuro e stecche incrociate."""
    xa, xb = sorted((plan_x(px0), plan_x(px1)))
    ya, yb = sorted((plan_y(py0), plan_y(py1)))
    b.box(xa, xb, ya, yb, z, z + 0.012, INSTR)
    n = max(2, round((xb - xa) / pitch))
    for i in range(n + 1):
        x = min(max(xa + (xb - xa) * i / n, xa + 0.011), xb - 0.011)
        b.box(x - 0.011, x + 0.011, ya, yb, z + 0.012, z + 0.04, DARK)
    m = max(2, round((yb - ya) / pitch))
    for j in range(m + 1):
        y = min(max(ya + (yb - ya) * j / m, ya + 0.011), yb - 0.011)
        b.box(xa, xb, y - 0.011, y + 0.011, z + 0.012, z + 0.034, DARK)


def basin_counter(b, x0, x1, y0, y1, z, z_top, cx, cy, rx, ry):
    """Mobile del bagno in vetroresina bianca con lavabo incassato: cassone, piano a cornice
    attorno al foro e vasca a superellisse (normali verso l'interno della vasca)."""
    xa, xb = sorted((x0, x1))
    ya, yb = sorted((y0, y1))
    t = 0.03
    b.box(xa, xb, ya, yb, z, z_top - 0.17, GRP)
    # fianchi fra cassone e piano, che chiudono la vasca appesa al foro
    for (a0, a1, c0, c1) in ((xa, xb, ya, ya + 0.015), (xa, xb, yb - 0.015, yb), (xa, xa + 0.015, ya, yb), (xb - 0.015, xb, ya, yb)):
        b.box(a0, a1, c0, c1, z_top - 0.17, z_top - t, GRP)
    hx0, hx1, hy0, hy1 = cx - rx, cx + rx, cy - ry, cy + ry
    b.box(xa, xb, ya, hy0, z_top - t, z_top, GRP)
    b.box(xa, xb, hy1, yb, z_top - t, z_top, GRP)
    b.box(xa, hx0, hy0, hy1, z_top - t, z_top, GRP)
    b.box(hx1, xb, hy0, hy1, z_top - t, z_top, GRP)
    b.bm.faces.ensure_lookup_table()
    n0 = len(b.bm.faces)
    b.lathe(cx, cy, [(z_top - 0.15, rx * 0.42, ry * 0.42, 2.0), (z_top - 0.11, rx * 0.78, ry * 0.78, 2.2),
                     (z_top - 0.04, rx * 0.97, ry * 0.97, 4.0), (z_top - 0.001, rx, ry, 10.0)],
            WHITE, seg=20, cap_top=False, cap_bottom=True)
    b.bm.faces.ensure_lookup_table()
    cw = cx - LOA / 2
    for f in b.bm.faces[n0:]:
        b.want.append((f, lambda c, cw=cw, cy=cy: (cw - c.x, cy - c.y, 0.4)))
    b.cyl(cx, cy, z_top - 0.152, z_top - 0.148, 0.022, STEEL_, seg=10)


def faucet(b, x, y, z, toward):
    """Miscelatore: colonna, bocca verso la vasca (toward = (dx, dy)) e leva."""
    b.tube((x, y, z), (x, y, z + 0.15), 0.013, STEEL_, seg=8)
    b.beam((x, y, z + 0.14), (x + toward[0] * 0.13, y + toward[1] * 0.13, z + 0.12), 0.018, 0.016, STEEL_)
    b.beam((x, y, z + 0.155), (x - toward[0] * 0.07, y - toward[1] * 0.07, z + 0.175), 0.012, 0.01, STEEL_)


def mirror(b, x, y0, y1, z0, z1, toward_x):
    """Specchio a parete su una paratia trasversale, cornice in teak scuro."""
    xf = x + toward_x * 0.004
    b.box(x, xf, y0, y1, z0, z1, MIRROR)
    xc = x + toward_x * 0.012
    for p0, p1 in (((xc, y0, z0), (xc, y1, z0)), ((xc, y0, z1), (xc, y1, z1)),
                   ((xc, y0, z0), (xc, y0, z1)), ((xc, y1, z0), (xc, y1, z1))):
        b.beam(p0, p1, 0.035, 0.022, DARK, up=(1, 0, 0))


def marine_wc(b, px, py, z, fx, fy):
    """WC marino: tazza a superellisse col sedile e il coperchio chiusi, basamento posteriore,
    pompa a mano d'acciaio e tubo di scarico. (fx, fy) è il verso in cui guarda chi siede."""
    x, y = plan_x(px), plan_y(py)
    along_x = abs(fx) > abs(fy)

    def r(a, c):
        return (a, c) if along_x else (c, a)

    cx, cy = x + fx * 0.05, y + fy * 0.05
    b.lathe(cx, cy, [(z, *r(0.15, 0.12), 3.0), (z + 0.18, *r(0.17, 0.135), 2.4),
                     (z + 0.34, *r(0.2, 0.16), 2.2)], WHITE, seg=20)
    b.lathe(cx, cy, [(z + 0.34, *r(0.205, 0.165), 2.3), (z + 0.372, *r(0.208, 0.168), 2.3),
                     (z + 0.39, *r(0.19, 0.15), 2.6)], WHITE, seg=20)
    bx, by = x - fx * 0.2, y - fy * 0.2
    hw, hd = (0.06, 0.13) if along_x else (0.13, 0.06)
    b.box(bx - hw, bx + hw, by - hd, by + hd, z, z + 0.42, GRP)
    # pompa a lato del basamento, con la leva
    sx, sy = (0.0, 0.17) if along_x else (0.17, 0.0)
    qx, qy = bx + sx, by + sy
    b.tube((qx, qy, z + 0.3), (qx, qy, z + 0.62), 0.028, STEEL_, seg=10)
    b.tube((qx, qy, z + 0.62), (qx, qy, z + 0.78), 0.008, STEEL_, seg=6)
    b.beam((qx, qy, z + 0.78), (qx + fx * 0.14, qy + fy * 0.14, z + 0.8), 0.016, 0.016, STEEL_)
    b.tube((bx, by, z + 0.2), (bx - fx * 0.25, by - fy * 0.25, z + 0.12), 0.02, WHITE, seg=8)


def head(b, grid, wc, wc_face, counter, basin, wall_x, z, wall=None):
    """Bagno completo: grigliato, WC, mobile con lavabo e ante, rubinetto, specchio.
    grid e counter in pixel (px0, px1, py0, py1); basin (pxc, pyc, rx, ry) in pixel e metri;
    wall_x: (px della parete trasversale dietro il lavabo, verso dalla parete al lavabo in x);
    wall: (py0, py1) se quella parete va aggiunta."""
    grating(b, *grid, z)
    marine_wc(b, *wc, z, *wc_face)
    x0, x1 = plan_x(counter[0]), plan_x(counter[1])
    y0, y1 = plan_y(counter[2]), plan_y(counter[3])
    z_top = z + 0.85
    cx, cy = plan_x(basin[0]), plan_y(basin[1])
    basin_counter(b, x0, x1, y0, y1, z, z_top, cx, cy, basin[2], basin[3])
    xw, tx = plan_x(wall_x[0]), wall_x[1]
    # rubinetto fra vasca e parete, bocca verso la vasca
    faucet(b, cx - tx * (basin[2] + 0.045), cy, z_top, (tx, 0))
    # ante bianche con i fori a incasso sul fronte del mobile (lato opposto alla parete)
    xf = x0 if tx < 0 else x1
    ya, yb = sorted((y0, y1))
    for i in range(2):
        yy0 = ya + (yb - ya) * i / 2 + 0.015
        yy1 = ya + (yb - ya) * (i + 1) / 2 - 0.015
        b.box(xf, xf + tx * 0.012, yy0, yy1, z + 0.08, z_top - 0.2, GRP)
        yh = (yy1 - 0.05) if i == 0 else (yy0 + 0.05)
        b.tube((xf + tx * 0.012, yh, z_top - 0.3), (xf + tx * 0.016, yh, z_top - 0.3), 0.017, INSTR, seg=10)
    if wall:
        b.box(xw - 0.011, xw + 0.011, plan_y(wall[0]), plan_y(wall[1]), z, ceiling(xw, plan_y(wall[1])), J_)
    mirror(b, xw + tx * 0.012, ya + 0.04, yb - 0.04, z_top + 0.12, z_top + 0.62, tx)


def door_frames(b):
    """Cornici in teak scuro attorno ai vani porta delle paratie: un listello pieno che abbraccia
    lo spessore della paratia, dritto sugli stipiti e curvo negli angoli alti."""
    for px, door_half, door_y, door_h in ((1432, 0.45, 0.0, 1.9), (1610, 0.32, -0.62, 1.9), (2030, 0.38, 0.0, 1.9),
                                          (2722, 0.35, 0.0, 1.9), (3404, 0.3, 0.0, 1.9)):
        x = plan_x(px)
        z0 = sole_z_at(x + 0.01)
        rc = min(0.24, door_half * 0.9)
        for side in (-1, 1):
            pts = [(door_y + side * door_half, z0)]
            for k in range(0, 8):
                a = math.pi / 2 * k / 7
                pts.append((door_y + side * (door_half - rc + rc * math.cos(a)), z0 + door_h - rc + rc * math.sin(a)))
            pts.append((door_y, z0 + door_h))
            for (ya, za), (yb, zb) in zip(pts, pts[1:]):
                if abs(ya - yb) + abs(za - zb) < 1e-4:
                    continue
                b.beam((x + 0.011, ya + side * 0.018, za), (x + 0.011, yb + side * 0.018, zb), 0.04, 0.05, DARK, up=(1, 0, 0))


def corner_post(b, px, py, z0, z1):
    """Spigolo verticale di un mobile coperto da un listello scuro."""
    x, y = plan_x(px), plan_y(py)
    b.box(x - 0.016, x + 0.016, y - 0.016, y + 0.016, z0, z1, DARK)


def handrail(b, x0, x1, y, drop=0.07, step=0.45):
    """Tientibene in teak scuro sotto il cielino, con i supporti."""
    n = max(2, round((x1 - x0) / step))
    zs = [ceiling(x0 + (x1 - x0) * i / n, y) - drop for i in range(n + 1)]
    for i in range(n):
        xa = x0 + (x1 - x0) * i / n
        xb = x0 + (x1 - x0) * (i + 1) / n
        b.beam((xa, y, zs[i]), (xb, y, zs[i + 1]), 0.032, 0.034, DARK)
    for i in range(n + 1):
        x = x0 + (x1 - x0) * i / n
        b.box(x - 0.025, x + 0.025, y - 0.012, y + 0.012, zs[i] + 0.015, ceiling(x, y) + 0.01, DARK)


def hull_shelf(b, px0, px1, side, z, depth=0.2):
    """Mensola lungo lo scafo con bordino scuro: segue la curva del fianco a tratti."""
    n = max(1, round((plan_x(px1) - plan_x(px0)) / 0.5))
    for i in range(n):
        xa = plan_x(px0) + (plan_x(px1) - plan_x(px0)) * i / n
        xb = plan_x(px0) + (plan_x(px1) - plan_x(px0)) * (i + 1) / n
        yo = hull_half_breadth((xa + xb) / 2, z + 0.03, inset=0.05)
        yi = yo - depth
        b.box(xa, xb, side * yi, side * (yo + 0.05), z, z + 0.022, J_)
        b.box(xa, xb, side * yi, side * (yi + 0.018), z + 0.022, z + 0.07, DARK)


def upper_bunk(b, px0, px1, py_out, py_in, z):
    """Cuccetta alta dei castelli prodieri: piano, materasso e sponda in teak con cappello scuro."""
    b.pbox(px0, px1, py_out, py_in, z, z + 0.04, J_)
    sg = 1 if plan_y(py_in) > plan_y(py_out) else -1
    b.rbox(plan_x(px0) + 0.03, plan_x(px1) - 0.03, plan_y(py_out), plan_y(py_in) - sg * 0.04, z + 0.04, z + 0.15, MATT, r=0.045)
    x0, x1 = plan_x(px0), plan_x(px1)
    y = plan_y(py_in)
    b.box(x0, x1, y, y + sg * 0.022, z - 0.06, z + 0.2, J_)
    b.beam((x0, y + sg * 0.011, z + 0.215), (x1, y + sg * 0.011, z + 0.215), 0.034, 0.03, DARK)


def build_details(col):
    b = Builder()
    b.want = []

    # --- Bagno di poppa (sinistra): WC verso l'interno, lavabo contro la parete della cucina
    z = sole_z_at(plan_x(1700))
    head(b, (1625, 1740, 2052, 2195), (1671, 2000), (0, -1), (1745, 1818, 2050, 2200), (1782, 2125, 0.12, 0.19),
         (1822, -1), z, wall=(1900, 2205))
    # --- Doccia dell'armatoriale (centrale): piatto, grigliato, colonna con doccetta e saponiera
    b.pbox(1616, 1739, 2207, 2357, z, z + 0.06, GRP)
    grating(b, 1622, 1733, 2213, 2351, z + 0.06)
    xs, ys = plan_x(1616) + 0.03, plan_y(2282)
    b.tube((xs, ys, z + 0.75), (xs, ys, z + 1.9), 0.012, STEEL_, seg=8)
    b.box(xs - 0.01, xs + 0.07, ys - 0.06, ys + 0.06, z + 0.98, z + 1.12, STEEL_)
    b.beam((xs + 0.02, ys + 0.05, z + 1.5), (xs + 0.04, ys + 0.05, z + 1.72), 0.04, 0.04, STEEL_)
    b.box(xs, xs + 0.1, ys - 0.25, ys - 0.12, z + 1.0, z + 1.02, STEEL_)

    # --- Bagni prodieri
    z = sole_z_at(plan_x(3250))
    head(b, (3190, 3322, 2155, 2280), (3230, 2109), (0, -1), (3334, 3398, 2150, 2246), (3364, 2198, 0.11, 0.17),
         (3401, -1), z)
    z = sole_z_at(plan_x(2800))
    head(b, (2740, 2858, 2432, 2532), (2804, 2575), (0, 1), (2868, 2944, 2440, 2540), (2905, 2490, 0.12, 0.17),
         (2948, -1), z, wall=(2430, 2700))

    # --- Castelli e armadi delle cabine prodiere
    z = sole_z_at(plan_x(2900))
    upper_bunk(b, 2730, 3080, 1950, 2140, z + 0.92)
    b.pbox(3089, 3184, 1930, 2148, z, ceiling(plan_x(3130), plan_y(2040)), J_)       # armadio sinistro
    doors(b, 3089, 3184, 2148, z, z + 1.6, 2, -1)
    z = sole_z_at(plan_x(3128))
    upper_bunk(b, 2958, 3300, 2628, 2412, z + 0.92)
    b.pbox(3310, 3398, 2400, 2580, z, ceiling(plan_x(3350), plan_y(2490)), J_)       # armadio dritto
    doors(b, 3310, 3398, 2400, z, z + 1.6, 2, 1)

    # --- Cabina a V: gavoni sotto le cuccette (cassetti sul fronte poppiero) e stipetti sul fianco
    z = sole_z_at(plan_x(3550))
    x0 = plan_x(3407)
    for sg in (-1, 1):
        for k in range(2):
            ya, yb = sg * (0.12 + 0.3 * k), sg * (0.12 + 0.3 * k + 0.26)
            b.box(x0 - 0.014, x0, ya, yb, z + 0.04, z + 0.27, J_)
            ym = (ya + yb) / 2
            b.box(x0 - 0.018, x0 - 0.014, ym - 0.05, ym + 0.05, z + 0.21, z + 0.235, INSTR)
        for xa_px, xb_px in ((3430, 3530), (3540, 3640)):
            xa, xb = plan_x(xa_px), plan_x(xb_px)
            yo = hull_half_breadth((xa + xb) / 2, z + 0.75, inset=0.05)
            yi = yo - 0.2
            b.box(xa, xb, sg * yi, sg * (yo + 0.05), z + 0.5, z + 0.78, J_)
            b.box(xa + 0.02, xb - 0.02, sg * (yi - 0.012), sg * yi, z + 0.53, z + 0.75, J_)
            b.box(xa, xb, sg * (yi - 0.014), sg * (yi + 0.004), z + 0.78, z + 0.8, DARK)
            xm = (xa + xb) / 2
            b.tube((xm, sg * (yi - 0.012), z + 0.68), (xm, sg * (yi - 0.04), z + 0.68), 0.012, STEEL_, seg=8)

    # --- Mensole lungo lo scafo sopra le cuccette (armatoriale, ospiti di dritta, castello sinistro)
    z = sole_z_at(plan_x(1300))
    hull_shelf(b, 1160, 1420, 1, z + 0.72)
    hull_shelf(b, 1160, 1420, -1, z + 0.72)
    hull_shelf(b, 1640, 1960, -1, sole_z_at(plan_x(1800)) + 0.75)
    hull_shelf(b, 2740, 3070, 1, sole_z_at(plan_x(2900)) + 1.24, depth=0.16)

    # --- Cornici scure: vani porta, spigoli dei mobili
    door_frames(b)
    z = sole_z_at(plan_x(2000))
    for px, py in ((2275, 2005), (1950, 2135), (2145, 2135), (1950, 2225), (2145, 2225),
                   (2125, 2650), (2215, 2650), (2636, 2430)):
        corner_post(b, px, py, z, z + (0.95 if py != 2650 else 0.82))
    # maniglione d'acciaio davanti al fornello, come nelle cucine Swan
    yb_ = plan_y(2030)
    for px in (2080, 2200):
        b.tube((plan_x(px), plan_y(2015), z + 0.95), (plan_x(px), yb_, z + 1.02), 0.009, STEEL_, seg=6)
    b.tube((plan_x(2080), yb_, z + 1.02), (plan_x(2200), yb_, z + 1.02), 0.012, STEEL_, seg=8)

    # --- Tientibene sul cielino: dinette, corridoio prodiero, scala
    for y in (plan_y(2140), plan_y(2445)):
        handrail(b, plan_x(2300), plan_x(2700), y)
    handrail(b, plan_x(2740), plan_x(3380), plan_y(2357))
    handrail(b, plan_x(2040), plan_x(2280), plan_y(2290))

    return b.finish("Interior_Details", col, clamp=True)


def build_interior_all():
    col = get_collection("Swan651_Interior")
    build_sole(col)
    build_lining(col)
    build_bulkheads(col)
    build_furniture(col)
    build_details(col)
    build_headliner(col)
    build_mast_post(col)
    build_portlight_trims(col)
    for m in MATS:
        m.use_backface_culling = False
    return {"sole_z": SOLE_Z, "objects": [o.name for o in col.objects]}


interior_result = build_interior_all()
print(interior_result)
