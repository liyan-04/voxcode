import { createServer as httpServer } from "node:http";
import { ApiError, createService } from "./service.mjs";
import { codexAvailable } from "./codex.mjs";
export function createServer(options) {
  const service = options.service ?? createService(options);
  const send = (res, status, value) => {
    res.writeHead(status, {
      "content-type": "application/json",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    });
    res.end(JSON.stringify(value));
  };
  const server = httpServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      if (req.method === "GET" && url.pathname === "/api/health")
        return send(res, 200, {
          name: "VoxCode",
          version: "0.1.0",
          codexAvailable: codexAvailable(),
          voiceConfigured: !!options.voiceHandler,
        });
      let body;
      const read = async () => {
        let data = "";
        for await (const chunk of req) {
          data += chunk;
          if (Buffer.byteLength(data) > 65536)
            throw new ApiError(400, "invalid");
        }
        try {
          return JSON.parse(data);
        } catch {
          throw new ApiError(400, "invalid");
        }
      };
      if (req.method === "POST" && url.pathname === "/api/pair") {
        body = await read();
        return send(res, 200, {
          sessionToken: service.pair(body?.code, req.socket.remoteAddress),
        });
      }
      const token = service.authorize(req.headers.authorization);
      if (req.method === "POST" && url.pathname === "/api/unpair") {
        service.revoke(token);
        return send(res, 200, { ok: true });
      }
      if (url.pathname === "/api/settings") {
        if (req.method === "GET") return send(res, 200, service.settings());
        if (req.method === "POST")
          return send(res, 200, service.configure(await read()));
      }
      if (req.method === "GET" && url.pathname === "/api/monitor") {
        const peer = req.socket.remoteAddress;
        if (peer !== "::1" && !/^(::ffff:)?127\./.test(peer ?? ""))
          throw new ApiError(403, "denied");
        return send(res, 200, service.monitor());
      }
      if (url.pathname.startsWith("/api/voice")) {
        if (options.voiceHandler)
          return await options.voiceHandler(req, res, token, service);
        throw new ApiError(503, "unavailable");
      }
      if (url.pathname === "/api/tasks") {
        if (req.method === "GET")
          return send(res, 200, { tasks: service.list() });
        if (req.method === "POST")
          return send(res, 200, {
            task: service.mutate("create", await read()),
          });
      }
      const match = url.pathname.match(
        /^\/api\/tasks\/([^/]+)(?:\/(events|messages|cancel|accept)|\/(approvals|criteria)\/([^/]+))?$/,
      );
      if (!match) throw new ApiError(404, "unknown");
      const [, id, directAction, scopedAction, resourceId] = match;
      const action = directAction ?? scopedAction;
      if (req.method === "GET" && !action)
        return send(res, 200, { task: service.get(id) });
      if (req.method === "GET" && action === "events") {
        const after = Number(url.searchParams.get("after") ?? 0);
        if (!Number.isSafeInteger(after) || after < 0)
          throw new ApiError(400, "invalid");
        return send(res, 200, service.events(id, after));
      }
      if (
        req.method === "POST" &&
        ["messages", "cancel", "accept", "approvals", "criteria"].includes(
          action,
        )
      )
        return send(res, 200, {
          task: service.mutate(
            action === "approvals"
              ? "approval"
              : action === "criteria"
                ? "criterion"
                : action,
            await read(),
            id,
            resourceId,
          ),
        });
      throw new ApiError(404, "unknown");
    } catch (e) {
      send(res, e.status ?? 500, {
        error: {
          code: e.code ?? "internal",
          message: e.status ? e.message : "Internal bridge error",
        },
      });
    }
  });
  return {
    server,
    service,
    async close() {
      await service.close();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
