const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

/** 同源静态站及API反向代理，真实请求转发到隔离FastAPI，不替换接口响应。 */
exports.startSite = async (endpoint, records, beforeApi = async () => {}) => {
  const root = path.resolve(__dirname, "../dist"), target = new URL(endpoint);
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, "http://localhost");
    if (url.pathname.startsWith("/api/v1/")) {
      const item = { path: url.pathname, method: request.method, hasBearer: /^Bearer /.test(request.headers.authorization ?? ""),
        version: url.searchParams.get("version"), status: null };
      records.push(item);
      // 可选屏障仅延迟真实请求转发，供验证在途编辑／切页竞态，不替换响应。
      await beforeApi(item);
      if (request.aborted || response.destroyed) return;
      const upstream = http.request({ host: target.hostname, port: target.port, method: request.method, path: request.url,
        headers: { ...request.headers, host: target.host } }, (result) => {
        item.status = result.statusCode; response.writeHead(result.statusCode, result.headers); result.pipe(response);
      });
      upstream.on("error", () => {
        if (response.destroyed || response.writableEnded) return;
        if (!response.headersSent) response.writeHead(503).end(); else response.destroy();
      });
      request.on("aborted", () => upstream.destroy());
      response.on("close", () => { if (!response.writableEnded) upstream.destroy(); });
      request.pipe(upstream); return;
    }
    let pathname; try { pathname = decodeURIComponent(url.pathname); } catch { response.writeHead(400).end(); return; }
    const file = path.resolve(root, pathname === "/" ? "index.html" : "." + pathname);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { response.writeHead(404).end(); return; }
    const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".jpg": "image/jpeg", ".txt": "text/plain; charset=utf-8" };
    response.writeHead(200, { "Content-Type": types[path.extname(file)] ?? "application/octet-stream", "Cache-Control": "no-store" });
    fs.createReadStream(file).pipe(response);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { origin: "http://127.0.0.1:" + server.address().port, close: () => new Promise((resolve) => server.close(resolve)) };
};
