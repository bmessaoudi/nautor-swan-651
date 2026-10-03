"""Fauna del capitolo Navigazione: gabbiano reale, con scheletro e animazioni.

Generati da script come lo scafo (niente generazione AI). Esporta un GLB in web/public/models/fauna/,
già compressi con meshopt dall'esportatore di Blender.

Dentro Blender (anche via MCP):  exec(open(".../scripts/blender/fauna.py").read())
Da riga di comando:              Blender -b --factory-startup --python scripts/blender/fauna.py

Convenzioni: X in avanti (becco), Z in alto, metri. L'esportatore glTF porta Z in Y, quindi
sul web il muso guarda +X e le ali stanno lungo Z, come i vecchi gabbiani di landscape.js.
I colori sono attributi di colore per vertice in lineare (COLOR_0 nel GLB): niente texture, pesi minimi.
"""
import math
import os

import bmesh
import bpy
from mathutils import Matrix, Quaternion, Vector

HERE = os.path.dirname(os.path.abspath(__file__)) if "__file__" in globals() else None
REPO = os.environ.get("FAUNA_REPO") or (os.path.dirname(os.path.dirname(HERE)) if HERE else None)
OUT = os.path.join(REPO, "web", "public", "models", "fauna")
FPS = 30


def srgb(hexv):
    """Colore sRGB esadecimale in lineare, come lo vuole COLOR_0."""
    out = []
    for i in (16, 8, 0):
        c = ((hexv >> i) & 255) / 255
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return Vector(out)


