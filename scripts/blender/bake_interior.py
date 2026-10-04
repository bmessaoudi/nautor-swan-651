"""Swan 651: luce cotta degli interni (lightmap in Cycles) su un secondo set di UV.

Chiamato da build_and_export.py: prima dell'export crea il set di UV "Lightmap" (finisce nel GLB
come TEXCOORD_1), dopo l'export cuoce le mappe se SWAN_BAKE non vale 0. Si può anche lanciare da
solo su un .blend già costruito:
    SWAN_REPO=... Blender -b models/swan651.blend --python scripts/blender/bake_interior.py

Le mappe vanno in web/public/models/lightmaps/:
- interior_light.webp: irradianza (solo luce, senza colore dei materiali) a barca chiusa, con la
  luce del giorno che entra da oblò e tambucci e le plafoniere calde accese. Normalizzata: il
  fattore per tornare all'irradianza vera è in interior.json (scale).
- interior_ao.webp: occlusione ambientale (raggio 0,45 m), per togliere la luce piatta dello studio
  negli angoli, sotto i tavoli e lungo i piedi dei mobili.

Variabili d'ambiente: SWAN_BAKE_SIZE (lato dell'atlante, 2048), SWAN_BAKE_SAMPLES (campioni, 160),
SWAN_BAKE_MARGIN (pixel fra le isole, 2: nel web la mappa si legge senza mipmap).
"""
import json
import math
import os

import bpy
import numpy as np

REPO = os.environ.get("SWAN_REPO", "/Users/bilalmessaoudi/Desktop/coding/nautor-swan")
LM_DIR = os.path.join(REPO, "web/public/models/lightmaps")
LM_UV = "Lightmap"
LM_SIZE = int(os.environ.get("SWAN_BAKE_SIZE", "2048"))
LM_SAMPLES = int(os.environ.get("SWAN_BAKE_SAMPLES", "160"))
LM_MARGIN_PX = int(os.environ.get("SWAN_BAKE_MARGIN", "2"))
LM_PACK = os.environ.get("SWAN_BAKE_PACK", "CONCAVE")

# Colori delle sorgenti: giorno nordico un po' freddo, plafoniere alogene calde (circa 2800 K)
DAYLIGHT = (0.86, 0.93, 1.0)
WARM = (1.0, 0.71, 0.42)


def lm_objects():
    col = bpy.data.collections.get("Swan651_Interior")
    return [o for o in col.all_objects if o.type == "MESH" and not o.name.startswith("Ref_")]


# ---------------------------------------------------------------------------
# Secondo set di UV
# ---------------------------------------------------------------------------
def make_lightmap_uvs():
    """UV della lightmap: Smart UV su tutti gli interni insieme, isole alla stessa densità,
    impacchettate in un solo atlante con margine. Il primo set (UVMap, in metri) resta per le texture."""
    objs = lm_objects()
    view_layer = bpy.context.view_layer
    if bpy.context.object and bpy.context.object.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    for o in view_layer.objects:
        o.select_set(False)
    for o in objs:
        uvs = o.data.uv_layers
        if not uvs:
            uvs.new(name="UVMap")
        lm = uvs.get(LM_UV) or uvs.new(name=LM_UV)
        uvs.active = lm
        # l'export glTF usa l'indice: UVMap -> TEXCOORD_0, Lightmap -> TEXCOORD_1
        uvs[0].active_render = True
        o.hide_set(False)
        o.select_set(True)
    view_layer.objects.active = objs[0]
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.reveal()
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(50), island_margin=0.0, area_weight=0.0,
                             correct_aspect=True, scale_to_bounds=False)
    bpy.ops.uv.select_all(action="SELECT")
    bpy.ops.uv.average_islands_scale()
    margin = (LM_MARGIN_PX + 1) / LM_SIZE
    try:
        bpy.ops.uv.pack_islands(rotate=True, margin_method="FRACTION", margin=margin, shape_method=LM_PACK)
    except TypeError:
        bpy.ops.uv.pack_islands(rotate=True, margin=margin)
    bpy.ops.object.mode_set(mode="OBJECT")
    area = 0.0
    for o in objs:
        uv = o.data.uv_layers[LM_UV].data
        for p in o.data.polygons:
            pts = [uv[i].uv for i in p.loop_indices]
            area += 0.5 * abs(sum(a.x * b.y - b.x * a.y for a, b in zip(pts, pts[1:] + pts[:1])))
        o.data.uv_layers.active = o.data.uv_layers[0]
    print("LIGHTMAP_UV", len(objs), "copertura %.2f" % area, [o.name for o in objs])


