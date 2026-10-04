# /// script
# requires-python = ">=3.10"
# dependencies = ["numpy", "pillow"]
# ///
"""Texture procedurali di randa e genoa in dacron cross-cut.

Legge la geometria piana delle vele da sails_layout.json (scritto da build_sails in
scripts/blender/swan651_rig.py a ogni rigenerazione del modello) e scrive in
web/public/textures/sails/:

- sails_albedo.png   atlante 1024x1024, randa a sinistra e genoa a destra (u corda, v quota):
                     ferzi orizzontali perpendicolari alla balumina con le cuciture, rinforzi a
                     ventaglio su testa, mura e bugna, nastri su inferitura, base e balumina,
                     tasche delle stecche e terzaroli sulla randa, segnavento sul genoa
- sails_normal.png   stesso atlante: normal map (rgb) dei rilievi di cuciture, rinforzi e
                     nastri; nell'alfa gli strati di tessuto (1 strato = 0,25), che lo shader
                     usa per il controluce (più strati, meno luce passa)
- sails_weave.png    512x512 ripetibile: trama del tessuto e grinze leggere (normal map)

Uso, dalla radice del repo:
    uv run scripts/sails/make_sail_textures.py
"""
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
LAYOUT = ROOT / "scripts" / "sails" / "sails_layout.json"
OUT = ROOT / "web" / "public" / "textures" / "sails"

SIZE = 1024
SS = 2                      # sovracampionamento per l'antialiasing
N = SIZE * SS
PANEL = 0.92                # larghezza dei ferzi (tessuto da 36 pollici meno la sovrapposizione)
SEAM = 0.022                # sovrapposizione della cucitura in metri

DACRON = np.array([0.925, 0.92, 0.895])      # bianco caldo del dacron, lineare
rng = np.random.default_rng(651)


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def band(d, half, aa):
    """1 dentro |d| < half, bordo morbido largo aa (in metri)."""
    return 1.0 - smoothstep(half - aa, half + aa, np.abs(d))


class Sail:
    def __init__(self, name, spec):
        self.name = name
        self.u0, self.u1 = spec["uv"]
        rows = spec["rows"]
        self.f = np.array([r["f"] for r in rows])
        self.lp = np.array([r["lp"] for r in rows])
        self.d = np.array([r["d"] for r in rows])
        self.w = np.array([r["w"] for r in rows])
        ends = self.lp + self.d * self.w[:, None]
        self.tack = self.lp[0]
        self.head = self.lp[-1]
        self.clew = ends[int(np.argmax(self.w))]
        self.leech = ends[int(np.argmax(self.w)):]          # dalla bugna alla testa

    def flat(self, c, f):
        """Atlante (corda c, quota f) -> punto piano in metri."""
        lpx = np.interp(f, self.f, self.lp[:, 0])
        lpz = np.interp(f, self.f, self.lp[:, 1])
        dx = np.interp(f, self.f, self.d[:, 0])
        dz = np.interp(f, self.f, self.d[:, 1])
        w = np.interp(f, self.f, self.w)
        return lpx + dx * w * c, lpz + dz * w * c, w

    def leech_point(self, t):
        """Punto della balumina a frazione t della sua lunghezza e normale verso l'interno."""
        seg = np.diff(self.leech, axis=0)
        ln = np.hypot(seg[:, 0], seg[:, 1])
        cum = np.concatenate([[0], np.cumsum(ln)])
        s = t * cum[-1]
        i = min(int(np.searchsorted(cum, s)) - 1, len(seg) - 1)
        i = max(i, 0)
        p = self.leech[i] + seg[i] * (s - cum[i]) / ln[i]
        tdir = seg[i] / ln[i]
        nrm = np.array([-tdir[1], tdir[0]])
        # verso l'interno: dalla parte dell'inferitura
        if np.dot(nrm, self.tack - p) < 0:
            nrm = -nrm
        return p, nrm, tdir


def fan(px, pz, corner, radii, aim, rays=9, spread=1.2):
    """Rinforzo a ventaglio: strati concentrici attorno all'angolo con cuciture radiali.
    aim: direzione verso l'interno della vela. Restituisce (strati, cuciture)."""
    dx, dz = px - corner[0], pz - corner[1]
    r = np.hypot(dx, dz)
    ang = np.arctan2(dz, dx) - math.atan2(aim[1], aim[0])
    ang = (ang + np.pi) % (2 * np.pi) - np.pi
    # bordo a festoni: ogni ferzo radiale finisce con un arco
    scallop = 1.0 + 0.012 * np.cos(ang * rays * 2.0 / spread)
    layers = np.zeros_like(r)
    edge = np.zeros_like(r)
    for rr in radii:
        rad = rr * scallop
        layers += 1.0 - smoothstep(rad - 0.012, rad + 0.012, r)
        edge = np.maximum(edge, band(r - rad, 0.004, 0.008) * 0.7)
    inside = 1.0 - smoothstep(radii[-1] * 0.98, radii[-1] * 1.02, r)
    # cuciture radiali del ventaglio
    step = spread / rays
    k = r * np.abs(np.sin(ang - np.round(ang / step) * step))
    radial = band(k, 0.005, 0.006) * inside * smoothstep(0.05, 0.15, r) * (np.abs(ang) < spread)
    return layers, np.maximum(edge * (layers > 0.01), radial)


