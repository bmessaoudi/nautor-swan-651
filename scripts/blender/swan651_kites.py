"""Swan 651: spinnaker simmetrico con tangone e gennaker, esportati in web/public/models/kites.glb.

Script a sé, senza aprire Blender e senza il modello principale:
    SWAN_REPO=<radice del repo> /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \
        --python scripts/blender/swan651_kites.py

Geometria parametrica (niente Cloth: a parità di vertici controlla meglio pancia, spalle e torsione).
Le coordinate si calcolano nel riferimento del web (x a prua, y in alto, z a dritta) e si convertono in
Blender (x, -z, y) solo quando si creano i vertici: l'esportazione glTF le riporta indietro.

Oggetti esportati (ognuno con l'origine nel suo perno, punti notevoli negli extras):
- Spinnaker: perno sull'asse dell'albero all'altezza della penna. Costruito con la bugna a dritta e la
  mura a sinistra, in poppa piena. Shape key Pieno (base), Arricciata, Sventata.
- Gennaker: perno sulla mura, sul musone. Bugna a dritta, al lasco. Stessi shape key.
- SpinnakerPole: tangone d'alluminio lungo +x dall'attacco sull'albero (lunghezza negli extras).
Le cime (braccio, scotta, caricabasso, amantiglio) le disegna il web, perché seguono gli angoli.

Texture tri-radial in colori d'epoca (blu Swan #003660, #157aac, bianco) generate qui, 1024 px.
Il canale alfa è la trasparenza della tela per il controluce del web: 1 un solo strato, meno su
cuciture, nastri e rinforzi.
"""
import math
import os
import tempfile

import bmesh
import bpy
import numpy as np

REPO = os.environ.get("SWAN_REPO", "/Users/bilalmessaoudi/Desktop/coding/nautor-swan")
OUT = REPO + "/web/public/models/kites.glb"
# le PNG servono solo per l'esportazione (finiscono dentro il glb): cartella temporanea, o KITES_TEX
TEX_DIR = os.environ.get("KITES_TEX") or os.path.join(tempfile.gettempdir(), "swan651_kites")

# ---------------------------------------------------------------------------
# Misure (coordinate della barca nel web, metri), dal modello principale
# ---------------------------------------------------------------------------
MAST_X = 1.71            # asse dell'albero
MAST_FRONT_X = 1.89
HEAD_Y = 27.30           # penna: puleggia della drizza in testa d'albero (albero fino a 27,5)
DECK_AT_MAST = 1.82
STEM = (9.94, 2.20)      # attacco dello strallo sul musone

# Spinnaker: 388 m² di superficie di progetto (dato dei testi del sito)
SPI_TACK_Y = 5.5         # mura e bugna all'altezza del tangone, circa 3,7 m sopra la coperta (foto 02)
SPI_HALF_FOOT = 6.95     # mezza base prima dell'inclinazione: tangone di circa 7,4 m, poco meno di J (8,05)
SPI_TILT = math.radians(6.0)   # la vela vola in avanti: mura e bugna davanti all'albero
SPI_ROWS, SPI_COLS = 52, 40       # 2173 vertici

# Gennaker: mura alta sul musone, bugna all'altezza del boma
GEN_TACK = (10.05, 2.70, 0.0)
GEN_CLEW = (-0.70, 3.05, 4.70)   # mezzo metro sopra il boma (2,55)
GEN_ROWS, GEN_COLS = 52, 38       # 2067 vertici
LEECH_FOLLOW = 0.55

NAVY = (0x00, 0x36, 0x60)
BLUE = (0x15, 0x7A, 0xAC)
WHITE = (0xF2, 0xF1, 0xEC)
SKY = (0x8F, 0xC0, 0xDA)


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def to_blender(p):
    return (p[0], -p[2], p[1])


