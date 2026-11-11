import fs from "fs";
import path from "path";

const memory = new Map<string, { expires: number; value: unknown }>();

function cacheDir() {
  return process.env.ETF_CACHE_DIR || path.join(process.cwd(), ".data");
}

export function memoryGet<T>(key: string): T | null {
  const hit = memory.get(key);
  if (!hit) return null;
  if (hit.expires && Date.now() > hit.expires) {
    memory.delete(key);
    return null;
  }
  return hit.value as T;
}

export function memorySet<T>(key: string, value: T, ttlMs: number) {
  memory.set(key, { value, expires: Date.now() + ttlMs });
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
