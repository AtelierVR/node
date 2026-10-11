import UnityPy
import os
import sys
import json
from UnityPy.enums import ClassIDType

# ── Live directives (GitHub-Actions style) ──────────────────────────────────
#
# Everything reported while the analysis runs is written to stdout as a
# `::<name>::<value>` line, so the caller can stream it to the client:
#
#   ::progress::<current> <total> <message…>   progress + what is happening
#                                              (`total` = 0 → indeterminate)
#   ::error::<text>                            fatal error (also exits non-zero)
#   ::result::<json>                           final analysis, on a single line
#
# Lines that are not directives are ignored by the caller, which keeps the
# script usable by hand (only stderr carries noise then).

def emit(name, value):
    """Writes a single directive line, flushed so the caller sees it live."""
    text = str(value).replace("\n", "\\n")
    print("::{}::{}".format(name, text), flush=True)

def progress(current, total, message = None):
    """Reports a step: `current`/`total` items done, and optionally what is going on."""
    value = "{} {}".format(int(current), int(total))
    if message:
        value += " " + str(message)
    emit("progress", value)

def check_unity(path, verbose = False):
    if not os.path.exists(path):
        emit("error", "File not found")
        print("File not found", file=sys.stderr)
        return 1

    progress(0, 0, "Loading bundle")
    try: 
        env = UnityPy.load(path)
    except Exception as e:
        emit("error", "Failed to load unity file: " + str(e))
        print("Failed to load unity file: " + str(e), file=sys.stderr)
        return 2

    try:
        obj = check(env, verbose)
    except Exception as e:
        emit("error", "Failed to analyze unity file: " + str(e))
        print("Failed to analyze unity file: " + str(e), file=sys.stderr)
        return 3

    if obj is None:
        emit("error", "Object not found")
        print("Object not found", file=sys.stderr)
        return 5
    elif isinstance(obj, int):
        return obj

    emit("result", json.dumps(obj))

    return 0

def check(env: UnityPy.Environment, verbose: bool):
    objects = {}
    platforms = []
    
    # Types d'objets autorisés pour éviter les éléments trop lourds
    allowed_types = [
        ClassIDType.MonoBehaviour,
        ClassIDType.GameObject,
        ClassIDType.Transform,
        ClassIDType.MonoScript
    ]

    entries = list(env.objects)
    total = len(entries)
    # Report roughly every 2% of the objects — the caller keeps the percentage
    # and the last message, no need to describe every single object.
    step = max(1, total // 40)
    progress(0, total, "Scanning {} objects".format(total))

    # Collect various asset types
    for index, obj in enumerate(entries):
        try:
            if obj.platform not in platforms:
                platforms.append(obj.platform)
        except Exception:
            pass
            
        if obj.type.name not in objects:
            objects[obj.type.name] = []
            if verbose:
                print(f"Found new object type: {obj.type.name}", file=sys.stderr)

        if total > 0 and index % step == 0:
            progress(index, total)

        if obj.type not in allowed_types:
            objects[obj.type.name].append({"path_id": obj.path_id, "raw_tree": None})
            continue

        try:
            tree = obj.read_typetree()
            raw_tree = {
                k: str(v) if not isinstance(v, (dict, list, str, int, float, bool, type(None))) else v 
                for k, v in tree.items()
            }
        except Exception as e:
            if verbose:
                print(f"Failed to read typetree for {obj.type.name} (path_id={obj.path_id}): {e}", file=sys.stderr)
            raw_tree = None

        objects[obj.type.name].append({
            "path_id": obj.path_id,
            "raw_tree": raw_tree,
        })

    progress(total, total, "Bundle analyzed")

    return {
        "name": env.file.name,
        "engine": "unity",
        "version": env.file.version_engine,
        "platform": platforms[0] if platforms else "unknown",
        "data": objects
    }

if __name__ == "__main__":
    argv = sys.argv

    if len(argv) < 2:
        print("Usage: python assetbundle.py <path>", file=sys.stderr)
        sys.exit(1)
        
    code = check_unity(argv[1], argv[2] if len(argv) > 2 else False)
    if code != 0:
        print("Failed with code: " + str(code), file=sys.stderr)
    
    sys.exit(code)
