import {
  bigint,
  index,
  json,
  mysqlEnum,
  mysqlTable,
  serial,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/mysql-core";
import type { ApiWorkflow, RunArtifact } from "@contracts/workbench";

export const workflows = mysqlTable("workflows", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 120 }).notNull(),
  apiJson: json("api_json").$type<ApiWorkflow>().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const runs = mysqlTable(
  "runs",
  {
    id: serial("id").primaryKey(),
    workflowId: bigint("workflow_id", {
      mode: "number",
      unsigned: true,
    }).notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    executor: mysqlEnum("executor", ["mock", "comfyui"]).notNull(),
    status: mysqlEnum("status", [
      "queued",
      "running",
      "succeeded",
      "failed",
    ])
      .notNull()
      .default("queued"),
    workflowSnapshot: json("workflow_snapshot").$type<ApiWorkflow>().notNull(),
    remoteId: varchar("remote_id", { length: 255 }),
    remoteBaseUrl: text("remote_base_url"),
    error: text("error"),
    outputs: json("outputs").$type<RunArtifact[]>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [index("runs_created_at_idx").on(table.createdAt)],
);

export type WorkflowRecord = typeof workflows.$inferSelect;
export type RunRecord = typeof runs.$inferSelect;
export type NewRunRecord = typeof runs.$inferInsert;