def grid_normals(P):
    """Normali di una griglia (righe v, colonne u) dalle differenze fra vicini."""
    du = np.gradient(P, axis=1)
    dv = np.gradient(P, axis=0)
    n = np.cross(du, dv)
    return n / np.maximum(np.linalg.norm(n, axis=2, keepdims=True), 1e-9)


def surface_area(P):
    a = P[:-1, :-1]
    b = P[:-1, 1:]
    c = P[1:, 1:]
    d = P[1:, :-1]
    t1 = np.linalg.norm(np.cross(b - a, c - a), axis=2)
    t2 = np.linalg.norm(np.cross(c - a, d - a), axis=2)
    return 0.5 * (t1 + t2).sum()


def polyline_len(pts):
    return float(np.linalg.norm(np.diff(pts, axis=0), axis=1).sum())


# ---------------------------------------------------------------------------
# Spinnaker simmetrico
# ---------------------------------------------------------------------------
def spinnaker_grid(depth_k=1.0, width_k=1.0, bow_k=1.0):
    """Griglia (righe dalla base alla penna, colonne dalla mura alla bugna) nel riferimento del perno."""
    R, C = SPI_ROWS, SPI_COLS
    v = np.linspace(0, 1, R + 1)[:, None]
    u = np.linspace(0, 1, C + 1)[None, :]
    drop = HEAD_Y - SPI_TACK_Y
    y = -drop * (1 - v)
    # mezza larghezza: spalle larghe, quasi piena fino al 75%, testa tonda
    v0 = 0.42
    shoulder = np.sqrt(np.clip(1 - (np.clip(v - v0, 0, None) / (1 - v0)) ** 2, 0, 1))
    swell = 1 + 0.05 * np.sin(np.pi * np.clip(v / 0.84, 0, 1))
    hw = SPI_HALF_FOOT * np.maximum(shoulder * swell, 0.012) * width_k
    # profondità della sezione: 27% alla base, 33% a metà, quasi simmetrica
    d = (0.27 + 0.06 * np.sin(np.pi * v)) * depth_k
    theta_max = 2 * np.arctan(2 * d)
    theta = theta_max * (2 * u - 1) * (1 - 0.04 * (u - 0.5))  # un filo più piena verso la bugna
    rad = hw / np.sin(np.maximum(theta_max, 1e-4))
    z = rad * np.sin(theta)
    x_arc = rad * (np.cos(theta) - np.cos(theta_max))
    # bordi che corrono in avanti a metà altezza (la vela si alza e vola davanti alla prua)
    x_edge = 0.25 * v + 4.5 * bow_k * np.sin(np.pi * v) ** 1.2
    x = x_edge + x_arc
    P = np.stack(np.broadcast_arrays(x, y, z), axis=2).astype(float)
    # inclinazione in avanti attorno alla penna
    hx, hy = 0.25, 0.0
    px, py = P[..., 0] - hx, P[..., 1] - hy
    c, s = math.cos(SPI_TILT), math.sin(SPI_TILT)
    P[..., 0] = hx + px * c - py * s
    P[..., 1] = hy + px * s + py * c
    return P, u + 0 * v, v + 0 * u


def curl_key(P, U, V, n_out, hinge=0.2, turn=2.3, v_from=0.14, v_to=0.95):
    """Inferitura che si arriccia: la fascia fra il bordo e una cerniera si arrotola verso l'interno
    della pancia (il lato da cui arriva il vento). Per ogni riga la tela oltre la cerniera si avvolge
    su un cerchio, conservando la lunghezza: al bordo ha girato di turn radianti a metà altezza."""
    out = P.copy()
    R, C = P.shape[0] - 1, P.shape[1] - 1
    jh = int(round(hinge * C))
    for i in range(R + 1):
        span = min(max((V[i, 0] - v_from) / (v_to - v_from), 0.0), 1.0)
        ang = turn * math.sin(math.pi * span) ** 1.2
        if ang < 1e-3:
            continue
        H = P[i, jh]
        t = P[i, jh - 1] - H
        t /= np.linalg.norm(t)
        m = -n_out[i, jh]
        m = m - t * (m @ t)
        m /= np.linalg.norm(m)
        seg = np.linalg.norm(np.diff(P[i, :jh + 1], axis=0), axis=1)
        s_from_h = np.concatenate([np.cumsum(seg[::-1])[::-1], [0.0]])  # distanza lungo la riga dalla cerniera
        rho = s_from_h[0] / ang
        for j in range(jh):
            th = s_from_h[j] / rho
            out[i, j] = H + t * (rho * math.sin(th)) + m * (rho * (1 - math.cos(th)))
    return out


