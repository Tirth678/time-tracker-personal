import type { NextApiRequest, NextApiResponse } from "next";

import { app } from "../../server";

export const config = {
  api: {
    // Express parses the request body and writes the response itself.
    bodyParser: false,
    externalResolver: true,
  },
  maxDuration: 30,
};

/**
 * Hands every /api/* request to the Express app in /server.
 *
 * Next.js decorates `req` and `res` with its own Express-like helpers
 * (`res.json`, `res.status`, `req.query`, …) as instance properties, which
 * would shadow Express's implementations. They are removed first so the app
 * behaves exactly as it does in the tests, where it runs without Next.js.
 */
export default function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  for (const helper of ["status", "send", "json", "redirect"]) Reflect.deleteProperty(res, helper);
  Reflect.deleteProperty(req, "query");

  return new Promise((resolve) => {
    res.once("finish", resolve);
    res.once("close", resolve);
    app(req, res);
  });
}
