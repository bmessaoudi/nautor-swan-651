"""Swan 651: interni ricostruiti dalla pianta della tavola Nautor (scafo 651-002).

Va eseguito dopo swan651_hull.py nello stesso namespace (riusa scala, sezioni, materiali).
Tutte le posizioni sono in pixel dell'immagine originale della tavola (4960x3507),
convertite con la scala della pianta: X = (px - 444) * SP, Y = (2292 - py) * SP.

Layout (da poppa a prua): gavoni, generatore e cabina armatoriale di poppa con due cuccette,
bagno di poppa e doccia, sala macchine sotto il pozzetto, scala principale, cucina a sinistra,
cabina ospiti e carteggio a dritta, dinette con tavolo a U, albero, due cabine e due bagni
prodieri, cabina di prua a V, gavone delle vele.
"""
import math

import bmesh
import bpy


def plan_x(px):
    return (px - PLAN_STERN) * SP - STERN_CUT


def plan_y(py):
    return (PLAN_CL - py) * SP


SOLE_Z = -0.30            # pagliolo della dinette (sotto il galleggiamento)

# Dalle foto degli scafi standard (Show Me, Aurora, 651-001): teak color miele satinato,
# pagliolo teak e holly, cielo in vinile bianco con listelli. Tessuti: pelle rossa (scelta del cliente).
MAT_JOINERY = material("Interior_Teak_Honey", (0.46, 0.22, 0.08), 0.38)
MAT_SOLE = textured_material("Interior_Sole_TeakHolly", "teak_holly_sole.png", 0.3)
MAT_UPHOLSTERY = material("Upholstery_Leather_Red", (0.36, 0.025, 0.03), 0.42)
MAT_MATTRESS = material("Mattress_Cream", (0.85, 0.8, 0.7), 0.9)
MAT_HEADLINER = material("Headliner_White_Vinyl", (0.88, 0.87, 0.83), 0.55)
MAT_WHITE = material("Interior_White", (0.9, 0.9, 0.88), 0.3)
MAT_ENGINE = material("Engine_Grey", (0.25, 0.3, 0.33), 0.5, metallic=0.3)
MAT_COUNTER = material("Galley_Counter", (0.82, 0.8, 0.74), 0.25)
MAT_STEEL_IN = material("Stainless", (0.85, 0.86, 0.88), 0.12, metallic=1.0)

MATS = [MAT_JOINERY, MAT_SOLE, MAT_UPHOLSTERY, MAT_MATTRESS, MAT_WHITE, MAT_ENGINE,
        MAT_COUNTER, MAT_STEEL_IN, MAT_HEADLINER]
J_, SOLE_, UPH, MATT, WHITE, ENG, CNT, STEEL_, HEAD = range(9)


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

    def finish(self, name, col, clamp=True):
        bm = self.bm
        if clamp:
            clamp_to_hull(bm)
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
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
    return b.finish("Interior_Sole", col)


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
            pts.append((x, door_y, z0 + door_h))
            pts.append((x, door_y + side * door_half, z0 + door_h))
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
    return b.finish("Interior_Bulkheads", col)


# ---------------------------------------------------------------------------
# Arredi
# ---------------------------------------------------------------------------
def berth(b, px0, px1, py0, py1, h=0.45):
    x0, x1 = plan_x(px0), plan_x(px1)
    z0 = sole_z_at((x0 + x1) / 2)
    b.pbox(px0, px1, py0, py1, z0, z0 + h - 0.14, J_)
    b.pbox(px0 + 8, px1 - 8, py0 + 8, py1 - 8, z0 + h - 0.14, z0 + h, MATT)


def settee(b, px0, px1, py0, py1, back_side):
    """Divano: seduta, cuscino e schienale verso back_side ('out' = verso lo scafo)."""
    x0 = plan_x(px0)
    z0 = sole_z_at(x0)
    b.pbox(px0, px1, py0, py1, z0, z0 + 0.3, J_)
    b.pbox(px0, px1, py0, py1, z0 + 0.3, z0 + 0.44, UPH)
    yy0, yy1 = plan_y(py0), plan_y(py1)
    outward = yy0 if abs(yy0) > abs(yy1) else yy1
    t = 0.12 if outward > 0 else -0.12
    b.box(plan_x(px0), plan_x(px1), outward, outward - t, z0 + 0.44, z0 + 0.9, UPH)


