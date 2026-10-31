import { createRouter, publicQuery } from "./middleware";
import { workbenchRouter } from "./workbenchRouter";

export const appRouter = createRouter({
  ping: publicQuery.query(() => ({ ok: true, ts: Date.now() })),
  workbench: workbenchRouter,
});

export type AppRouter = typeof appRouter;
