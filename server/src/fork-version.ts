import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type ForkVersion = {
  commitHash: string;
  commitDate: string;
  branch: string;
};

export function readForkVersion(): ForkVersion | null {
  try {
    const dir = path.dirname(fileURLToPath(import.meta.url));
    const filePath = path.resolve(dir, "..", "fork-version.json");
    const raw = fs.readFileSync(filePath, "utf-8");
    const data = JSON.parse(raw);
    if (typeof data.commitHash === "string" && data.commitHash.length > 0) {
      return data as ForkVersion;
    }
    return null;
  } catch {
    return null;
  }
}