def paint(sail, img_c, img_f, cols):
    """Disegna una vela nelle colonne cols dell'atlante."""
    u = (cols + 0.5) / N
    v = 1.0 - (np.arange(N) + 0.5) / N          # riga 0 = testa (v = 1)
    U, V = np.meshgrid(u, v)
    c = np.clip((U - sail.u0) / (sail.u1 - sail.u0), 0.0, 1.0)
    f = np.clip(V, 0.0, 1.0)
    px, pz, w = sail.flat(c, f)
    aa = 0.012                                    # metà pixel circa, in metri
    is_main = sail.name == "Mainsail"

    layers = np.ones_like(px)
    seam = np.zeros_like(px)
    tone = np.zeros_like(px)

    # --- Ferzi cross-cut: perpendicolari alla balumina, contati dalla bugna ---
    ldir = sail.head - sail.clew
    ldir = ldir / np.linalg.norm(ldir)
    s = (px - sail.clew[0]) * ldir[0] + (pz - sail.clew[1]) * ldir[1]
    along = (px - sail.clew[0]) * ldir[1] - (pz - sail.clew[1]) * ldir[0]      # lungo le cuciture
    k = s / PANEL
    panel_id = np.floor(k)
    dseam = (k - np.round(k)) * PANEL
    over = band(dseam, SEAM / 2, aa * 0.6)
    layers += over
    seam = np.maximum(seam, band(dseam - SEAM / 2, 0.004, aa * 0.5) * 0.8)    # file di punti
    seam = np.maximum(seam, band(dseam + SEAM / 2, 0.004, aa * 0.5) * 0.8)
    # ogni pezza di tessuto ha un tono appena diverso
    tint = rng.normal(0, 0.012, 200)
    tone += tint[(panel_id.astype(int) + 100) % 200]

    # --- Distanze dai bordi ---
    d_luff = c * w
    d_leech = (1.0 - c) * w
    fd = sail.clew - sail.tack
    fd = fd / np.linalg.norm(fd)
    d_foot = np.abs((px - sail.tack[0]) * fd[1] - (pz - sail.tack[1]) * fd[0])

    # --- Nastri: inferitura (gratile), balumina e base ---
    luff_tape = band(d_luff, 0.055 if is_main else 0.07, aa)
    leech_tape = band(d_leech, 0.035, aa)
    foot_tape = band(d_foot, 0.05, aa)
    layers += luff_tape + leech_tape + foot_tape
    seam = np.maximum(seam, band(d_luff - (0.055 if is_main else 0.07), 0.004, aa * 0.5) * 0.7)
    seam = np.maximum(seam, band(d_leech - 0.035, 0.004, aa * 0.5) * 0.6)
    tone -= luff_tape * 0.05

    # --- Rinforzi a ventaglio agli angoli ---
    def inward(p):
        cen = (sail.tack + sail.clew + sail.head) / 3.0
        a = cen - p
        return a / np.linalg.norm(a)

    if is_main:
        corners = [(sail.head, [0.3, 0.6, 0.95, 1.35]), (sail.tack, [0.35, 0.7, 1.1, 1.5]),
                   (sail.clew, [0.4, 0.85, 1.35, 1.85])]
    else:
        corners = [(sail.head, [0.3, 0.65, 1.0, 1.35]), (sail.tack, [0.4, 0.8, 1.25, 1.7]),
                   (sail.clew, [0.45, 0.9, 1.45, 2.0])]
    for p, radii in corners:
        l, e = fan(px, pz, p, radii, inward(p))
        layers += l
        seam = np.maximum(seam, e)
        tone += np.minimum(l, 1.0) * 0.01

    # anelli d'acciaio (brancarelle) negli angoli
    grommet = np.zeros_like(px)
    for p, off in ((sail.tack, 0.12), (sail.clew, 0.13), (sail.head, 0.12)):
        q = p + inward(p) * off
        r = np.hypot(px - q[0], pz - q[1])
        grommet = np.maximum(grommet, band(r - 0.035, 0.012, 0.006))

    battens = np.zeros_like(px)
    pockets = np.zeros_like(px)
    dots = np.zeros_like(px)
    if is_main:
        # Tavoletta di testa in alluminio
        hb = sail.head
        r = np.hypot(px - hb[0], pz - hb[1])
        headboard = (1.0 - smoothstep(0.26, 0.28, r)) * (d_leech > 0.0)
        # Stecche: corte, perpendicolari alla balumina, a un quarto, metà e tre quarti più una in alto
        for t, length in ((0.2, 1.05), (0.4, 1.3), (0.6, 1.3), (0.8, 1.05)):
            p0, nrm, tdir = sail.leech_point(t)
            ax = (px - p0[0]) * nrm[0] + (pz - p0[1]) * nrm[1]           # lungo la stecca
            ac = (px - p0[0]) * tdir[0] + (pz - p0[1]) * tdir[1]         # trasversale
            inlen = (1.0 - smoothstep(length - 0.02, length + 0.02, ax)) * smoothstep(-0.05, 0.0, ax)
            pocket = band(ac, 0.045, aa) * inlen
            stick = band(ac, 0.016, aa) * (1.0 - smoothstep(length - 0.07, length - 0.04, ax)) * smoothstep(-0.05, 0.0, ax)
            # pezza di rinforzo all'imboccatura della tasca, sulla balumina
            endp = band(ac, 0.09, aa) * (1.0 - smoothstep(0.2, 0.22, ax)) * smoothstep(-0.05, 0.0, ax)
            pockets = np.maximum(pockets, pocket)
            battens = np.maximum(battens, stick)
            layers += pocket + endp * 0.8
            seam = np.maximum(seam, band(np.abs(ac) - 0.045, 0.004, aa * 0.5) * inlen * 0.8)
            seam = np.maximum(seam, band(np.abs(ac) - 0.09, 0.004, aa * 0.5) * (ax < 0.22) * (ax > -0.05) * 0.6)
        # Due mani di terzaroli: rinforzi su inferitura e balumina, fila di borosi in mezzo
        for hgt in (2.6, 5.2):
            fr = hgt / (sail.head[1] - sail.tack[1])
            pl = np.array([np.interp(fr, sail.f, sail.lp[:, 0]), np.interp(fr, sail.f, sail.lp[:, 1])])
            wl = np.interp(fr, sail.f, sail.w)
            pe = pl + np.array([np.interp(fr, sail.f, sail.d[:, 0]), np.interp(fr, sail.f, sail.d[:, 1])]) * wl
            l, e = fan(px, pz, pl, [0.25, 0.5, 0.8], np.array([-1.0, 0.0]), rays=6)
            layers += l
            seam = np.maximum(seam, e)
            l, e = fan(px, pz, pe, [0.3, 0.6, 0.95], np.array([1.0, 0.0]), rays=6)
            layers += l
            seam = np.maximum(seam, e)
            # borosi ogni 0,9 m: pezzetta tonda con l'occhiello scuro al centro
            for x in np.arange(0.9, wl - 0.6, 0.9):
                q = pl + (pe - pl) * (x / wl)
                r = np.hypot(px - q[0], pz - q[1])
                layers += band(r, 0.07, aa)
                dots = np.maximum(dots, band(r, 0.018, 0.008))
    else:
        headboard = np.zeros_like(px)
        # Segnavento sull'inferitura: tre coppie di bollini rossi e verdi con il filo di lana
        for fr in (0.3, 0.5, 0.72):
            pl = np.array([np.interp(fr, sail.f, sail.lp[:, 0]), np.interp(fr, sail.f, sail.lp[:, 1])])
            dd = np.array([np.interp(fr, sail.f, sail.d[:, 0]), np.interp(fr, sail.f, sail.d[:, 1])])
            q = pl + dd * 0.45
            r = np.hypot(px - q[0], pz - q[1])
            dots = np.maximum(dots, band(r, 0.03, 0.008))
            ax = (px - q[0]) * dd[0] + (pz - q[1]) * dd[1]
            ac = -(px - q[0]) * dd[1] + (pz - q[1]) * dd[0]
            yarn = band(ac + 0.02 * np.sin(ax * 30.0), 0.005, 0.006) * (ax > 0) * (ax < 0.22)
            dots = np.maximum(dots, yarn)

    # --- Colore ---
    col = np.empty(px.shape + (3,))
    col[:] = DACRON
    col *= (1.0 + tone)[..., None]
    # più strati riflettono un filo di più (tessuto più fitto), le cuciture fanno un'ombra fine
    col *= (1.0 + 0.012 * np.clip(layers - 1.0, 0, 4))[..., None]
    col *= (1.0 - 0.3 * seam)[..., None]
    col *= (1.0 - 0.07 * over)[..., None]
    col = col * (1 - pockets[..., None] * 0.02)
    batten_col = np.array([0.80, 0.80, 0.78])
    col = col * (1 - battens[..., None] * 0.5) + batten_col * battens[..., None] * 0.5
    metal = np.array([0.55, 0.56, 0.58])
    col = col * (1 - headboard[..., None]) + metal * headboard[..., None]
    col = col * (1 - grommet[..., None]) + metal * 0.8 * grommet[..., None]
    if is_main:
        col = col * (1 - dots[..., None]) + np.array([0.35, 0.36, 0.38]) * dots[..., None]
    else:
        col = col * (1 - dots[..., None]) + np.array([0.55, 0.06, 0.05]) * dots[..., None]
    img_c[:, cols] = col

    # strati di tessuto: stecche e tavoletta lasciano passare quasi nulla
    layers = layers + battens * 3.0 + headboard * 6.0 + grommet * 3.0
    # rilievo per la normal map, in strati; le cuciture arricciano un poco il tessuto vicino
    pucker = np.sin(along * 2 * np.pi / 0.16 + panel_id * 1.7) * np.exp(-np.abs(dseam) / 0.035) * 0.35
    img_f[0][:, cols] = layers + pucker + battens * 1.5
    img_f[1][:, cols] = layers


