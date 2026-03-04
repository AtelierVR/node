import UnityPy
import os
import sys
import json
from UnityPy.enums import ClassIDType

def check_unity(path, verbose = False):
    if not os.path.exists(path):
        print("File not found")
        return 1
    
    try: 
        env = UnityPy.load(path)
    except Exception as e:
        print("Failed to load unity file: " + str(e))
        return 2

    obj = check(env, verbose)

    if obj is None:
        print("Object not found")
        return 5
    elif isinstance(obj, int):
        return obj
        
    res = json.dumps(obj)
    for i in range(0, len(res), 1024):
        print(res[i:i+1024], end="")

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

    # Collect various asset types
    for obj in env.objects:
        if obj.platform not in platforms:
            platforms.append(obj.platform)
            
        if obj.type.name not in objects:
            objects[obj.type.name] = []
            if verbose:
                print(f"Found new object type: {obj.type.name}")

        if verbose and obj.type.name == "Shader":    
            print(obj)
            print(obj.read_typetree())
            
        objects[obj.type.name].append({
            "path_id": obj.path_id,
            "raw_tree": {
                k: str(v) if not isinstance(v, (dict, list, str, int, float, bool, type(None))) else v 
                for k, v in obj.read_typetree().items()
            } if obj.type in allowed_types else None
        })

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
        print("Usage: python assetbundle.py <path>")
        sys.exit(1)
        
    code = check_unity(argv[1], argv[2] if len(argv) > 2 else False)
    if code != 0:
        print("Failed with code: " + str(code))
    
    sys.exit(code)
