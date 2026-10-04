# /// script
# requires-python = ">=3.10"
# dependencies = ["numpy", "scipy", "pillow", "tifffile", "imagecodecs"]
# ///
"""Prepara gli asset della terra realistica per web/public/terrain/.

Uso (dalla radice del repo):  uv run scripts/terrain/build_terrain.py

- Arcipelago: Copernicus DEM GLO-30 (tile N63 E022, davanti a Pietarsaari). È un modello di superficie:
  sulle isole include le chiome degli alberi, che qui diventano la maschera del bosco.
- Costa alta: terrain tiles di AWS Open Data in formato Terrarium (z13), Sardegna orientale:
  isole e scogli attorno a Tavolara e Molara, tratti di falesia del golfo di Orosei.
- Texture PBR CC0 di Poly Haven (1k diffuse, 512 normal).

Ogni isola o tratto di costa diventa un "ritaglio" quadrato in un atlante PNG per zona:
R e G = altezza del suolo a 16 bit ((h + 30) * 100, metri), B = altezza delle chiome in decimetri.
Il JSON accanto dice dove sta ogni ritaglio e quanti metri vale un pixel.
I file scaricati restano in scripts/terrain/.cache (fuori dal repo).
"""
import json
import math
import pathlib
import subprocess

import numpy as np
import tifffile
from PIL import Image
from scipy import ndimage

from tiles import CACHE, mosaic

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / "web" / "public" / "terrain"
SEA = -6.0  # quota del fondale attorno alle isole: la riva entra in acqua con una pendenza dolce
H_OFF, H_SCALE = 30.0, 100.0


def curl(url, path):
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(["curl", "-sfL", "-o", str(path), url], check=True)
    return path


# ---------- Ritagli ----------


def resample(a, step_in, step_out, order=3):
    """Ricampiona una griglia di passo step_in (dy, dx) metri a passo quadrato step_out."""
    return ndimage.zoom(a, (step_in[0] / step_out, step_in[1] / step_out), order=order, mode="nearest")


def chip_size(extent_m, target_mpp, cap):
    n = int(math.ceil(extent_m / target_mpp))
    return max(24, min(cap, n))


def fit(a, n):
    """Porta un ritaglio quadrato a n x n pixel."""
    return ndimage.zoom(a, n / a.shape[0], order=3, mode="nearest")[:n, :n]


