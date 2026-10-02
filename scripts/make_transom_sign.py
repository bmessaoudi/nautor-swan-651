"""Genera la texture del cartello di poppa "Lunz am Meer" (stile cartello di fine paese austriaco)."""
from PIL import Image, ImageDraw, ImageFont

W, H = 1200, 440
img = Image.new("RGBA", (W, H), (255, 255, 255, 255))
d = ImageDraw.Draw(img)
red = (196, 30, 36, 255)
navy = (24, 28, 70, 255)
d.rectangle([10, 10, W - 11, H - 11], outline=navy, width=14)
d.rectangle([34, 34, W - 35, H - 35], outline=red, width=6)
font = None
for path in ("/System/Library/Fonts/Supplemental/Arial Bold.ttf",
             "/System/Library/Fonts/Supplemental/Arial.ttf",
             "/System/Library/Fonts/Helvetica.ttc"):
    try:
        font = ImageFont.truetype(path, 150)
        break
    except OSError:
        continue
text = "Lunz am Meer"
bbox = d.textbbox((0, 0), text, font=font)
tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
d.text(((W - tw) / 2 - bbox[0], (H - th) / 2 - bbox[1]), text, fill=navy, font=font)
d.line([(70, H - 70), (W - 70, 70)], fill=red, width=34)
img.save("models/textures/lunz_transom_sign.png")
print("ok", tw, th)