# ---------------------------------------------------------------------------
# Sorgenti di luce per la cottura (temporanee)
# ---------------------------------------------------------------------------
def _light(col, name, kind, loc, color, energy, size=None, rot=None):
    data = bpy.data.lights.new(name, kind)
    data.color = color
    data.energy = energy
    if kind == "AREA":
        data.shape = "RECTANGLE"
        data.size, data.size_y = size
    elif kind == "POINT":
        data.shadow_soft_size = size or 0.04
    ob = bpy.data.objects.new(name, data)
    ob.location = loc
    if rot:
        ob.rotation_euler = rot
    col.objects.link(ob)
    return ob


def bake_lights(col):
    """Oblò sui fianchi della tuga, tambucci in coperta e plafoniere calde nelle cabine.
    Restituisce (giorno, plafoniere): le due famiglie si cuociono separate."""
    day, lamps = [], []
    # oblò: rettangoli luminosi appena dentro il vetro, rivolti verso l'asse e un po' in basso
    for x0p, x1p, slant in PORTLIGHTS:
        x0, x1 = px_x(x0p), px_x(x1p)
        xm = (x0 + x1) / 2
        ztop = coachroof_side_height(xm)
        zbase = deck_z(xm, coachroof_half_width(xm))
        z0 = zbase + (ztop - zbase) * (CR_RED_BAND + 0.08)
        z1 = zbase + (ztop - zbase) * 0.9
        zm = (z0 + z1) / 2
        for side in (-1, 1):
            if xm < COCKPIT_FWD:
                y = side * (cockpit_half_width() + 0.06 - 0.08)
            else:
                y = side * (coachroof_side_y(xm, zm) - 0.08)
            # l'area di Blender emette lungo -Z locale: la si gira verso l'asse, 12 gradi in basso
            rot = (-side * math.radians(78), 0.0, 0.0)
            day.append(_light(col, "Bake_Portlight", "AREA", to_world(xm, y, zm), DAYLIGHT, 55.0 * (x1 - x0),
                              size=(x1 - x0, z1 - z0), rot=rot))
    # tambucci: cabina di prua, dinette, cucina sopra la scala, cabina armatoriale
    for px, w, l in ((3560, 0.55, 0.55), (2480, 0.6, 0.6), (2090, 0.75, 0.6), (1300, 0.5, 0.5), (2900, 0.45, 0.45)):
        x = plan_x(px)
        z = ceiling(x, 0.0) - 0.03
        day.append(_light(col, "Bake_Hatch", "AREA", to_world(x, 0.0, z), DAYLIGHT, 60.0 * w * l, size=(l, w)))
    # plafoniere calde (faretti in ottone del cielino): (px, py) in pianta
    lamp_at = [
        (1230, 2080), (1230, 2510), (1520, 2290),             # armatoriale
        (1680, 2120), (1680, 2280),                           # bagno e doccia di poppa
        (1900, 1960), (2080, 2080), (2200, 1960),             # cucina
        (2170, 2590), (1800, 2650),                           # carteggio e ospiti di dritta
        (2360, 2100), (2560, 2100), (2400, 2560), (2600, 2560), (2500, 2320),   # dinette
        (2880, 2040), (3130, 2520), (3270, 2220), (2800, 2490),                 # cabine e bagni prodieri
        (3480, 2290), (3640, 2290),                           # cabina a V
    ]
    for px, py in lamp_at:
        x, y = plan_x(px), plan_y(py)
        z = ceiling(x, y) - 0.06
        lamps.append(_light(col, "Bake_Lamp", "POINT", to_world(x, y, z), WARM, 9.0, size=0.05))
    return day, lamps


# ---------------------------------------------------------------------------
# Cottura
# ---------------------------------------------------------------------------
def _setup_cycles(scene):
    scene.render.engine = "CYCLES"
    prefs = bpy.context.preferences.addons["cycles"].preferences
    for dev_type in ("METAL", "OPTIX", "CUDA", "HIP"):
        try:
            prefs.compute_device_type = dev_type
            prefs.get_devices()
            if any(d.type == dev_type for d in prefs.devices):
                break
        except TypeError:
            continue
    gpu = False
    for d in prefs.devices:
        d.use = True
        gpu = gpu or d.type != "CPU"
    scene.cycles.device = "GPU" if gpu else "CPU"
    scene.cycles.samples = LM_SAMPLES
    scene.cycles.use_adaptive_sampling = False
    scene.cycles.max_bounces = 6
    scene.cycles.diffuse_bounces = 4
    scene.cycles.glossy_bounces = 1
    scene.cycles.transmission_bounces = 0
    scene.cycles.use_light_tree = True
    print("BAKE device", scene.cycles.device, prefs.compute_device_type)


