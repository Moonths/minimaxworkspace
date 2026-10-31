import type { RunStatus, RunArtifact } from "@contracts/workbench";
import type { RunRecord } from "@db/schema";

export type SubmitExecutionResult = {
  remoteId?: string;
};

export type SyncExecutionResult = {
  status: RunStatus;
  error?: string;
  outputs?: RunArtifact[];
};

export interface TaskExecutor {
  submit(run: RunRecord): Promise<SubmitExecutionResult>;
  sync(run: RunRecord): Promise<SyncExecutionResult>;
}
