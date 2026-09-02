import { tsImport } from "tsx/esm/api";
import { UsageError } from "../errors.js";

export async function loadFixtureModule<T>(absolutePath: string): Promise<T> {
  try {
    const module = await tsImport(absolutePath, import.meta.url);
    return (module as { default: T }).default;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new UsageError(`Failed to load ${absolutePath}: ${message}`);
  }
}