def normals_from_height(h, strength):
    """h in strati di tessuto; strength: pendenza per uno strato in più su un pixel."""
    gy, gx = np.gradient(h)
    gx *= strength
    gy *= strength
    n = np.stack([-gx, gy, np.ones_like(h)], axis=-1)       # verde in alto (convenzione OpenGL)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return n


def down(a):
    """Media dei blocchi SSxSS."""
    if a.ndim == 2:
        return a.reshape(SIZE, SS, SIZE, SS).mean(axis=(1, 3))
    return a.reshape(SIZE, SS, SIZE, SS, a.shape[-1]).mean(axis=(1, 3))


def to_srgb(x):
    x = np.clip(x, 0, 1)
    return np.where(x <= 0.0031308, 12.92 * x, 1.055 * np.power(x, 1 / 2.4) - 0.055)


def weave_tile(n=512):
    """Trama ripetibile: tela a fili incrociati e grinze morbide."""
    y, x = np.mgrid[0:n, 0:n] / n
    th = 64                                                   # fili per lato del riquadro
    warp = np.sin(2 * np.pi * x * th) * 0.5 + 0.5
    weft = np.sin(2 * np.pi * y * th) * 0.5 + 0.5
    over = (np.floor(x * th) + np.floor(y * th)) % 2
    h = np.where(over > 0, warp * 0.6 + weft * 0.4, weft * 0.6 + warp * 0.4) * 0.6
    # grinze: somma di onde ripetibili con fasi casuali, orientate a caso
    for _ in range(14):
        kx, ky = rng.integers(-5, 6, 2)
        if kx == 0 and ky == 0:
            continue
        ph = rng.uniform(0, 2 * np.pi)
        amp = 2.2 / math.hypot(kx, ky)
        h += amp * np.sin(2 * np.pi * (kx * x + ky * y) + ph)
    gy, gx = np.gradient(h)
    gx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * 0.5
    gy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * 0.5
    s = 0.9
    nn = np.stack([-gx * s, gy * s, np.ones_like(h)], axis=-1)
    nn /= np.linalg.norm(nn, axis=-1, keepdims=True)
    return nn