def square(a, fill):
    """Rende quadrato un ritaglio, centrandolo e riempiendo con fill."""
    h, w = a.shape
    s = max(h, w)
    out = np.full((s, s), fill, a.dtype)
    out[(s - h) // 2:(s - h) // 2 + h, (s - w) // 2:(s - w) // 2 + w] = a
    return out


def islands_from(height, forest, mpp, min_ext, max_ext, limit, target_mpp, cap):
    """Isole intere: componenti di terra che non toccano il bordo del rettangolo."""
    land = height > 0.4
    lab, n = ndimage.label(land)
    found = []
    for i, sl in enumerate(ndimage.find_objects(lab), start=1):
        if sl is None:
            continue
        r0, r1, c0, c1 = sl[0].start, sl[0].stop, sl[1].start, sl[1].stop
        if r0 == 0 or c0 == 0 or r1 == land.shape[0] or c1 == land.shape[1]:
            continue
        ext = max(r1 - r0, c1 - c0) * mpp
        area = (lab[sl] == i).sum() * mpp * mpp
        if not (min_ext <= ext <= max_ext) or area < (min_ext * 0.5) ** 2:
            continue
        found.append((area, i, sl))
    found.sort(key=lambda f: -f[0])
    # varietà: le più grandi e poi una ogni tanto fra le piccole
    if len(found) > limit:
        big = found[: limit // 2]
        rest = found[limit // 2:]
        stride = len(rest) / (limit - len(big))
        found = big + [rest[int(k * stride)] for k in range(limit - len(big))]
    chips = []
    for area, i, sl in found:
        pad = max(4, int(0.12 * max(sl[0].stop - sl[0].start, sl[1].stop - sl[1].start)))
        r0, r1 = max(0, sl[0].start - pad), min(land.shape[0], sl[0].stop + pad)
        c0, c1 = max(0, sl[1].start - pad), min(land.shape[1], sl[1].stop + pad)
        own = lab[r0:r1, c0:c1] == i
        # solo l'isola scelta: le vicine tornano mare
        own = ndimage.binary_dilation(own, iterations=3)
        h = np.where(own, height[r0:r1, c0:c1], SEA)
        f = np.where(own, forest[r0:r1, c0:c1], 0)
        hs, fs = square(h, SEA), square(f, 0)
        ext = hs.shape[0] * mpp
        n = chip_size(ext, target_mpp, cap)
        chips.append({"kind": "isola", "h": fit(hs, n), "f": np.clip(fit(fs, n), 0, 25), "mpp": ext / n})
    return chips


def coast_from(height, mpp, center_px, size_m, target_mpp, cap, name):
    """Tratto di costa: finestra quadrata ruotata in modo che il mare stia verso la riga 0 (verso la barca).
    I bordi di terra (fianchi e retro) scendono in mare con una rampa, così il pezzo sta in piedi da solo."""
    cy, cx = center_px
    half = int(size_m / mpp * 0.75)  # finestra più larga: la rotazione non deve lasciare angoli vuoti
    win = height[max(0, cy - half):cy + half, max(0, cx - half):cx + half].copy()
    win = np.where(win > 0.4, win, SEA)
    # direzione del mare: baricentro dei pixel d'acqua nel cerchio centrale
    yy, xx = np.mgrid[: win.shape[0], : win.shape[1]]
    yy = yy - win.shape[0] / 2
    xx = xx - win.shape[1] / 2
    disk = (yy**2 + xx**2) < (half * 0.66) ** 2
    water = disk & (win <= 0.4)
    sy, sx = yy[water].mean(), xx[water].mean()
    # ruota in modo che il mare finisca verso l'alto (riga 0): si prova l'angolo nei due versi e si
    # tiene quello con il baricentro dell'acqua più in alto
    ang = math.degrees(math.atan2(sx, -sy))
    best = None
    for a in (ang, -ang):
        r = ndimage.rotate(win, a, reshape=False, order=1, mode="constant", cval=SEA)
        wy = yy[disk & (r <= 0.4)].mean()
        if best is None or wy < best[0]:
            best = (wy, a, r)
    _, ang, rot = best
    k = int(size_m / mpp / 2)
    c = rot.shape[0] // 2, rot.shape[1] // 2
    h = rot[c[0] - k:c[0] + k, c[1] - k:c[1] + k]
    n = chip_size(h.shape[0] * mpp, target_mpp, cap)
    h = fit(h, n)
    # rampa sui fianchi e sul retro
    u = np.linspace(0, 1, n)
    side = np.minimum(u, 1 - u)  # distanza dai fianchi (0..0.5)
    wx = np.clip(side / 0.18, 0, 1) ** 1.5
    wy = np.clip((1 - u) / 0.22, 0, 1) ** 1.5  # retro (riga n)
    w = wy[:, None] * wx[None, :]
    w = w * w * (3 - 2 * w)
    h = np.where(h > 0, h * w, h)
    h = np.where(h > 0.4, h, SEA)
    print(f"  costa {name}: rotazione {ang:.0f} gradi, quota massima {h.max():.0f} m")
    return {"kind": "costa", "name": name, "h": h, "f": np.zeros_like(h), "mpp": size_m / n}


# ---------- Zone ----------


def arcipelago():
    tif = curl(
        "https://copernicus-dem-30m.s3.amazonaws.com/Copernicus_DSM_COG_10_N63_00_E022_00_DEM/Copernicus_DSM_COG_10_N63_00_E022_00_DEM.tif",
        CACHE / "cop_N63_E022.tif",
    )
    a = tifffile.imread(tif).astype(np.float64)
    H, W = a.shape  # sopra i 60 gradi la tile ha metà colonne: 1800 x 3600
    lon0, lon1, lat0, lat1 = 22.30, 22.85, 63.60, 63.85
    dsm = a[int((64 - lat1) * H):int((64 - lat0) * H), int((lon0 - 22) * W):int((lon1 - 22) * W)]
    lat = math.radians((lat0 + lat1) / 2)
    step = (111320.0 / H, 111320.0 * math.cos(lat) / W)  # metri per pixel (dy, dx)
    print(f"arcipelago: {dsm.shape}, passo {step[0]:.1f} x {step[1]:.1f} m")
    # suolo e chiome: la costa davanti a Pietarsaari è piatta (sale ancora dal mare dopo il ghiaccio),
    # la roccia nuda sta quasi sempre sotto i 4-5 m. Quello che supera è bosco: diventa densità di
    # pini e la quota si comprime, perché l'altezza la daranno gli alberi
    land = dsm > 0.4
    # B dell'atlante = altezza delle chiome in decimetri: il modello di superficie le vede già
    ground = np.where(dsm < 3.5, dsm, 3.5 + (dsm - 3.5) * 0.3)
    forest = np.clip(dsm - ground - 1.0, 0, None) * 1.15 * land
    forest = ndimage.gaussian_filter(forest, 0.6)
    # rive arrotondate: il campo terra/mare si sfuma prima di ricampionare, così la linea di costa
    # non segue i gradini dei pixel da 30 m
    field = np.where(land, np.maximum(ground, 1.2), SEA)
    field = ndimage.gaussian_filter(field, 0.9)
    mpp = 6.0
    g = resample(field, step, mpp)
    f = resample(forest, step, mpp, order=1)
    return islands_from(g, f, mpp, min_ext=110, max_ext=1600, limit=28, target_mpp=6.0, cap=128)


def costa():
    h, mpp = mosaic(9.45, 40.80, 9.85, 41.05, 13)
    print(f"costa alta: {h.shape}, {mpp:.1f} m per pixel")
    h = ndimage.gaussian_filter(h, 0.6)
    chips = islands_from(h, np.zeros_like(h), mpp, min_ext=60, max_ext=6000, limit=10, target_mpp=10.0, cap=256)
    # tratti di costa scelti in automatico: finestre a cavallo della riva con il mare tutto da una
    # parte e i rilievi più alti dietro
    # le falesie del golfo di Orosei (Cala Gonone, Cala Luna, Goloritzè): fino a 800 m a picco sul mare
    h, mpp = mosaic(9.50, 40.00, 9.80, 40.32, 13)
    h = ndimage.gaussian_filter(h, 0.6)
    print(f"golfo di Orosei: {h.shape}, {mpp:.1f} m per pixel")
    size = 4200
    k = int(size / mpp / 2)
    land = h > 0.4
    shore = land & ~ndimage.binary_erosion(land, iterations=2)
    small = ndimage.zoom(h, 0.125, order=1)
    cands = []
    for cy, cx in zip(*np.nonzero(shore[::24, ::24])):
        cy, cx = cy * 24, cx * 24
        if cy < k or cx < k or cy + k > h.shape[0] or cx + k > h.shape[1]:
            continue
        w = h[cy - k:cy + k:4, cx - k:cx + k:4]
        wet = w <= 0.4
        frac = wet.mean()
        if not 0.3 < frac < 0.6:
            continue
        yy, xx = np.mgrid[: w.shape[0], : w.shape[1]] - w.shape[0] / 2
        r = np.hypot(yy, xx) + 1e-6
        coher = np.hypot((yy / r)[wet].mean(), (xx / r)[wet].mean())
        top = np.percentile(w[~wet], 90)
        cands.append((top * coher, cy, cx, top, coher))
    cands.sort(reverse=True)
    picked = []
    for score, cy, cx, top, coher in cands:
        if all(math.hypot(cy - py, cx - px) * mpp > size * 0.9 for py, px in picked):
            picked.append((cy, cx))
            chips.append(coast_from(h, mpp, (cy, cx), size, 12.0, 256, f"costa_{len(picked)}"))
        if len(picked) == 5:
            break
    return chips


# ---------- Atlante ----------


def pack(chips, width):
    """Scaffali semplici, dal più alto al più basso."""
    chips.sort(key=lambda c: -c["h"].shape[0])
    x = y = shelf = 0
    for c in chips:
        n = c["h"].shape[0]
        if x + n > width:
            x, y, shelf = 0, y + shelf, 0
        c["x"], c["y"] = x, y
        x += n + 1
        shelf = max(shelf, n + 1)
    return y + shelf


def write_atlas(name, chips, width):
    height = pack(chips, width)
    img = np.zeros((height, width, 3), np.uint8)
    meta = []
    for c in chips:
        n = c["h"].shape[0]
        v = np.clip(np.round((c["h"] + H_OFF) * H_SCALE), 0, 65535).astype(np.uint32)
        img[c["y"]:c["y"] + n, c["x"]:c["x"] + n, 0] = v >> 8
        img[c["y"]:c["y"] + n, c["x"]:c["x"] + n, 1] = v & 255
        img[c["y"]:c["y"] + n, c["x"]:c["x"] + n, 2] = np.clip(np.round(c["f"] * 10), 0, 255).astype(np.uint8)
        meta.append({
            "kind": c["kind"], **({"name": c["name"]} if "name" in c else {}),
            "x": c["x"], "y": c["y"], "n": n, "mpp": round(c["mpp"], 3),
            "hmax": round(float(c["h"].max()), 1),
            "size": round(n * c["mpp"]), "forest": round(float((c["f"] > 3).sum() / max(1, (c["h"] > 0).sum())), 3),
        })
    OUT.mkdir(parents=True, exist_ok=True)
    Image.fromarray(img).save(OUT / f"{name}.png", optimize=True)
    return {"atlas": f"{name}.png", "width": width, "height": height, "chips": meta}


# ---------- Texture ----------

# strato: (asset Poly Haven, uso)
TEXTURES = {
    "roccia": "aerial_rocks_02",  # granito e scogliere, pendenze forti
    "lichene": "aerial_grass_rock",  # roccia con muschi e licheni, pendenze medie
    "suolo": "rocky_terrain_02",  # suolo erboso con massi: sottobosco e macchia
    "riva": "coast_sand_01",  # sabbia e ciottoli bagnati della battigia
}


def textures():
    for layer, asset in TEXTURES.items():
        for kind, size, quality in (("diff", 1024, 82), ("nor_gl", 512, 88)):
            src = curl(
                f"https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/{asset}/{asset}_{kind}_1k.jpg",
                CACHE / f"{asset}_{kind}_1k.jpg",
            )
            im = Image.open(src).convert("RGB")
            if im.size[0] != size:
                im = im.resize((size, size), Image.LANCZOS)
            im.save(OUT / f"{layer}_{'diff' if kind == 'diff' else 'nor'}.jpg", quality=quality, optimize=True)


def main():
    meta = {
        "encoding": {"offset": H_OFF, "scale": H_SCALE, "sea": SEA},
        "fonti": {
            "arcipelago": "Copernicus DEM GLO-30, N63 E022 (Pietarsaari, Finlandia)",
            "costa": "AWS Terrain Tiles Terrarium z13 (Sardegna: Tavolara e Molara, golfo di Orosei)",
            "texture": {k: f"Poly Haven {v} (CC0)" for k, v in TEXTURES.items()},
        },
        "arcipelago": write_atlas("arcipelago", arcipelago(), 1024),
        "costa": write_atlas("costa", costa(), 1024),
    }
    textures()
    (OUT / "terrain.json").write_text(json.dumps(meta, indent=1))
    total = sum(p.stat().st_size for p in OUT.iterdir())
    for z in ("arcipelago", "costa"):
        print(z, len(meta[z]["chips"]), "ritagli,", meta[z]["height"], "px di altezza")
    print(f"totale {total / 1e6:.2f} MB in {OUT}")


if __name__ == "__main__":
    main()
