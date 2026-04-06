/**
 * HTTP routes for simulation control.
 *
 * Mounted under `/api/sim/*` when `--sim` mode is active. The dev panel
 * uses these to read and update the {@link SimController}.
 *
 * @module
 */

import type { SimController } from "./controller.ts";

export type SimRouteHandler = (req: Request) => Promise<Response> | Response;

/**
 * Create route handlers for sim control endpoints.
 * Returns a map of path patterns to handlers.
 */
export const createSimRoutes = (
  controller: SimController,
): Map<string, SimRouteHandler> => {
  const routes = new Map<string, SimRouteHandler>();

  // GET /api/sim/config — current simulation configuration
  routes.set("GET /api/sim/config", () => {
    return Response.json(controller.snapshot());
  });

  // POST /api/sim/config — update simulation configuration
  routes.set("POST /api/sim/config", async (req: Request) => {
    try {
      const body = await req.json();
      controller.applyConfig(body);
      return Response.json({ ok: true, config: controller.snapshot() });
    } catch {
      return Response.json(
        { ok: false, error: "Invalid JSON" },
        { status: 400 },
      );
    }
  });

  // POST /api/sim/advance — step one transition (when autoAdvance is off)
  routes.set("POST /api/sim/advance", () => {
    controller.advance();
    return Response.json({ ok: true });
  });

  // POST /api/sim/reset — restart the orchestrator loop (keeps config)
  routes.set("POST /api/sim/reset", () => {
    controller.reset();
    return Response.json({ ok: true });
  });

  // POST /api/sim/reset-config — reset config knobs to defaults
  routes.set("POST /api/sim/reset-config", () => {
    controller.resetConfig();
    return Response.json({ ok: true, config: controller.snapshot() });
  });

  return routes;
};

/**
 * Try to match a request against sim routes.
 * Returns the response if matched, undefined otherwise.
 */
export const matchSimRoute = (
  routes: Map<string, SimRouteHandler>,
  req: Request,
): Promise<Response> | Response | undefined => {
  const url = new URL(req.url);
  const key = `${req.method} ${url.pathname}`;
  const handler = routes.get(key);
  return handler?.(req);
};
