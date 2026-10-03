"""Rigenera lo Swan 651 ed esporta GLB (web) e FBX (collega 3D), poi salva il .blend.

Da riga di comando, senza aprire Blender:
    /Applications/Blender.app/Contents/MacOS/Blender -b models/swan651.blend \
        --python scripts/blender/build_and_export.py

Oppure dentro Blender (anche via MCP) con exec(open(questo_file).read()).
"""
import bpy

REPO = "/Users/bilalmessaoudi/Desktop/coding/nautor-swan"
BASE = REPO + "/scripts/blender/"

ns = {}
for f in ("swan651_hull.py", "swan651_rig.py", "swan651_interior.py"):
    exec(open(BASE + f).read(), ns)

# Si esportano solo le due collezioni della barca, senza le tavole di riferimento nascoste
bpy.ops.object.select_all(action="DESELECT")
exported = []
for cname in ("Swan651", "Swan651_Interior"):
    for o in bpy.data.collections[cname].all_objects:
        if o.name.startswith("Ref_") or o.type != "MESH":
            continue
        o.hide_set(False)
        o.select_set(True)
        exported.append(o.name)
bpy.context.view_layer.objects.active = bpy.data.objects[exported[0]]

bpy.ops.export_scene.gltf(
    filepath=REPO + "/models/swan651.glb",
    export_format="GLB",
    use_selection=True,
    export_apply=True,
    export_morph=True,
)
bpy.ops.export_scene.fbx(
    filepath=REPO + "/models/swan651.fbx",
    use_selection=True,
    embed_textures=True,
    path_mode="COPY",
    axis_up="Y",
    axis_forward="-Z",
)
bpy.ops.wm.save_mainfile()
print("EXPORT_OK", len(exported), sorted(exported))