def main():
    layout = json.loads(LAYOUT.read_text())
    OUT.mkdir(parents=True, exist_ok=True)
    img_c = np.empty((N, N, 3))
    img_c[:] = DACRON
    height = np.ones((N, N))
    thick = np.ones((N, N))
    allcols = np.arange(N)
    for name, spec in layout.items():
        sail = Sail(name, spec)
        # ogni vela occupa metà atlante, compreso il margine (bordi estesi)
        half = allcols < N // 2 if spec["uv"][0] < 0.5 else allcols >= N // 2
        paint(sail, img_c, (height, thick), allcols[half])

    albedo = to_srgb(down(img_c))
    Image.fromarray((albedo * 255 + 0.5).astype(np.uint8), "RGB").save(OUT / "sails_albedo.png", optimize=True)

    # rilievi appena accennati: le cuciture si leggono con la luce radente, non come solchi
    h = down(height)
    nrm = normals_from_height(h, 0.35)
    t = np.clip(down(thick) * 0.25, 0, 1)
    rgba = np.concatenate([nrm * 0.5 + 0.5, t[..., None]], axis=-1)
    Image.fromarray((rgba * 255 + 0.5).astype(np.uint8), "RGBA").save(OUT / "sails_normal.png", optimize=True)

    wv = weave_tile()
    Image.fromarray(((wv * 0.5 + 0.5) * 255 + 0.5).astype(np.uint8), "RGB").save(OUT / "sails_weave.png", optimize=True)
    for f in ("sails_albedo.png", "sails_normal.png", "sails_weave.png"):
        print(f, (OUT / f).stat().st_size // 1024, "KB")


if __name__ == "__main__":
    main()
