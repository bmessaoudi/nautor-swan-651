"""Misura la tavola Profile Layout del 651-002: estremi del profilo, galleggiamento, pianta."""
import numpy as np
from PIL import Image

img = np.array(Image.open("reference/swan651-002-profile-layout.jpeg").convert("L"))
H, W = img.shape
dark = img < 128
print("size", W, H)

# Banda del profilo (in coordinate originali)
y0, y1 = 400, 1400
band = dark[y0:y1, 300:4500]
cols = np.where(band.any(axis=0))[0] + 300
print("profile x range", cols.min(), cols.max())

# Righe con molti pixel scuri alternati (linea tratteggiata del galleggiamento)
for y in range(700, 820):
    row = dark[y, 300:4400]
    n = row.sum()
    trans = np.abs(np.diff(row.astype(int))).sum()
    if trans > 150:
        print("dashed row", y, "dark", n, "transitions", trans)

# Banda della pianta
py0, py1 = 1750, 2800
pband = dark[py0:py1, 300:4500]
pcols = np.where(pband.any(axis=0))[0] + 300
prows = np.where(pband.any(axis=1))[0] + py0
print("plan x range", pcols.min(), pcols.max(), "y range", prows.min(), prows.max())
