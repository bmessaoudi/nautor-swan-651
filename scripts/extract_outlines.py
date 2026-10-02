"""Estrae dalla tavola i contorni del profilo (sopra/sotto) e della pianta (mezza larghezza)."""
import json
import numpy as np
from PIL import Image

img = np.array(Image.open("reference/swan651-002-profile-layout.jpeg").convert("L"))
dark = img < 140

# Linee di servizio da ignorare
WL_ROWS = range(762, 776)          # galleggiamento tratteggiato
dark_prof = dark.copy()
for y in WL_ROWS:
    dark_prof[y, :] = False

def col_extents(mask, x, y0, y1):
    ys = np.where(mask[y0:y1, x])[0]
    if len(ys) == 0:
        return None
    return int(ys.min() + y0), int(ys.max() + y0)

prof = []
for x in range(380, 4300, 4):
    e = col_extents(dark_prof, x, 400, 1400)
    if e:
        prof.append([x, e[0], e[1]])

# Pianta: centro asse orizzontale tratteggiato
plan_rows = [y for y in range(2250, 2340) if np.abs(np.diff(dark[y, 400:4300].astype(int))).sum() > 150]
plan_dark = dark.copy()
for y in plan_rows:
    plan_dark[y, :] = False
for x in range(2262, 2285):   # asse verticale tratteggiato a mezza nave
    plan_dark[:, x] = False
plan = []
for x in range(380, 4320, 4):
    e = col_extents(plan_dark, x, 1750, 2820)
    if e:
        plan.append([x, e[0], e[1]])

out = {"waterline_y": 769, "plan_centerline_rows": plan_rows, "profile": prof, "plan": plan}
json.dump(out, open("reference/drawing_outlines_px.json", "w"))
print("plan centerline rows", plan_rows)
print("profile first/last", prof[0], prof[-1], "n", len(prof))
print("plan first/last", plan[0], plan[-1], "n", len(plan))
# campioni
for p in prof[::40]: print("P", p)
for p in plan[::40]: print("L", p)
