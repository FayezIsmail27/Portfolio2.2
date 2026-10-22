"""Turn the robot CAD files into the small glTF models the site loads.

    pip install cascadio trimesh
    python3 tools/cad/build.py scout "Scout Mini.step"
    python3 tools/cad/build.py fgc "prototype 6.0 v13.step"
    python3 tools/cad/build.py qkrt "Assembly 1.step"      # the Hero robot, exported from Onshape as STEP

Each run writes models/<name>.glb (close up) and models/<name>-lo.glb (parade), simplified and
compressed with gltfpack through npx, so Node has to be installed too.

Site axes: meters, forward +X, up +Y, right +Z, ground at y = 0. The files carry no normals;
the site rebuilds them when it loads, which keeps the downloads small.
"""
import collections, os, re, subprocess, sys, tempfile
import numpy as np
import trimesh
import cascadio

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def step_to_parts(step, tol):
    """Mesh a STEP file and return its parts in world space: name, color, vertices, faces.
    Meshing a big assembly takes minutes, so the result is cached in the temp folder while you tune the rules."""
    import hashlib, pickle
    st = os.stat(step)
    key = hashlib.sha1(f'{os.path.abspath(step)}|{st.st_size}|{st.st_mtime}|{tol}'.encode()).hexdigest()[:16]
    cache = os.path.join(tempfile.gettempdir(), f'cad-parts-{key}.pkl')
    if os.path.exists(cache):
        with open(cache, 'rb') as fh:
            return pickle.load(fh)
    parts = _mesh(step, tol)
    with open(cache, 'wb') as fh:
        pickle.dump(parts, fh, protocol=4)
    return parts


def _mesh(step, tol):
    with tempfile.TemporaryDirectory() as tmp:
        raw = os.path.join(tmp, 'raw.glb')
        cascadio.step_to_glb(step, raw, tol_linear=tol, tol_angular=0.6, tol_relative=False, merge_primitives=True, use_parallel=True)
        sc = trimesh.load(raw, force='scene')
    parents = sc.graph.transforms.parents
    parts = []
    for node in sc.graph.nodes_geometry:
        T, geom = sc.graph[node]
        m = sc.geometry[geom]
        col = (200, 200, 200)
        try:
            col = tuple(int(c) for c in m.visual.material.baseColorFactor[:3])
        except Exception:
            pass
        # the names of the sub-assemblies it sits in, outermost first
        path, p = [], parents.get(node)
        while p and p != sc.graph.base_frame:
            path.insert(0, p)
            p = parents.get(p)
        # single precision on purpose: it snaps the tiny gaps between neighboring faces shut, so the simplifier sees one surface
        parts.append({'name': node, 'path': path, 'col': col, 'v': trimesh.transform_points(m.vertices, T).astype(np.float32), 'f': np.asarray(m.faces)})
    return parts


def write(groups, origins, colors, out):
    """groups: {(node, material): [(vertices, faces), ...]} -> GLB with one parent node per group."""
    sc = trimesh.Scene()
    for g in sorted({g for g, _ in groups}):
        T = np.eye(4)
        if g in origins:
            T[:3, 3] = origins[g]
        sc.graph.update(frame_to=g, frame_from=sc.graph.base_frame, matrix=T)
    total = 0
    for (g, mat), lst in sorted(groups.items()):
        vs, fs, n = [], [], 0
        for v, f in lst:
            vs.append(v); fs.append(f + n); n += len(v)
        m = trimesh.Trimesh(np.concatenate(vs) - origins.get(g, np.zeros(3)), np.concatenate(fs), process=True)
        m.merge_vertices()
        m.remove_unreferenced_vertices()
        m.visual = trimesh.visual.TextureVisuals(material=trimesh.visual.material.PBRMaterial(
            name=mat, baseColorFactor=list(colors[mat]) + [255], metallicFactor=0.0, roughnessFactor=0.6))
        sc.add_geometry(m, geom_name=f'{g}_{mat}', node_name=f'{g}_{mat}', parent_node_name=g)
        total += len(m.faces)
    with open(out, 'wb') as fh:
        fh.write(trimesh.exchange.gltf.export_glb(sc, include_normals=False))
    print(f'{total} faces before simplifying')


