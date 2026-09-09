import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { UsageError } from "../../errors.js";

const PYTHON_SCRIPT = fileURLToPath(
  new URL("../../../py/impact_analysis.py", import.meta.url),
);

export interface PythonBridgeInput {
  changedEndpoint: string;
  sourceRoot: string;
}

export interface PythonBridgeOutput {
  callSites: { file: string; line: number; function: string }[];
}

async function checkPython3Present(): Promise<void> {
  await new Promise<void>((res, rej) => {
    execFile("python3", ["--version"], (error) => {
      if (error) {
        rej(error);
        return;
      }
      res();
    });
  }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") {
      throw new UsageError(
        "python3 not found on PATH — required for Python impact analysis",
      );
    }
    throw error;
  });
}

export async function runPythonBridge(
  input: PythonBridgeInput,
): Promise<PythonBridgeOutput> {
  if (!existsSync(input.sourceRoot)) {
    throw new UsageError(`sourceRoot does not exist: ${input.sourceRoot}`);
  }

  await checkPython3Present();

  const payload = JSON.stringify({
    command: "impact-analysis",
    changedEndpoint: input.changedEndpoint,
    sourceRoot: resolve(input.sourceRoot),
  });

  const { stdout } = await new Promise<{ stdout: string; stderr: string }>(
    (res, rej) => {
      const child = execFile(
        "python3",
        [PYTHON_SCRIPT],
        {
          cwd: process.cwd(),
          timeout: 30_000,
          maxBuffer: 10 * 1024 * 1024,
        },
        (error, stdout, stderr) => {
          if (error) {
            rej(Object.assign(error, { stdout, stderr }));
            return;
          }
          if (stderr) {
            console.warn(`python3 impact-analysis (non-fatal): ${stderr}`);
          }
          res({ stdout, stderr });
        },
      );
      child.stdin?.write(payload);
      child.stdin?.end();
    },
  ).catch(
    (error: NodeJS.ErrnoException & { stdout?: string; stderr?: string }) => {
      if (error.code === "ENOENT") {
        throw new UsageError(
          "python3 not found on PATH — required for Python impact analysis",
        );
      }
      throw new UsageError(
        `python3 impact-analysis failed: ${error.stderr ?? error.message}`,
      );
    },
  );

  try {
    return JSON.parse(stdout) as PythonBridgeOutput;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new UsageError(
      `python3 impact-analysis returned invalid JSON: ${message}; raw output (first 200 chars): ${stdout.slice(0, 200)}`,
    );
  }
}
