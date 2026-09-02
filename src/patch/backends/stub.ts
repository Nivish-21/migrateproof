import type {
  PatchBackend,
  PatchBackendInput,
  PatchBackendResult,
} from "../types.js";

export class StubPatchBackend implements PatchBackend {
  async run(input: PatchBackendInput): Promise<PatchBackendResult> {
    void input;
    return { appliedFiles: [], rawLog: "stub backend: no-op" };
  }
}
