"""Texture tileabili (1 m x 1 m) per i legni: pagliolo teak e holly, coperta in teak con comenti."""
import random

from PIL import Image, ImageDraw, ImageFilter

N = 1024            # pixel per metro
random.seed(651)


def planks(path, plank_m, seam_m, base, seam_color, spread, grain_alpha):
    img = Image.new("RGB", (N, N), base)
    d = ImageDraw.Draw(img)
    pw = int(plank_m * N)
    sw = max(1, int(seam_m * N))
    n = N // pw
    pw = N // n                                     # tileabile
    for i in range(n):
        y0 = i * pw
        k = random.uniform(-spread, spread)
        c = tuple(max(0, min(255, int(ch * (1 + k)))) for ch in base)
        d.rectangle([0, y0, N, y0 + pw - sw - 1], fill=c)
        # venatura: linee sottili lungo la doga
        for _ in range(26):
            yy = y0 + random.randint(0, max(1, pw - sw - 2))
            shade = random.uniform(0.82, 1.08)
            gc = tuple(max(0, min(255, int(ch * shade))) for ch in c)
            x0 = random.randint(-N // 2, N)
            d.line([(x0, yy), (x0 + random.randint(N // 3, N), yy + random.randint(-2, 2))],
                   fill=gc, width=1)
        d.rectangle([0, y0 + pw - sw, N, y0 + pw - 1], fill=seam_color)
        # giunti di testa sfalsati
        xj = (i * 397) % N
        d.rectangle([xj, y0, xj + max(1, sw // 2), y0 + pw - sw], fill=seam_color)
    img = img.filter(ImageFilter.GaussianBlur(0.6))
    img.save(path)


planks("models/textures/teak_holly_sole.png", 0.0667, 0.006, (138, 82, 38), (226, 214, 186), 0.07, 0.3)
planks("models/textures/teak_deck.png", 0.055, 0.006, (176, 138, 96), (28, 24, 22), 0.08, 0.3)
print("ok")
