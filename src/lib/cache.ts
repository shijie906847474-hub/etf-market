import fs from "fs";
import path from "path";

const memory = new Map<string, { expires: number; value: unknown }>();

function cacheDir() {
  return process.env.ETF_CACHE_DIR || path.join(process.cwd(), ".data");
}

export function memoryGet<T>(key: string): T | null {
  const hit = memory.get(key);
  if (!hit) return null;
  if (hit.expires && hit.expires > 0 && Date.now() > hit.expires) {
    memory.delete(key);
    return null;
  }
  return hit.value as T;
}

export function memorySet<T>(key: string, value: T, ttlMs = 0) {
  memory.set(key, { value, expires: ttlMs > 0 ? Date.now() + ttlMs : 0 });
}

export function memoryDelete(key: string) {
  memory.delete(key);
}

export function memoryDeleteByPrefix(prefix: string) {
  for (const key of [...memory.keys()]) {
    if (key.startsWith(prefix)) memory.delete(key);
  }
}


export function readJsonFile<T>(name: string): T | null {
  try {
    const p = path.join(cacheDir(), name);
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, "utf8")) as T;
  } catch {
    return null;
  }
}

export function writeJsonFile(name: string, value: unknown) {
  try {
    const dir = cacheDir();
    fs.mkdirSync(dir, { recursive: true });
    const tmp = path.join(dir, `${name}.tmp`);
    fs.writeFileSync(tmp, JSON.stringify(value));
    fs.renameSync(tmp, path.join(dir, name));
  } catch {
    // Vercel / read-only FS: keep memory cache only
  }
}

export function listCacheFiles(prefix = ""): { name: string; size: number; mtimeMs: number }[] {
  try {
    const dir = cacheDir();
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir)
      .filter((name) => name.startsWith(prefix) && name.endsWith(".json") && !name.endsWith(".tmp"))
      .map((name) => {
        const st = fs.statSync(path.join(dir, name));
        return { name, size: st.size, mtimeMs: st.mtimeMs };
      });
  } catch {
    return [];
  }
}

export function deleteCacheFile(name: string): boolean {
  try {
    const p = path.join(cacheDir(), name);
    if (!fs.existsSync(p)) return false;
    fs.unlinkSync(p);
    return true;
  } catch {
    return false;
  }
}