def spinnaker():
    P, U, V = spinnaker_grid()
    n = grid_normals(P)
    # normale verso l'esterno della pancia (in avanti nella vela in poppa)
    if n[SPI_ROWS // 2, SPI_COLS // 2, 0] < 0:
        n = -n
    curl = curl_key(P, U, V, n)
    # sventata: la tela perde la pancia, si stringe e si affloscia in pieghe verticali; il centro cede
    # verso l'interno. Mura e penna restano dove sono
    F, _, _ = spinnaker_grid(depth_k=0.12, width_k=0.62, bow_k=0.25)
    F += (P[0, 0] - F[0, 0]) * (1 - V[..., None]) ** 2
    nf = grid_normals(F)
    if nf[SPI_ROWS // 2, SPI_COLS // 2, 0] < 0:
        nf = -nf
    cave = 2.6 * np.sin(np.pi * U) * np.sin(np.pi * np.clip(V / 0.9, 0, 1)) ** 0.8
    wr = 0.55 * np.sin(2 * np.pi * (3.0 * U + 0.8 * V)) * (1 - 0.5 * V) + 0.25 * np.sin(2 * np.pi * (7 * U - 1.5 * V))
    fix = np.clip(np.hypot(U, V) / 0.12, 0, 1) * np.clip((1 - V) / 0.06, 0, 1)
    F = F + nf * ((wr - cave) * fix)[..., None]
    F[..., 1] -= 2.2 * (1 - V) ** 2 * U ** 0.8  # la bugna senza scotta cade
    F[..., 0] -= 1.2 * (1 - V) ** 2 * U         # e torna verso poppa
    F = P + (F - P) * fix[..., None]
    return P, U, V, {"Arricciata": curl, "Sventata": F}


# ---------------------------------------------------------------------------
# Gennaker
# ---------------------------------------------------------------------------
def rotate_about(vecs, axis, ang):
    """Rodrigues: ruota i vettori (..., 3) attorno all'asse unitario di un angolo (..., )."""
    k = axis / np.linalg.norm(axis)
    c = np.cos(ang)[..., None]
    s = np.sin(ang)[..., None]
    return vecs * c + np.cross(k, vecs) * s + k * (vecs @ k)[..., None] * (1 - c)


def gennaker_grid(depth_k=1.0, twist_k=1.0, width_k=1.0):
    R, C = GEN_ROWS, GEN_COLS
    v = np.linspace(0, 1, R + 1)
    u = np.linspace(0, 1, C + 1)
    T = np.array(GEN_TACK)
    H = np.array([MAST_FRONT_X + 0.07, HEAD_Y, 0.0]) - T
    Cl = np.array(GEN_CLEW) - T
    axis = H / np.linalg.norm(H)
    # inferitura: curva sottovento e in avanti
    bow_dir = np.array([1.0, 0.12, 0.25])
    bow_dir /= np.linalg.norm(bow_dir)
    bow = np.sin(np.pi * v)[:, None] ** 0.9 * 6.1 * bow_dir
    L = v[:, None] * H + bow
    # corde: ogni riga va dall'inferitura alla balumina con la larghezza di progetto (circa 90% della base
    # a metà, 55% ai tre quarti, tavoletta di 30 cm in testa) e l'angolo in pianta della base più la
    # torsione: la balumina si apre salendo. L'altezza della balumina va dalla bugna alla penna
    foot = np.linalg.norm(Cl)
    girth = foot * (1 - v ** 1.3) ** 0.75 * width_k + 0.3 * v
    phi0 = math.atan2(Cl[2], -Cl[0])
    phi = phi0 + math.radians(55) * twist_k * v ** 1.2
    by = (1 - v) * Cl[1] + v * (H[1] - 0.06)
    dy = by - L[:, 1]
    hor = np.sqrt(np.maximum(girth ** 2 - dy ** 2, 1e-6))
    ch = np.stack([-hor * np.cos(phi), dy, hor * np.sin(phi)], axis=1)
    # la balumina segue solo una parte della curva dell'inferitura: resta più corta (inferitura 105-112%)
    # (togliere la curva fa perdere un po' di torsione in pianta: per questo phi arriva a 55° in penna,
    # la torsione misurata fra la base e l'80% dell'altezza resta fra 15 e 25°)
    ch -= LEECH_FOLLOW * bow
    # sezione: profondità 19-24% con il massimo al 40% della corda
    n = np.cross(ch, axis)
    n /= np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-9)
    n *= np.where(n[:, 2:3] < 0, -1, 1)
    p = 0.40
    f = np.where(u < p, (2 * p * u - u * u) / p ** 2, ((1 - 2 * p) + 2 * p * u - u * u) / (1 - p) ** 2)
    d = (0.20 + 0.05 * np.sin(np.pi * v)) * depth_k
    clen = np.linalg.norm(ch, axis=1)
    # la curva di camber f ha area 2/3: la profondità massima vale d volte la corda
    P = L[:, None, :] + u[None, :, None] * ch[:, None, :] + (n * (d * clen)[:, None])[:, None, :] * f[None, :, None]
    UU, VV = np.meshgrid(u, v)
    return P, UU, VV, n


def gennaker():
    P, U, V, nsec = gennaker_grid()
    n = grid_normals(P)
    if n[GEN_ROWS // 2, GEN_COLS // 2, 2] < 0:
        n = -n
    curl = curl_key(P, U, V, n, hinge=0.2, turn=2.0, v_from=0.12, v_to=0.96)
    F, _, _, _ = gennaker_grid(depth_k=0.15, twist_k=1.6, width_k=0.8)
    nf = grid_normals(F)
    w = U ** 0.8
    wr = (0.3 * np.sin(2 * np.pi * (4 * U + 2 * V)) + 0.15 * np.sin(2 * np.pi * (8 * U - 3 * V))) * w * (1 - 0.5 * V)
    F = F + nf * wr[..., None]
    F[..., 1] -= 1.4 * (1 - V) ** 2 * w
    F[..., 0] += 1.6 * (1 - V) ** 2 * w      # la bugna senza scotta torna verso prua
    fix = np.clip((1 - V) / 0.05, 0, 1)        # la penna resta in testa d'albero
    F = P + (F - P) * fix[..., None]
    return P, U, V, {"Arricciata": curl, "Sventata": F}


# ---------------------------------------------------------------------------
# Texture tri-radial
# ---------------------------------------------------------------------------
def line_mask(dist_px, width_px):
    """Linea antialias: 1 sulla linea, 0 lontano. dist_px in pixel."""
    return np.clip(width_px * 0.5 + 0.5 - np.abs(dist_px), 0, 1)


def kite_texture(name, size, layout, width_m, height_m):
    """Disegna i teli in coordinate vela (u corda, v altezza). Restituisce RGBA float in sRGB."""
    N = size
    u = (np.arange(N) + 0.5) / N
    v = (np.arange(N) + 0.5) / N
    U, V = np.meshgrid(u, v)
    pu = 1.0 / N  # un pixel in u
    rgb = np.zeros((N, N, 3))
    alpha = np.ones((N, N))
    col = layout["color"](U, V)
    rgb[:] = col
    seams = np.zeros((N, N))
    faint = np.zeros((N, N))

    # cuciture principali fra le sezioni e fra i ferzi
    for dist in layout["seams"](U, V):
        seams = np.maximum(seams, line_mask(dist / pu, 1.6))
    for dist in layout["faint"](U, V):
        faint = np.maximum(faint, line_mask(dist / pu, 1.0))

    # rinforzi a ventaglio in penna, mura e bugna: tre strati con il bordo smerlato e i raggi cuciti
    patch = np.zeros((N, N))
    patch_seam = np.zeros((N, N))
    for (cu, cv, kind) in layout["corners"]:
        if kind == "head":
            r = (1 - V) * height_m
            phi = U * np.pi
        else:
            du_m = (U - cu) * width_m
            dv_m = (V - cv) * height_m * 0.9
            r = np.hypot(du_m, dv_m)
            phi = np.arctan2(np.abs(dv_m), np.abs(du_m))
        for i, R0 in enumerate((0.9, 1.45, 2.1)):
            Rb = R0 * (1 + 0.07 * np.cos(phi * 14))
            inside = smoothstep(Rb + 0.03, Rb - 0.03, r)
            patch = patch + inside
            edge_px = np.abs(r - Rb) / (height_m / N)
            patch_seam = np.maximum(patch_seam, line_mask(edge_px, 1.4) * (r < Rb + 0.2))
        ray = np.abs(((phi / (np.pi / 2 if kind != "head" else np.pi)) * (9 if kind != "head" else 16)) % 1 - 0.5)
        ray_px = ray * (np.pi / 2 / 9 if kind != "head" else np.pi / 16) * np.maximum(r, 0.05) / (height_m / N)
        patch_seam = np.maximum(patch_seam, line_mask(0.5 * (np.pi / 2 / 9) * np.maximum(r, 0.05) / (height_m / N) - ray_px, 1.0) * (r < 2.1))

    # nastri sui bordi: inferitura, balumina e base
    tape = np.maximum.reduce([
        smoothstep(4.5 * pu, 2.5 * pu, U), smoothstep(1 - 4.5 * pu, 1 - 2.5 * pu, U), smoothstep(3.5 * pu, 1.5 * pu, V),
    ])

    shade = lambda c, k: c * k
    lum = rgb.mean(axis=2, keepdims=True)
    # i rinforzi sono strati di dacron un po' più caldi e opachi
    layer = np.clip(patch, 0, 3)[..., None]
    rgb = rgb * (1 - 0.05 * layer) + np.array([0.86, 0.84, 0.78]) * 0.04 * layer
    rgb = rgb * (1 - 0.22 * seams[..., None]) * (1 - 0.08 * faint[..., None]) * (1 - 0.18 * patch_seam[..., None])
    tape_col = np.where(lum > 0.5, 0.80, 0.55)
    rgb = rgb * (1 - tape[..., None]) + shade(rgb, tape_col) * tape[..., None]
    alpha = alpha * (1 - 0.42 * seams) * (1 - 0.18 * faint) * (0.72 ** np.clip(patch, 0, 3)) * (1 - 0.3 * patch_seam)
    alpha = alpha * (1 - 0.62 * tape)
    img = np.concatenate([np.clip(rgb, 0, 1), np.clip(alpha, 0, 1)[..., None]], axis=2)

    os.makedirs(TEX_DIR, exist_ok=True)
    path = f"{TEX_DIR}/{name}.png"
    im = bpy.data.images.new(name, N, N, alpha=True)
    im.pixels = img.astype(np.float32).ravel()
    im.filepath_raw = path
    im.file_format = "PNG"
    im.save()
    im.reload()
    return im


def c3(rgb):
    return np.array(rgb, float) / 255.0


def spi_layout():
    # tri-radial: ferzi radiali dalla penna in alto, teli orizzontali al centro, radiali da mura e bugna
    top, low = 0.60, 0.30
    gores = 14

    def color(U, V):
        out = np.empty(U.shape + (3,))
        g = np.minimum((U * gores).astype(int), gores - 1)
        gm = np.minimum(g, gores - 1 - g)  # simmetrico
        head_cols = np.array([c3(NAVY), c3(WHITE), c3(BLUE), c3(WHITE), c3(BLUE), c3(WHITE), c3(NAVY)])
        out[:] = head_cols[gm % len(head_cols)]
        # fascia centrale: bianco, blu Swan, navy
        mid = (V >= low) & (V < top)
        band = np.select([V < 0.36, V < 0.47, V < 0.53], [0, 1, 2], 3)
        mid_cols = np.array([c3(WHITE), c3(NAVY), c3(BLUE), c3(WHITE)])
        out[mid] = mid_cols[band[mid]]
        # in basso: radiali da mura e bugna, bianchi con un ferzo azzurro ogni tre
        lowm = V < low
        cu = np.where(U < 0.5, U, 1 - U)
        ang = np.arctan2(V * 1.5, cu)
        k = np.minimum((ang / (np.pi / 2) * 7).astype(int), 6)
        low_cols = np.array([c3(WHITE), c3(SKY), c3(WHITE), c3(WHITE), c3(SKY), c3(WHITE), c3(WHITE)])
        out[lowm] = low_cols[k[lowm]]
        return out

    def seams(U, V):
        d = [np.where(V > 0.60, np.abs(((U * gores) % 1) - 0.5) * 0 + np.minimum((U * gores) % 1, 1 - (U * gores) % 1) / gores, 9)]
        d.append(np.abs(V - top) + 0 * U)
        d.append(np.abs(V - low) + 0 * U)
        for b in (0.36, 0.47, 0.53):
            d.append(np.where((V > low) & (V < top), np.abs(V - b), 9))
        cu = np.where(U < 0.5, U, 1 - U)
        ang = np.arctan2(V * 1.5, cu) / (np.pi / 2) * 7
        r = np.hypot(cu, V * 1.5)
        d.append(np.where(V < low, np.minimum(ang % 1, 1 - ang % 1) * (np.pi / 2 / 7) * r, 9))
        d.append(np.where(V < low, np.abs(U - 0.5), 9))
        return d

    def faint(U, V):
        # teli da circa un metro: orizzontali nei ferzi, verticali al centro
        return [np.where(V > top, np.minimum((V * 26) % 1, 1 - (V * 26) % 1) / 26, 9) * 0.6,
                np.where((V > low) & (V < top), np.minimum((U * 16) % 1, 1 - (U * 16) % 1) / 16, 9),
                np.where(V < low, np.minimum((np.hypot(np.where(U < 0.5, U, 1 - U), V * 1.5) * 18) % 1, 1 - (np.hypot(np.where(U < 0.5, U, 1 - U), V * 1.5) * 18) % 1) / 18, 9)]

    return {"color": color, "seams": seams, "faint": faint, "corners": [(0.5, 1.0, "head"), (0.0, 0.0, "c"), (1.0, 0.0, "c")]}


def gen_layout():
    # radial head: ferzi dalla penna sopra il 55%, teli orizzontali sotto, una fascia blu e navy in
    # diagonale dalla mura verso la bugna (il disegno "a vela di gara" degli anni Ottanta)
    top = 0.55
    gores = 12

    def diag(U, V):
        return V - (0.42 - 0.30 * U)

    def color(U, V):
        out = np.empty(U.shape + (3,))
        out[:] = c3(WHITE)
        dd = diag(U, V)
        out[(dd > -0.10) & (dd < -0.04)] = c3(NAVY)
        out[(dd >= -0.04) & (dd < 0.03)] = c3(BLUE)
        out[(dd >= 0.03) & (dd < 0.05)] = c3(SKY)
        g = np.minimum((U * gores).astype(int), gores - 1)
        hm = (V > top) & (g % 4 == 1)
        out[hm] = c3(SKY)
        return out

    def seams(U, V):
        d = [np.where(V > top, np.minimum((U * gores) % 1, 1 - (U * gores) % 1) / gores, 9), np.abs(V - top) + 0 * U]
        dd = diag(U, V)
        for b in (-0.10, -0.04, 0.03, 0.05):
            d.append(np.abs(dd - b) * 0.95)
        return d

    def faint(U, V):
        return [np.where(V < top, np.minimum((V * 24) % 1, 1 - (V * 24) % 1) / 24, 9) * 0.7,
                np.where(V > top, np.minimum((V * 26) % 1, 1 - (V * 26) % 1) / 26, 9) * 0.6]

    return {"color": color, "seams": seams, "faint": faint, "corners": [(0.5, 1.0, "head"), (0.0, 0.0, "c"), (1.0, 0.0, "c")]}


# ---------------------------------------------------------------------------
# Mesh, shape key, materiali
# ---------------------------------------------------------------------------
def kite_material(name, image):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = image
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.62
    return mat


def grid_object(name, P, U, V, keys, mat, origin, extras):
    R, C = P.shape[0] - 1, P.shape[1] - 1
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    verts = [[bm.verts.new(to_blender(P[i, j])) for j in range(C + 1)] for i in range(R + 1)]
    bm.verts.index_update()  # i vertici nuovi hanno indice -1 finché non si aggiorna
    bm.verts.ensure_lookup_table()
    uvl = bm.loops.layers.uv.new("UVMap")
    for i in range(R):
        for j in range(C):
            f = bm.faces.new((verts[i][j], verts[i][j + 1], verts[i + 1][j + 1], verts[i + 1][j]))
            f.smooth = True
            for loop in f.loops:
                vi = loop.vert.index
                ii, jj = divmod(vi, C + 1)
                loop[uvl].uv = (U[ii, jj], V[ii, jj])
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    obj.location = to_blender(origin)
    me.materials.append(mat)
    # shape key: Pieno è la base
    obj.shape_key_add(name="Pieno", from_mix=False)
    for kname, K in keys.items():
        sk = obj.shape_key_add(name=kname, from_mix=False)
        flat = K.reshape(-1, 3)
        for idx, p in enumerate(flat):
            sk.data[idx].co = to_blender(p)
    for k, val in extras.items():
        obj[k] = [round(float(x), 4) for x in val]
    return obj


def pole_object(length):
    """Tangone: tubo rastremato verso le estremità con le due campane di testa, lungo +x."""
    me = bpy.data.meshes.new("SpinnakerPole")
    bm = bmesh.new()
    seg = 10
    stations = [(0.0, 0.050), (0.02, 0.062), (0.32, 0.062), (0.34, 0.056), (0.6, 0.064),
                (length / 2, 0.072), (length - 0.6, 0.064), (length - 0.34, 0.056), (length - 0.32, 0.062),
                (length - 0.02, 0.062), (length, 0.050)]
    rings = []
    for x, r in stations:
        ring = [bm.verts.new(to_blender((x, r * math.cos(2 * math.pi * k / seg), r * math.sin(2 * math.pi * k / seg)))) for k in range(seg)]
        rings.append(ring)
    for a, b in zip(rings[:-1], rings[1:]):
        for k in range(seg):
            f = bm.faces.new((a[k], a[(k + 1) % seg], b[(k + 1) % seg], b[k]))
            f.smooth = True
    for ring, rev in ((rings[0], True), (rings[-1], False)):
        bm.faces.new(list(reversed(ring)) if rev else ring)
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new("SpinnakerPole", me)
    bpy.context.scene.collection.objects.link(obj)
    mat = bpy.data.materials.new("Pole_Aluminium")
    mat.use_nodes = True
    bsdf = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = (0.80, 0.81, 0.82, 1.0)
    bsdf.inputs["Metallic"].default_value = 0.9
    bsdf.inputs["Roughness"].default_value = 0.32
    me.materials.append(mat)
    obj["length"] = length
    return obj


def twist_deg(P):
    """Torsione: angolo in pianta della corda in testa (80%) meno quello alla base."""
    def ang(i):
        c = P[i, -1] - P[i, 0]
        return math.degrees(math.atan2(c[2], -c[0]))
    return ang(int(P.shape[0] * 0.8)) - ang(0)


def depth_info(P, i):
    """Profondità massima della sezione i rispetto alla corda e sua posizione lungo la corda."""
    a, b = P[i, 0], P[i, -1]
    c = b - a
    L = np.linalg.norm(c)
    rel = P[i] - a
    t = rel @ c / L
    dist = np.linalg.norm(rel - np.outer(t / L, c), axis=1)
    j = int(np.argmax(dist))
    return dist[j] / L, t[j] / L


def report(name, P):
    luff = polyline_len(P[:, 0])
    leech = polyline_len(P[:, -1])
    foot = polyline_len(P[0, :])
    mid = polyline_len(P[P.shape[0] // 2, :])
    r75 = polyline_len(P[int(P.shape[0] * 0.75), :])
    print(f"{name}: area {surface_area(P):.0f} m2, inferitura {luff:.2f} m, balumina {leech:.2f} m, "
          f"base {foot:.2f} m, larghezza a metà {mid:.2f} m, al 75% {r75:.2f} m, rapporto inf/bal {luff / leech:.3f}")
    rows = P.shape[0] - 1
    secs = ", ".join(f"{int(100 * f)}%: {100 * d:.0f}% a {100 * x:.0f}%" for f in (0.25, 0.5, 0.75)
                     for d, x in [depth_info(P, int(rows * f))])
    print(f"{name}: torsione {twist_deg(P):.1f} gradi, profondità {secs}, vertici {P.shape[0] * P.shape[1]}")


def main():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)

    # spinnaker
    P, U, V, keys = spinnaker()
    report("Spinnaker", P)
    width_m = polyline_len(P[SPI_ROWS // 2, :])
    height_m = polyline_len(P[:, SPI_COLS // 2])
    spi_img = kite_texture("kite_spinnaker", 1024, spi_layout(), width_m, height_m)
    spi = grid_object("Spinnaker", P, U, V, keys, kite_material("Kite_Spinnaker", spi_img),
                      (MAST_X, HEAD_Y, 0.0), {"tack": P[0, 0], "clew": P[0, -1], "head": P[-1, SPI_COLS // 2]})
    tack = P[0, 0]
    pole_len = math.hypot(tack[0], tack[2])
    print(f"Tangone {pole_len:.2f} m, mura a {HEAD_Y + tack[1]:.2f} m")

    # gennaker
    G, GU, GV, gkeys = gennaker()
    report("Gennaker", G)
    gw = polyline_len(G[GEN_ROWS // 2, :])
    gh = polyline_len(G[:, GEN_COLS // 2])
    gen_img = kite_texture("kite_gennaker", 1024, gen_layout(), gw, gh)
    gen = grid_object("Gennaker", G, GU, GV, gkeys, kite_material("Kite_Gennaker", gen_img),
                      GEN_TACK, {"tack": G[0, 0], "clew": G[0, -1], "head": G[-1, 0]})

    pole = pole_object(round(pole_len, 3))

    bpy.ops.object.select_all(action="DESELECT")
    for o in (spi, gen, pole):
        o.select_set(True)
    bpy.context.view_layer.objects.active = spi
    bpy.ops.export_scene.gltf(
        filepath=OUT,
        export_format="GLB",
        use_selection=True,
        export_apply=False,
        export_morph=True,
        export_morph_normal=True,
        export_extras=True,
        export_image_format="AUTO",
    )
    print("KITES_OK", OUT, os.path.getsize(OUT))


main()