def _masked_blur(rgba, radius):
    """Sfocatura gaussiana che pesa solo i texel cotti (alfa > 0): toglie il rumore residuo
    senza portare il nero dello sfondo dentro le isole."""
    if radius <= 0:
        return rgba
    k = np.exp(-0.5 * (np.arange(-2 * radius, 2 * radius + 1) / radius) ** 2)
    k /= k.sum()
    a = rgba[..., 3:4]
    acc = np.concatenate([rgba[..., :3] * a, a], axis=-1)

    def conv(img, axis):
        out = np.zeros_like(img)
        n = len(k) // 2
        for i, w in enumerate(k):
            out += w * np.roll(img, i - n, axis=axis)
        return out

    acc = conv(conv(acc, 0), 1)
    w = np.maximum(acc[..., 3:4], 1e-6)
    out = rgba.copy()
    out[..., :3] = np.where(a > 0, acc[..., :3] / w, rgba[..., :3])
    return out


def _srgb(x):
    x = np.clip(x, 0.0, 1.0)
    return np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(x, 1 / 2.4) - 0.055)


def _save(name, rgb, alpha):
    """Salva un'immagine 8 bit (valori già in sRGB) in WebP, con il PNG come ripiego."""
    img = bpy.data.images.new(name, LM_SIZE, LM_SIZE, alpha=False, float_buffer=False)
    img.colorspace_settings.name = "sRGB"
    rgba = np.concatenate([rgb, np.ones_like(alpha)], axis=-1).astype(np.float32)
    img.pixels.foreach_set(rgba.ravel())
    path = os.path.join(LM_DIR, name + ".webp")
    try:
        img.filepath_raw = path
        img.file_format = "WEBP"
        img.save(filepath=path, quality=90)
    except (RuntimeError, TypeError):
        path = os.path.join(LM_DIR, name + ".png")
        img.filepath_raw = path
        img.file_format = "PNG"
        img.save()
    bpy.data.images.remove(img)
    return os.path.basename(path)