def build_furniture(col):
    b = Builder()
    # --- Poppa: generatore, cuccette armatoriali, scaletta di poppa
    z = sole_z_at(plan_x(1150))
    b.pbox(1093, 1193, 2223, 2412, z, z + 0.65, ENG)                     # generatore
    berth(b, 1148, 1432, 1960, 2203)                                    # cuccetta sinistra
    berth(b, 1148, 1432, 2435, 2628)                                    # cuccetta dritta
    b.pbox(1435, 1605, 2012, 2090, z, z + 1.85, J_)                     # armadio
    b.cyl(plan_x(1492), plan_y(2142), z, z + 0.45, 0.17, UPH)           # sgabello toilette
    b.pbox(1435, 1605, 1960, 2010, z + 0.7, z + 0.78, J_)               # mensola toilette
    # scaletta di poppa (dal pozzetto)
    zt = cockpit_floor(plan_x(1340))
    for i in range(5):
        x = plan_x(1300) + i * 0.1
        zz = z + (zt - z) * (i + 1) / 6
        b.box(x, x + 0.07, plan_y(2250), plan_y(2335), zz - 0.03, zz, J_)

    # --- Bagno di poppa (sinistra) e doccia centrale
    z = sole_z_at(plan_x(1700))
    b.pbox(1745, 1820, 2050, 2200, z, z + 0.85, J_)                     # mobile lavabo
    b.cyl(plan_x(1782), plan_y(2125), z + 0.85, z + 0.88, 0.14, WHITE)  # lavabo
    b.cyl(plan_x(1670), plan_y(2005), z, z + 0.42, 0.18, WHITE)         # wc
    b.pbox(1620, 1745, 2050, 2200, z, z + 0.05, WHITE)                  # piatto doccia
    b.pbox(1615, 1745, 2207, 2357, z, z + 0.05, WHITE)                  # doccia centrale

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

    # --- Cabina ospiti di dritta e carteggio
    berth(b, 1620, 1975, 2560, 2740)
    b.pbox(2125, 2215, 2520, 2650, z, z + 0.78, J_)                     # tavolo da carteggio
    b.pbox(2125, 2215, 2520, 2650, z + 0.78, z + 0.82, CNT)
    b.pbox(2035, 2115, 2540, 2630, z, z + 0.45, UPH)                    # seduta
    b.pbox(2215, 2275, 2500, 2700, z + 0.8, z + 1.5, J_)                # pannello strumenti

    # --- Dinette: U a sinistra con tavolo, divano lineare a dritta, credenze
    z = sole_z_at(plan_x(2500))
    settee(b, 2306, 2692, 1968, 2075, "out")                            # schienale U (lato esterno)
    settee(b, 2306, 2412, 2075, 2257, "out")                            # braccio poppiero
    settee(b, 2590, 2692, 2075, 2257, "out")                            # braccio prodiero
    b.pbox(2425, 2580, 2085, 2245, z, z + 0.68, J_)                     # piede tavolo
    b.pbox(2412, 2590, 2072, 2247, z + 0.68, z + 0.74, J_)              # piano tavolo
    b.pbox(2458, 2552, 2260, 2310, z, z + 0.45, UPH)                    # pouf
    settee(b, 2275, 2636, 2546, 2633, "out")                            # divano di dritta
    b.pbox(2275, 2722, 1830, 1942, z + 0.9, z + 1.25, J_)               # credenza alta sinistra
    b.pbox(2275, 2636, 2633, 2690, z + 0.9, z + 1.25, J_)               # credenza alta dritta
    b.pbox(2636, 2727, 2430, 2572, z, z + 0.95, J_)                     # mobile a dritta

    # --- Cabine prodiere
    berth(b, 2722, 3087, 1942, 2145)                                    # cuccetta sinistra
    berth(b, 2950, 3306, 2409, 2633)                                    # cuccetta dritta
    z = sole_z_at(plan_x(3250))
    b.pbox(3334, 3392, 2150, 2245, z, z + 0.85, J_)                     # bagno sinistro
    b.cyl(plan_x(3220), plan_y(2100), z, z + 0.42, 0.17, WHITE)
    b.pbox(3184, 3326, 2160, 2282, z, z + 0.05, WHITE)
    z = sole_z_at(plan_x(2800))
    b.pbox(2860, 2930, 2440, 2540, z, z + 0.85, J_)                     # bagno dritto
    b.cyl(plan_x(2805), plan_y(2585), z, z + 0.42, 0.17, WHITE)
    b.pbox(2735, 2860, 2430, 2540, z, z + 0.05, WHITE)

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
                b.poly([a[side][j], c[side][j], c[side][j + 1], a[side][j + 1]], MATT)
    return b.finish("Interior_Lining", col, clamp=False)


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
    return b.finish("Interior_Headliner", col, clamp=False)


def build_mast_post(col):
    """L'albero passante, rivestito in teak nella dinette (dettaglio ricorrente nelle foto)."""
    b = Builder()
    z0 = sole_z_at(MAST_X)
    b.cyl(MAST_X, 0.0, z0, ceiling(MAST_X, 0.0), 0.2, J_, seg=24)
    return b.finish("Interior_MastPost", col, clamp=False)


def build_interior_all():
    col = get_collection("Swan651_Interior")
    build_sole(col)
    build_lining(col)
    build_bulkheads(col)
    build_furniture(col)
    build_headliner(col)
    build_mast_post(col)
    for m in MATS:
        m.use_backface_culling = False
    return {"sole_z": SOLE_Z, "objects": [o.name for o in col.objects]}


interior_result = build_interior_all()
print(interior_result)