def smooth(a, b, x):
    t = min(1.0, max(0.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


def clean_scene():
    # scena di lavoro pulita: si tolgono solo oggetti e dati della scena corrente, niente file salvati
    for o in list(bpy.context.scene.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    for coll in (bpy.data.meshes, bpy.data.armatures, bpy.data.actions, bpy.data.materials):
        for d in list(coll):
            if d.users == 0:
                coll.remove(d)
    bpy.context.scene.render.fps = FPS


# ---------- Geometria ----------


def loft(bm, sections, ring=16, flat_bottom=0.0):
    """Tubo per sezioni ellittiche (x, mezza larghezza, mezza altezza, quota del centro), chiuso agli estremi."""
    rows = []
    for x, w, h, zc in sections:
        row = []
        for j in range(ring):
            a = j / ring * math.tau
            y = math.cos(a) * w
            z = math.sin(a) * h
            if z < 0:
                z *= 1 - flat_bottom  # pancia un po' più piatta del dorso
            row.append(bm.verts.new((x, y, zc + z)))
        rows.append(row)
    for r0, r1 in zip(rows, rows[1:]):
        for j in range(ring):
            j2 = (j + 1) % ring
            bm.faces.new((r0[j], r0[j2], r1[j2], r1[j]))
    bm.faces.new(list(reversed(rows[0])))
    bm.faces.new(rows[-1])
    return rows


def finalize(name, bm, subdiv=1):
    me = bpy.data.meshes.new(name)
    bm.normal_update()
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    if subdiv:
        mod = ob.modifiers.new("Sub", "SUBSURF")
        mod.levels = subdiv
        mod.render_levels = subdiv
        bpy.context.view_layer.objects.active = ob
        ob.select_set(True)
        bpy.ops.object.modifier_apply(modifier=mod.name)
    for p in me.polygons:
        p.use_smooth = True
    return ob


def paint(ob, fn):
    """Colore per vertice da una funzione della posizione (e dell'indice del pezzo)."""
    me = ob.data
    attr = me.color_attributes.new("Col", "FLOAT_COLOR", "POINT")
    for v in me.vertices:
        c = fn(v.co)
        attr.data[v.index].color = (c.x, c.y, c.z, 1.0)
    me.color_attributes.active_color = attr
    return attr


def vertex_material(name, rough, spec=0.5):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    col = nt.nodes.new("ShaderNodeVertexColor")
    col.layer_name = "Col"
    nt.links.new(col.outputs[0], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = rough
    return m


def rig(name, bones):
    """Armatura da una lista (nome, testa, coda, genitore)."""
    arm = bpy.data.armatures.new(name)
    ob = bpy.data.objects.new(name, arm)
    bpy.context.scene.collection.objects.link(ob)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.mode_set(mode="EDIT")
    eb = {}
    for bname, head, tail, parent in bones:
        b = arm.edit_bones.new(bname)
        b.head, b.tail = head, tail
        b.roll = 0
        if parent:
            b.parent = eb[parent]
            b.use_connect = False
        eb[bname] = b
    bpy.ops.object.mode_set(mode="OBJECT")
    return ob


def skin(mesh_ob, arm_ob, weights):
    """weights(co) restituisce {osso: peso}; i pesi si normalizzano."""
    groups = {b.name: mesh_ob.vertex_groups.new(name=b.name) for b in arm_ob.data.bones}
    for v in mesh_ob.data.vertices:
        w = {k: x for k, x in weights(v.co).items() if x > 1e-4}
        tot = sum(w.values()) or 1
        for k, x in w.items():
            groups[k].add([v.index], x / tot, "REPLACE")
    mesh_ob.parent = arm_ob
    mod = mesh_ob.modifiers.new("Armature", "ARMATURE")
    mod.object = arm_ob


def rot_arm(arm_ob, bname, q_arm):
    """Rotazione espressa negli assi dell'armatura, convertita negli assi a riposo dell'osso."""
    rest = arm_ob.data.bones[bname].matrix_local.to_quaternion()
    return rest.inverted() @ q_arm @ rest


def bake_action(arm_ob, name, frames, pose_fn):
    """Crea un'azione chiave per chiave e la mette in una traccia NLA, così l'esportatore la trova."""
    ad = arm_ob.animation_data or arm_ob.animation_data_create()
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    ad.action = act
    for pb in arm_ob.pose.bones:
        pb.rotation_mode = "QUATERNION"
    for f in range(frames + 1):
        phase = f / frames
        for bname, q in pose_fn(phase).items():
            pb = arm_ob.pose.bones[bname]
            pb.rotation_quaternion = rot_arm(arm_ob, bname, q)
            pb.keyframe_insert("rotation_quaternion", frame=f)
    # ciclo chiuso: l'ultimo fotogramma coincide col primo
    track = ad.nla_tracks.new()
    track.name = name
    strip = track.strips.new(name, 0, act)
    strip.action_frame_end = frames
    ad.action = None
    for pb in arm_ob.pose.bones:
        pb.rotation_quaternion = Quaternion()
    return act


def qx(a):
    return Quaternion((1, 0, 0), a)


def qy(a):
    return Quaternion((0, 1, 0), a)


def qz(a):
    return Quaternion((0, 0, 1), a)


def export(objs, path):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_apply=False,
        export_animations=True,
        export_animation_mode="NLA_TRACKS",
        export_force_sampling=True,
        export_frame_step=1,
        export_vertex_color="ACTIVE",
        export_all_vertex_colors=False,
        export_skins=True,
        export_def_bones=True,
        export_morph=False,
        export_yup=True,
        export_texcoords=False,
        # compressione meshopt: sul web basta MeshoptDecoder di three, niente file del decoder Draco
        export_meshopt_compression_enable=True,
        export_meshopt_extension="EXT_meshopt_compression",
    )
    return os.path.getsize(path)


# ---------- Gabbiano reale (Larus argentatus) ----------
# Lunghezza 0,60 m, apertura 1,40 m. Dorso e ali grigio perla, punte nere con specchi bianchi,
# bordo d'uscita bianco, becco giallo con la macchia rossa.

GULL_GREY = srgb(0x9aa6b0)
GULL_WHITE = srgb(0xf4f5f3)
GULL_UNDER = srgb(0xe2e6e8)
GULL_BLACK = srgb(0x17191b)
GULL_BEAK = srgb(0xe8c23a)
GULL_RED = srgb(0xc23a22)
GULL_EYE = srgb(0x0b0b0b)

WING_ROOT, WING_WRIST, WING_TIP = 0.05, 0.31, 0.70


def wing_edges(y):
    """Bordo d'attacco e d'uscita (x) e spessore alla stazione y (sempre positiva)."""
    if y <= WING_WRIST:
        t = (y - WING_ROOT) / (WING_WRIST - WING_ROOT)
        le = 0.045 + 0.03 * math.sin(t * math.pi * 0.5)
        te = -0.135 + 0.025 * t
        th = 0.020 - 0.012 * t
    else:
        t = (y - WING_WRIST) / (WING_TIP - WING_WRIST)
        le = 0.075 - 0.20 * t ** 1.55
        # remiganti primarie: bordo d'uscita a festoni leggeri, la punta si chiude
        te = -0.11 - 0.015 * t + 0.006 * abs(math.sin(t * 28)) * t
        te = min(te, le - 0.004)
        th = 0.008 * (1 - t) + 0.0015
    return le, te, th


def build_wing(bm, side):
    """Ala chiusa a guscio: dorso con curvatura, ventre più piatto. side = +1 o -1 (lato Y)."""
    N, M = 26, 9
    top, bot = [], []
    for i in range(N + 1):
        s = i / N
        y = WING_ROOT + (WING_TIP - WING_ROOT) * (s ** 0.9)
        le, te, th = wing_edges(y)
        c = le - te
        # ala "a gabbiano": braccio un po' alzato, mano appena piegata in giù
        z0 = 0.022 + 0.05 * smooth(0.0, 0.35, y) - 0.06 * smooth(0.32, 0.72, y) * (y - 0.32)
        rt, rb = [], []
        for k in range(M + 1):
            u = k / M  # 0 bordo d'attacco, 1 bordo d'uscita
            u2 = u ** 1.3
            x = le - c * u2
            camber = c * 0.06 * 4 * u2 * (1 - u2)
            prof = th * 2.6 * math.sqrt(max(u2, 0)) * (1 - u2)
            zt = z0 + camber + prof * 0.5
            zb = z0 + camber * 0.5 - prof * 0.35
            if k in (0, M):
                zb = zt = z0 + camber * 0.75
            vt = bm.verts.new((x, side * y, zt))
            rt.append(vt)
            rb.append(vt if k in (0, M) else bm.verts.new((x, side * y, zb)))
        top.append(rt)
        bot.append(rb)
    for i in range(N):
        for k in range(M):
            a, b, c2, d = top[i][k], top[i][k + 1], top[i + 1][k + 1], top[i + 1][k]
            f = (a, d, c2, b) if side > 0 else (a, b, c2, d)
            bm.faces.new(f)
            a, b, c2, d = bot[i][k], bot[i][k + 1], bot[i + 1][k + 1], bot[i + 1][k]
            if len({a, b, c2, d}) == 4:
                f = (a, b, c2, d) if side > 0 else (a, d, c2, b)
                bm.faces.new(f)
            else:
                bm.faces.new([v for v in (a, b, c2, d)][:3])
    # chiusura alla radice (dentro il corpo) e alla punta
    root = top[0] + list(reversed(bot[0][1:-1]))
    bm.faces.new(root)
    tip = top[N] + list(reversed(bot[N][1:-1]))
    bm.faces.new(tip)


def gull_color(co):
    x, y, z = co
    ay = abs(y)
    if ay > WING_ROOT + 0.01:
        le, te, th = wing_edges(ay)
        c = max(le - te, 1e-4)
        u = (le - x) / c
        # dorso o ventre: si guarda la quota rispetto alla linea media dell'ala
        z0 = 0.022 + 0.05 * smooth(0.0, 0.35, ay) - 0.06 * smooth(0.32, 0.72, ay) * (ay - 0.32)
        upper = z >= z0 + c * 0.03 * 4 * u * (1 - u) - 1e-4
        t_out = (ay - WING_WRIST) / (WING_TIP - WING_WRIST)
        black = smooth(0.44, 0.54, t_out)
        # specchio bianco vicino alla punta e apice bianco
        mirror = smooth(0.80, 0.84, t_out) * (1 - smooth(0.90, 0.94, t_out)) * smooth(0.25, 0.35, u) * (1 - smooth(0.7, 0.8, u))
        apex = smooth(0.975, 0.995, t_out)
        if upper:
            col = GULL_GREY.lerp(GULL_WHITE, smooth(0.80, 0.95, u) * (1 - black))  # bordo d'uscita bianco
            col = col.lerp(GULL_BLACK, black)
        else:
            col = GULL_UNDER.lerp(GULL_GREY, 0.25 * smooth(0.3, 0.6, t_out))
            col = col.lerp(GULL_BLACK, black * smooth(0.62, 0.72, t_out))
        col = col.lerp(GULL_WHITE, max(mirror, apex))
        return col
    # corpo
    col = GULL_WHITE.copy()
    # mantello grigio sul dorso fra le ali
    mantle = smooth(0.035, 0.07, z) * smooth(-0.2, -0.12, x) * (1 - smooth(0.04, 0.1, x))
    col = col.lerp(GULL_GREY, mantle)
    if x > 0.302:
        col = GULL_BEAK.copy()
        # macchia rossa sulla mandibola, vicino all'angolo gonidale
        if 0.338 < x < 0.37 and z < 0.016:
            col = GULL_RED.copy()
    return col


def build_gull():
    bm = bmesh.new()
    sections = [
        (-0.335, 0.062, 0.003, 0.012),   # punta della coda, piatta e larga
        (-0.29, 0.058, 0.007, 0.010),
        (-0.235, 0.048, 0.022, 0.006),
        (-0.16, 0.064, 0.050, 0.000),
        (-0.07, 0.077, 0.068, -0.006),
        (0.02, 0.078, 0.070, -0.004),
        (0.09, 0.066, 0.062, 0.004),
        (0.145, 0.047, 0.047, 0.018),    # collo
        (0.19, 0.041, 0.044, 0.030),
        (0.235, 0.043, 0.046, 0.034),    # testa
        (0.275, 0.034, 0.036, 0.032),
        (0.300, 0.016, 0.019, 0.026),    # base del becco
        (0.330, 0.0105, 0.0135, 0.023),
        (0.355, 0.008, 0.0125, 0.019),   # angolo gonidale
        (0.372, 0.005, 0.008, 0.012),
        (0.380, 0.0018, 0.003, 0.006),   # punta a uncino
    ]
    loft(bm, sections, ring=14, flat_bottom=0.15)
    build_wing(bm, 1)
    build_wing(bm, -1)
    body = finalize("Gull", bm, subdiv=1)
    paint(body, gull_color)
    # occhi: piccole sfere scure, lucide come vere
    eyes = []
    for s in (1, -1):
        ebm = bmesh.new()
        bmesh.ops.create_uvsphere(ebm, u_segments=8, v_segments=6, radius=0.0065)
        bmesh.ops.translate(ebm, verts=ebm.verts, vec=(0.262, s * 0.0335, 0.046))
        eo = finalize("Eye", ebm, subdiv=0)
        paint(eo, lambda co: GULL_EYE)
        eyes.append(eo)
    bpy.ops.object.select_all(action="DESELECT")
    for o in [body] + eyes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.join()
    body.data.materials.append(vertex_material("Gull", 0.82))

    arm = rig(
        "GullRig",
        [
            ("Root", (-0.06, 0, 0), (0.10, 0, 0), None),
            ("Wing1.L", (0.0, WING_ROOT, 0.022), (0.0, WING_WRIST, 0.04), "Root"),
            ("Wing2.L", (0.0, WING_WRIST, 0.04), (-0.08, WING_TIP, 0.02), "Wing1.L"),
            ("Wing1.R", (0.0, -WING_ROOT, 0.022), (0.0, -WING_WRIST, 0.04), "Root"),
            ("Wing2.R", (0.0, -WING_WRIST, 0.04), (-0.08, -WING_TIP, 0.02), "Wing1.R"),
            ("Tail", (-0.20, 0, 0.006), (-0.33, 0, 0.012), "Root"),
            ("Head", (0.13, 0, 0.015), (0.27, 0, 0.034), "Root"),
        ],
    )

    def weights(co):
        x, y, z = co
        ay = abs(y)
        sfx = ".L" if y > 0 else ".R"
        w2 = smooth(WING_WRIST - 0.05, WING_WRIST + 0.04, ay)
        w1 = smooth(WING_ROOT - 0.005, WING_ROOT + 0.07, ay) * (1 - w2)
        rest = max(0.0, 1 - w1 - w2)
        tail = smooth(-0.19, -0.25, x) * rest
        head = smooth(0.12, 0.17, x) * rest
        return {"Wing1" + sfx: w1, "Wing2" + sfx: w2, "Tail": tail, "Head": head, "Root": rest - tail - head}

    skin(body, arm, weights)

    def wings(a1, a2, sweep, twist):
        """Angoli per il lato sinistro (+Y); il destro è speculare."""
        out = {}
        for s, sfx in ((1, ".L"), (-1, ".R")):
            out["Wing1" + sfx] = qx(s * a1) @ qy(s * twist)
            out["Wing2" + sfx] = qz(s * sweep) @ qx(s * a2) @ qy(s * twist * 1.6)
        return out

    def flap(p):
        # battito: giù veloce e potente, su con la mano piegata indietro (remiganti che si aprono)
        w = math.tau * p
        a1 = 0.12 + 0.62 * math.cos(w)
        a2 = 0.30 * math.cos(w - 0.75)
        up = max(0.0, -math.sin(w))
        sweep = 0.10 + 0.42 * up
        twist = -0.12 * math.sin(w)
        pose = wings(a1, a2, sweep, twist)
        pose["Tail"] = qy(0.05 * math.sin(w))
        pose["Head"] = qy(-0.04 * math.sin(w))  # la testa compensa il corpo e resta ferma
        pose["Root"] = Quaternion()
        return pose

    def glide(p):
        # planata: ala a gabbiano, piccole correzioni di assetto
        w = math.tau * p
        pose = wings(0.10 + 0.03 * math.sin(w), -0.16 + 0.03 * math.sin(w + 1.2), 0.16 + 0.02 * math.sin(w + 0.4), 0.02 * math.sin(w))
        pose["Tail"] = qy(0.03 * math.sin(w + 0.5)) @ qx(0.05 * math.sin(w * 0.5 + 0.3))
        pose["Head"] = qz(0.08 * math.sin(w)) @ qy(0.05)  # si guarda attorno
        pose["Root"] = Quaternion()
        return pose

    bake_action(arm, "Flap", 12, flap)  # 0,4 s: 2,5 battiti al secondo, come un gabbiano reale
    bake_action(arm, "Glide", 60, glide)
    return arm, body


def main():
    clean_scene()
    arm, body = build_gull()
    s1 = export([arm, body], os.path.join(OUT, "gull.glb"))
    print("gabbiano", len(body.data.polygons), "facce", s1, "byte")


main()
