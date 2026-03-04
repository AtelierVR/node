import { AnalyzedAssetBundle } from "../utils/Utils";

interface AnalizedWorldAssetFile {
    platform: string;
    engine: string;
    descriptors: SceneDescriptor[];
}

interface ClassInfo {
    path_id: number;
    namespace: string;
    class: string;
}

enum SpawnType {
    None = 0,
    Select = 1,
    Random = 2,
    Free = 3,
    Sequential = 4
}

enum Platform {
    none = 0,
    windows = 19,
    linux = 24,
    macos = 2,
    android = 13,
    ios = 9,
    visionos = 47,
}

interface SceneDescriptor {
    pid: number;
}

export const Class = {
    "WorldDescriptor": {
        class: "WorldDescriptor",
        namespace: "Nox.CCK.Worlds"
    }
}

interface SubSceneDescriptor extends SceneDescriptor { }

export function analyzeData(data: AnalyzedAssetBundle): Error | AnalizedWorldAssetFile {
    if (data.engine !== 'unity')
        return new Error('Unsupported engine: ' + data.platform);

    let classes = extractClassesInfo(data);
    if (!classes || classes.length === 0)
        return new Error('No classes found in the asset bundle');
    let descriptors: SceneDescriptor[] = [];
    for (const monoBehaviour of data.data.MonoBehaviour || []) {
        if (!monoBehaviour.raw_tree || !monoBehaviour.raw_tree.m_Script || !monoBehaviour.raw_tree.m_Script.m_PathID)
            continue;

        const scriptPathId = monoBehaviour.raw_tree.m_Script.m_PathID;
        const scriptClass = classes.find(c => c.path_id === scriptPathId);
        if (!scriptClass)
            continue;

        if (scriptClass.namespace === Class.WorldDescriptor.namespace && scriptClass.class === Class.WorldDescriptor.class)
            descriptors.push({
                pid: monoBehaviour.path_id
            });

    }

    if (descriptors.length == 0)
        return new Error('Invalid number of descriptors found: ' + descriptors.length);

    return {
        platform: Object.keys(Platform)
            .find(key => Platform[key as keyof typeof Platform] === data.platform)
            || "None",
        engine: data.engine,
        descriptors: descriptors
    };
}

/**
 * Extracts all classes with their namespace, class name, and path_id from MonoScript data
 * @param data The analyzed asset bundle data
 * @returns Array of class information with [m_Namespace, m_ClassName]: path_id mapping
 */
export function extractClassesInfo(data: AnalyzedAssetBundle): ClassInfo[] {
    const classes: ClassInfo[] = [];

    if (!data.data || !data.data.MonoScript)
        return classes;

    for (const monoScript of data.data.MonoScript)
        if (monoScript.raw_tree && monoScript.raw_tree.m_Namespace && monoScript.raw_tree.m_ClassName && monoScript.path_id)
            classes.push({
                path_id: monoScript.path_id,
                namespace: monoScript.raw_tree.m_Namespace,
                class: monoScript.raw_tree.m_ClassName
            });

    return classes;
}