def bake_lightmaps():
    scene = bpy.context.scene
    os.makedirs(LM_DIR, exist_ok=True)
    objs = lm_objects()
    view_layer = bpy.context.view_layer
    if bpy.context.object and bpy.context.object.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")

    # Scena di cottura: barca chiusa, niente cielo (la luce entra solo dalle sorgenti messe
    # sulle aperture), niente vele né tavole di riferimento
    hidden = []
    for o in scene.objects:
        skip = (o.name.startswith("Ref_") or o.name in ("Mainsail", "Headsail", "Boom", "Rigging", "Lifelines", "Portlights")
                or (o.users_collection and o.users_collection[0].name == "Reference"))
        if skip and not o.hide_render:
            o.hide_render = True
            hidden.append(o)
    world = scene.world or bpy.data.worlds.new("World")
    scene.world = world
    world_state = (world.use_nodes, world.color[:], world.light_settings.distance)
    world.use_nodes = False
    world.color = (0.0, 0.0, 0.0)
    world.light_settings.distance = 0.45

    lights = bpy.data.collections.new("Bake_Lights")
    scene.collection.children.link(lights)
    day, lamps = bake_lights(lights)
    # le plafoniere si cuociono bianche: nel web il colore caldo lo dà lo shader (lightmaps.js)
    for ob in lamps:
        ob.data.color = (1.0, 1.0, 1.0)
    _setup_cycles(scene)

    img = bpy.data.images.new("LM_bake", LM_SIZE, LM_SIZE, alpha=True, float_buffer=True)
    img.colorspace_settings.name = "Linear Rec.709" if "Linear Rec.709" in [
        c.name for c in bpy.types.ColorManagedInputColorspaceSettings.bl_rna.properties["name"].enum_items] else "Non-Color"
    img.generated_color = (0.0, 0.0, 0.0, 0.0)

    # nodo immagine attivo in ogni materiale degli interni (anche quelli condivisi con l'esterno:
    # si cuociono solo gli oggetti selezionati)
    added = []
    mats = {m for o in objs for m in o.data.materials if m}
    for m in mats:
        m.use_nodes = True
        node = m.node_tree.nodes.new("ShaderNodeTexImage")
        node.image = img
        node.interpolation = "Linear"
        m.node_tree.nodes.active = node
        added.append((m, node))
    for o in view_layer.objects:
        o.select_set(False)
    for o in objs:
        o.data.uv_layers.active = o.data.uv_layers[LM_UV]
        o.select_set(True)
    view_layer.objects.active = objs[0]

    bk = scene.render.bake
    bk.margin = LM_MARGIN_PX
    bk.margin_type = "EXTEND"
    bk.use_clear = True
    bk.target = "IMAGE_TEXTURES"
    out = {}

    def bake_diffuse(only):
        """Cottura della luce diffusa con accese solo le sorgenti di `only`."""
        for ob in day + lamps:
            ob.hide_render = ob not in only
        img.generated_color = (0.0, 0.0, 0.0, 0.0)
        bpy.ops.object.bake(type="DIFFUSE", pass_filter={"DIRECT", "INDIRECT"}, margin=LM_MARGIN_PX, use_clear=True)
        return np.array(img.pixels[:], dtype=np.float32).reshape(LM_SIZE, LM_SIZE, 4)

    def lum(x):
        return x[..., 0] * 0.2126 + x[..., 1] * 0.7152 + x[..., 2] * 0.0722

    try:
        import time
        t0 = time.time()
        light = bake_diffuse(day)
        print("BAKE giorno", round(time.time() - t0, 1), "s")
        t0 = time.time()
        lamp = bake_diffuse(lamps)
        print("BAKE plafoniere", round(time.time() - t0, 1), "s")
        t0 = time.time()
        img.generated_color = (0.0, 0.0, 0.0, 0.0)
        bpy.ops.object.bake(type="AO", margin=LM_MARGIN_PX, use_clear=True)
        ao = np.array(img.pixels[:], dtype=np.float32).reshape(LM_SIZE, LM_SIZE, 4)
        print("BAKE ao", round(time.time() - t0, 1), "s")

        mask = light[..., 3] > 0
        # Giorno (oblò e tambucci) a colori. Il 99,5 percentile va a 1: in 8 bit restano leggibili
        # anche le zone in ombra; il fattore per tornare al valore vero va in interior.json
        # Il taglio deve rispettare la tinta: tagliando i canali uno per uno il blu della luce del
        # giorno si fermava a 1 prima del rosso, e sotto i tambucci i materassi diventavano pesca
        # con un bordo rosa. Si normalizza sul canale più alto e si riduce il colore intero.
        light = _masked_blur(light, 2)
        peak = light[..., :3].max(axis=-1)
        scale = float(np.percentile(peak[mask], 99.8)) if mask.any() else 1.0
        rgb = light[..., :3] / scale
        over = np.maximum(rgb.max(axis=-1, keepdims=True), 1.0)
        out["light"] = _save("interior_light", _srgb(rgb / over), light[..., 3:4])
        # Mappa a due canali: R = occlusione ambientale (la legge l'aoMap di three), G = luce delle
        # plafoniere senza colore (la somma lo shader, a intensità variabile: accensione in /bordo/)
        lamp = _masked_blur(lamp, 2)
        lamp_l = lum(lamp)
        lamp_scale = float(np.percentile(lamp_l[mask], 99.8)) if mask.any() else 1.0
        ao = _masked_blur(ao, 1)
        two = np.zeros((LM_SIZE, LM_SIZE, 3), dtype=np.float32)
        two[..., 0] = _srgb(np.clip(ao[..., 0], 0, 1))
        two[..., 1] = _srgb(lamp_l / lamp_scale)
        two[..., 2] = two[..., 0]
        # fuori dalle isole occlusione bianca e plafoniere spente: niente aloni se il filtro pesca fuori
        bg = ao[..., 3] <= 0
        two[bg, 0] = two[bg, 2] = 1.0
        two[bg, 1] = 0.0
        out["ao"] = _save("interior_ao", two, ao[..., 3:4])
        meta = {
            "light": out["light"], "ao": out["ao"], "scale": round(scale, 5),
            "lampScale": round(lamp_scale, 5), "lampColor": list(WARM), "size": LM_SIZE,
            "samples": LM_SAMPLES, "uv": "TEXCOORD_1",
            "objects": sorted(o.name for o in objs),
        }
        with open(os.path.join(LM_DIR, "interior.json"), "w") as f:
            json.dump(meta, f, indent=2)
        print("LIGHTMAP_OK", json.dumps(meta))
    finally:
        for m, node in added:
            m.node_tree.nodes.remove(node)
        for o in objs:
            o.data.uv_layers.active = o.data.uv_layers[0]
        for ob in list(lights.objects):
            data = ob.data
            bpy.data.objects.remove(ob, do_unlink=True)
            bpy.data.lights.remove(data)
        bpy.data.collections.remove(lights)
        bpy.data.images.remove(img)
        for o in hidden:
            o.hide_render = False
        world.use_nodes, world.color, world.light_settings.distance = world_state[0], world_state[1], world_state[2]
    return out


if __name__ == "__main__":
    # da solo: rigenera ed esporta tutto con la cottura accesa, così GLB e mappe restano allineati
    os.environ["SWAN_BAKE"] = "1"
    exec(open(os.path.join(REPO, "scripts/blender/build_and_export.py")).read(), {"__name__": "swan_build"})