# How far each copy may drift from the CAD, as a share of the part's size. The close up stays within
# about the meshing tolerance, so it looks like the CAD itself; the parade copy is seen tiny.
DETAIL = {'scout': (0.0008, 0.015), 'fgc': (0.0015, 0.015), 'qkrt': (0.0008, 0.015)}


def pack(pre, name):
    """Simplify with an error limit, keep the named parts, compress."""
    os.makedirs(os.path.join(ROOT, 'models'), exist_ok=True)
    hi, lo = DETAIL[name]
    for suffix, err in [('', hi), ('-lo', lo)]:
        ratio = 0.001
        out = os.path.join(ROOT, 'models', f'{name}{suffix}.glb')
        subprocess.run(['npx', '--yes', 'gltfpack@0.22.0', '-i', pre, '-o', out, '-si', str(ratio), '-se', str(err), '-kn', '-km', '-cc'], check=True)
        print('wrote', out, os.path.getsize(out) // 1024, 'KB')


# ---------------------------------------------------------------------------------------------
# AgileX Scout Mini base. The payload box on top is built in js/models.js, not here.
# ---------------------------------------------------------------------------------------------
SCOUT_WHEELS = [(0.226, 0.085, 0.226), (0.226, 0.085, -0.226), (-0.226, 0.085, 0.226), (-0.226, 0.085, -0.226)]
SCOUT_COL = {'shell': (236, 235, 230), 'black': (30, 32, 35), 'dark': (52, 55, 60), 'rubber': (22, 23, 25),
             'hub': (178, 36, 30), 'alu': (190, 194, 199), 'red': (190, 40, 32)}
WHITES = {(246, 244, 233), (233, 233, 235), (235, 235, 229)}


def scout_part(c):
    col = c['col']; lo, hi = c['lo'], c['hi']
    x, y, z = (lo + hi) / 2
    ext = hi - lo
    # the side lettering is inlaid in the panel; build_scout presses it flat so it disappears into the panel
    if col in {(90, 90, 90), (235, 235, 229)} and 0.16 < abs(z) < 0.186 and 0.195 < y < 0.226 and -0.09 < x < 0.125 and ext.max() < 0.032:
        return ('base', 'shell', 'flatten')
    if col == (229, 152, 51) or (col == (246, 244, 233) and y > 0.236 and ext.max() < 0.05):
        return ('base', 'shell')
    if col == (8, 11, 78) and y > 0.2:
        return ('base', 'dark')
    if ext.max() < 0.0045:
        return None                                  # screws and other specks
    for i, (wx, wy, wz) in enumerate(SCOUT_WHEELS):
        if np.sign(z) != np.sign(wz):
            continue
        d = np.hypot(x - wx, y - wy)
        inside = ext[0] < 0.176 and ext[1] < 0.176 and 0.165 < abs(z) < 0.275
        if inside and (d < 0.012 or (d < 0.07 and abs(z) > 0.235 and ext.max() < 0.025)):
            if col in {(5, 5, 5), (6, 6, 6)}:
                return (f'wheel{i}', 'rubber')
            return (f'wheel{i}', 'hub' if ext[0] > 0.1 else 'black')   # red rim, black center, like the real ones
    if col == (141, 9, 5):
        return ('base', 'red' if x > 0.2 else 'shell')
    if col in WHITES:
        return ('base', 'shell')
    if col in {(6, 6, 6), (71, 69, 66), (5, 5, 5)}:
        return ('base', 'black')
    if col == (200, 151, 87):
        return ('base', 'black' if ext.max() > 0.1 else 'dark')
    if col in {(147, 69, 1), (206, 107, 4)}:
        return ('base', 'red')
    if col == (90, 90, 90) and ext[0] > 0.3 and ext[2] < 0.05 and y > 0.235:
        return ('base', 'alu')                       # the two mounting rails
    return ('base', 'dark')


def build_scout(parts, pre):
    comps = []
    for p in parts:
        v = np.asarray(p['v'], np.float64)
        v = np.stack([-v[:, 2], v[:, 1] + 0.181, v[:, 0]], 1)     # CAD -Z is the front
        m = trimesh.Trimesh(v, p['f'], process=True)
        m.merge_vertices()
        for c in m.split(only_watertight=False):
            lo, hi = c.bounds
            comps.append({'col': p['col'], 'lo': lo, 'hi': hi, 'v': np.asarray(c.vertices), 'f': np.asarray(c.faces)})
    # the long white strip down each side, as a plane, for pressing the lettering flat
    planes = {}
    for c in comps:
        if c['col'] == (235, 235, 229) and (c['hi'] - c['lo'])[0] > 0.4:
            ctr = c['v'].mean(0)
            normal = np.linalg.svd(c['v'] - ctr)[2][2]
            planes[np.sign(ctr[2])] = (ctr, normal)
    groups = collections.defaultdict(list)
    for c in comps:
        r = scout_part(c)
        if not r:
            continue
        v = c['v']
        if len(r) == 3:
            ctr, normal = planes[np.sign(v[:, 2].mean())]
            v = v - np.outer((v - ctr) @ normal, normal)
            r = r[:2]
        groups[r].append((v, c['f']))
    origins = {f'wheel{i}': np.array(w) for i, w in enumerate(SCOUT_WHEELS)}
    write(groups, origins, SCOUT_COL, pre)


# ---------------------------------------------------------------------------------------------
# FIRST Global robot, with the game's balls
# ---------------------------------------------------------------------------------------------
# only parts buried inside other parts; the screws and nuts you can see stay
FGC_DROP = re.compile(r'HEAT-SET|THREAD-FORMING|SNAP-RING|6704ZZ|6801ZZ|ball bearing|bearing insert|JST-|HD Hex PCB|magnet|'
                      r'Motor dummy|REV-41-1604|REV-41-1608|REV-41-2080|REV-41-160[123]-|REV-31-1387|Switch\.STEP', re.I)
FGC_WHEELS = [(0.16, 0.0455, 0.2195), (0.16, 0.0455, -0.2205), (-0.16, 0.0455, 0.2195), (-0.16, 0.0455, -0.2205)]
FGC_INTAKE = (0.213, 0.17)
FGC_COL = {'alu': (196, 200, 205), 'aluDark': (88, 93, 100), 'black': (28, 30, 33), 'white': (226, 228, 230),
           'panel': (214, 217, 219), 'steel': (150, 155, 160), 'orange': (240, 127, 42), 'ballRed': (182, 38, 30),
           'barrier': (150, 154, 158), 'hubcase': (52, 56, 61)}


def fgc_material(col, name):
    if 'biodiversity' in name: return 'ballRed'
    if 'barrier' in name: return 'barrier'
    if col in {(248, 74, 1), (206, 107, 4)}: return 'orange'
    if col in {(233, 233, 235), (235, 235, 229), (239, 237, 216), (237, 237, 200)}: return 'panel'
    if col in {(212, 212, 212), (151, 163, 218), (255, 255, 255), (200, 200, 200), (152, 164, 220)}: return 'white'
    if col in {(90, 90, 90), (200, 210, 216)}: return 'alu'
    if col == (62, 67, 67): return 'aluDark'
    if max(col) < 60: return 'black'
    return 'steel'


def fgc_group(name, ctr, ext):
    x, y, z = ctr
    if 'biodiversity' in name: return 'ball', None
    if 'barrier' in name: return 'barrier', None
    if 'REV-31-1153' in name: return ('hubR' if z > 0 else 'hubL'), None
    if 'REV-41-1190' in name:
        for i, (wx, wy, wz) in enumerate(FGC_WHEELS):
            if abs(x - wx) < 0.03 and abs(z - wz) < 0.03: return f'wheel{i}', np.array(FGC_WHEELS[i])
    if re.search(r'intake|rev-41-1359', name, re.I) or (abs(x - FGC_INTAKE[0]) < 0.012 and abs(y - FGC_INTAKE[1]) < 0.012 and ext[2] > 0.2):
        return 'intake', np.array([FGC_INTAKE[0], FGC_INTAKE[1], 0.0])
    if x < -0.23 and y > 0.27: return 'arms', None   # the two arms reach back over the big ball
    return 'frame', None


def build_fgc(parts, pre):
    groups = collections.defaultdict(list)
    origins = {}
    for p in parts:
        name = p['name']
        if FGC_DROP.search(name):
            continue                                   # fasteners and parts hidden inside motors
        v = np.asarray(p['v'], np.float64)
        v = np.stack([-v[:, 0], v[:, 2] + 0.037, v[:, 1] + 0.165], 1)   # CAD is Z up with the intake at -X
        lo, hi = v.min(0), v.max(0)
        ext, ctr = hi - lo, (lo + hi) / 2
        if ext.max() < 0.0035 and not re.search(r'intake|1359', name, re.I):
            continue
        g, org = fgc_group(name, ctr, ext)
        if org is not None:
            origins[g] = org
        mat = 'hubcase' if g in ('hubL', 'hubR') else fgc_material(p['col'], name)
        groups[(g, mat)].append((v, p['f']))
    write(groups, origins, FGC_COL, pre)


# ---------------------------------------------------------------------------------------------
# Queen's Knights Robotics Hero robot, from the team's Onshape assembly
# ---------------------------------------------------------------------------------------------
# Onshape exports Z up, with the launcher pointing down +Y and the robot's right side at +X.
QKRT_GROUND = 0.182
QKRT_YAW = np.array([0.0, 0.259, 0.0])        # on the turret's turning axis, at the turntable plate
QKRT_PITCH = np.array([0.101, 0.399, 0.0])    # on the pitch shaft
# parts of the turret that stay put when the launcher tilts: the two side masts and the bearing clamps on them
QKRT_MASTS = re.compile(r'^(Motor side mast|Support Wall Ball Side|bearing clamp (top|bottom))', re.I)
# parts of the yaw bearing that turn with the turntable plate above it
QKRT_TURNS = re.compile(r'^(integration plate|Spur gear \(28 teeth\)|28 teeth gear spacer|inside bearing clamp|Senring)', re.I)
# the team's colors, grouped into the site's materials
QKRT_MATS = [
    ('carbon', {(19, 19, 19), (14, 17, 19)}),
    ('black', {(13, 13, 13), (3, 3, 3), (8, 8, 8), (9, 9, 9), (7, 7, 7), (2, 2, 2), (0, 0, 0), (20, 20, 20), (36, 27, 0), (41, 41, 41), (11, 11, 11)}),
    ('dark', {(55, 55, 55), (54, 54, 54), (53, 53, 53), (45, 23, 3)}),
    ('gunmetal', {(96, 96, 96), (115, 115, 115), (93, 103, 107)}),
    ('steel', {(134, 134, 134), (154, 154, 154), (144, 136, 128), (255, 226, 206), (202, 202, 202)}),
    ('white', {(255, 255, 255)}),
    ('navy', {(11, 30, 116)}),
    ('blue', {(86, 159, 216)}),
    ('orange', {(239, 62, 0), (244, 119, 0), (255, 156, 0), (255, 147, 0)}),
    ('yellow', {(255, 173, 16), (255, 212, 2), (255, 192, 0), (202, 144, 24), (166, 103, 4)}),
    ('ballRed', {(255, 0, 0), (255, 6, 6)}),
    ('green', {(10, 170, 46), (74, 100, 1)}),
]
QKRT_COL = {'carbon': (32, 35, 39), 'black': (27, 29, 32), 'dark': (52, 55, 60), 'gunmetal': (70, 75, 82), 'steel': (154, 160, 166),
            'alu': (176, 181, 188), 'white': (232, 232, 228), 'print': (226, 225, 220), 'navy': (28, 44, 110), 'blue': (61, 127, 196),
            'orange': (232, 92, 24), 'yellow': (232, 186, 48), 'ballRed': (196, 40, 32), 'green': (30, 140, 60), 'roller': (59, 63, 69)}
# printed plastic, though the CAD gives it the same grey as the aluminum
QKRT_PRINT = re.compile(r'^(Hopper|Indexer|hopper cover|Ball stopper|Ball Pivot Guide|front motor shield)', re.I)


def qkrt_material(p, g, area):
    col, name = p['col'], p['name']
    if g.startswith('wheel'):
        if area > 0.02: return 'alu'                   # the two side plates
        if area > 0.002: return 'roller'               # the rollers, and the caps on their ends
        return 'steel'
    if QKRT_PRINT.search(name): return 'print'
    for mat, cols in QKRT_MATS:
        if col in cols: return mat
    return 'alu'                                     # the CAD's default light grey, and plain aluminum


def build_qkrt(parts, pre):
    groups = collections.defaultdict(list)
    origins = {'yaw': QKRT_YAW, 'pitch': QKRT_PITCH}
    wheels = {}
    for p in parts:
        v = np.asarray(p['v'], np.float64)
        v = np.stack([v[:, 1], v[:, 2] + QKRT_GROUND, v[:, 0]], 1)
        lo, hi = v.min(0), v.max(0)
        if (hi - lo).max() < 0.003:
            continue                                   # specks
        path = '/'.join(p['path'])
        name = re.sub(r'_[0-9a-f]{6}$', '', p['name'])
        if 'Mecanum_Wheel' in path:
            sec = re.search(r'Infantry_motor_section_\w+_0\.4 <\d>', path).group(0)
            wheels.setdefault(sec, []).append((p, v))
            continue
        if 'Battery_asmbly' in path: g = 'power'
        elif 'Armour Module' in path:
            c = (lo + hi) / 2
            g = 'armorF' if c[0] > 0.2 else 'armorB' if c[0] < -0.2 else 'armorR' if c[2] > 0 else 'armorL'
        elif 'Turret Assembly' in path: g = 'yaw' if QKRT_MASTS.search(name) else 'pitch'
        elif 'Main assembly' in path: g = 'yaw' if QKRT_TURNS.search(name) else 'base'
        elif 'Hero Base' in path: g = 'base'
        else: g = 'yaw'                                # everything else rides on the turntable
        f = p['f']
        area = 0.5 * np.linalg.norm(np.cross(v[f[:, 1]] - v[f[:, 0]], v[f[:, 2]] - v[f[:, 0]]), axis=1).sum()
        groups[(g, qkrt_material(p, g, area))].append((v, f))
    # number the wheels like the rest of the site: front right, front left, back right, back left
    for sec, lst in wheels.items():
        allv = np.concatenate([v for _, v in lst])
        c = (allv.min(0) + allv.max(0)) / 2
        i = (0 if c[0] > 0 else 2) + (0 if c[2] > 0 else 1)
        origins[f'wheel{i}'] = c
        for p, v in lst:
            f = p['f']
            area = 0.5 * np.linalg.norm(np.cross(v[f[:, 1]] - v[f[:, 0]], v[f[:, 2]] - v[f[:, 0]]), axis=1).sum()
            groups[(f'wheel{i}', qkrt_material(p, f'wheel{i}', area))].append((v, f))
    write(groups, origins, QKRT_COL, pre)


BUILDERS = {'scout': (build_scout, 0.5), 'fgc': (build_fgc, 0.6), 'qkrt': (build_qkrt, 0.5)}

if __name__ == '__main__':
    if len(sys.argv) != 3 or sys.argv[1] not in BUILDERS:
        sys.exit(__doc__)
    which, step = sys.argv[1], sys.argv[2]
    build, tol = BUILDERS[which]
    parts = step_to_parts(step, tol)
    with tempfile.TemporaryDirectory() as tmp:
        pre = os.path.join(tmp, which + '.glb')
        build(parts, pre)
        pack(pre, which)
