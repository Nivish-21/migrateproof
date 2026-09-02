import { tsImport } from "tsx/esm/api";
import { UsageError } from "../errors.js";

export async function loadFixtureModule<T>(absolutePath: string): Promise<T> {
  try {
    const module = await tsImport(absolutePath, import.meta.url);
    const defaultExport = (module as { default: T | { default: T } }).default;
    if (
      typeof defaultExport === "object" &&
      defaultExport !== null &&
      "default" in defaultExport
    ) {
      return defaultExport.default;
    }
    return defaultExport;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new UsageError(`Failed to load ${absolutePath}: ${message}`);
  }
}
