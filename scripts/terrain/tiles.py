# Utilità comuni per le terrain tiles di AWS Open Data (formato Terrarium).
# Le tile sono PNG 256x256 in Web Mercator: altezza = R * 256 + G + B / 256 - 32768 metri.
# Si scaricano una volta sola in una cache locale (non va nel repo).
import math
import pathlib
import subprocess

import numpy as np
from PIL import Image

URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"
CACHE = pathlib.Path(__file__).parent / ".cache"


def lonlat_to_tile(lon, lat, z):
    """Coordinate di tile frazionarie (x, y) al livello z."""
    n = 2**z
    x = (lon + 180.0) / 360.0 * n
    r = math.radians(lat)
    y = (1.0 - math.asinh(math.tan(r)) / math.pi) / 2.0 * n
    return x, y


def tile(z, x, y):
    path = CACHE / f"{z}_{x}_{y}.png"
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        # curl perché è solo un download binario da un URL diretto
        subprocess.run(["curl", "-sfL", "-o", str(path), URL.format(z=z, x=x, y=y)], check=True)
    rgb = np.asarray(Image.open(path).convert("RGB")).astype(np.float64)
    return rgb[..., 0] * 256 + rgb[..., 1] + rgb[..., 2] / 256 - 32768


def mosaic(lon0, lat0, lon1, lat1, z):
    """Altezze in metri del rettangolo (lon0, lat0)-(lon1, lat1), e metri per pixel."""
    x0, y0 = lonlat_to_tile(lon0, lat1, z)  # angolo in alto a sinistra: latitudine maggiore
    x1, y1 = lonlat_to_tile(lon1, lat0, z)
    tx0, ty0, tx1, ty1 = int(x0), int(y0), int(x1), int(y1)
    rows = []
    for ty in range(ty0, ty1 + 1):
        rows.append(np.concatenate([tile(z, tx, ty) for tx in range(tx0, tx1 + 1)], axis=1))
    full = np.concatenate(rows, axis=0)
    px0, py0 = int((x0 - tx0) * 256), int((y0 - ty0) * 256)
    px1, py1 = int((x1 - tx0) * 256), int((y1 - ty0) * 256)
    lat = (lat0 + lat1) / 2
    mpp = 40075016.686 * math.cos(math.radians(lat)) / (256 * 2**z)
    return full[py0:py1, px0:px1], mpp
