const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const {attachOnlineServer, handleOnlineHttp, initializeDatabase} = require("./online-server");

const root = __dirname;
const port = Number(process.env.PORT || 4173);
const clients = new Set();
const ignoredDirectories = new Set([".git", ".idea", "node_modules"]);
const watchedExtensions = new Set([
  ".html", ".css", ".js", ".json",
  ".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".ico",
  ".wav", ".mp3", ".ogg", ".mp4"
]);
const restartFiles = ["dev-server.js", "online-server.js", "server.js", "package.json", "package-lock.json"];
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".mp4": "video/mp4"
};

const reloadClient = `<script>
(() => {
  const events = new EventSource("/__dev_reload");
  events.addEventListener("reload", () => location.reload());
})();
</script>`;

function projectSignature(directory = root, entries = []) {
  for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
    if (item.isDirectory() && ignoredDirectories.has(item.name)) continue;
    const absolute = path.join(directory, item.name);
    if (item.isDirectory()) {
      projectSignature(absolute, entries);
      continue;
    }
    if (!watchedExtensions.has(path.extname(item.name).toLowerCase())) continue;
    const stats = fs.statSync(absolute);
    entries.push(`${path.relative(root, absolute)}:${stats.size}:${stats.mtimeMs}`);
  }
  return entries.sort().join("|");
}

function broadcastReload() {
  const message = `event: reload\ndata: ${Date.now()}\n\n`;
  for (const response of clients) response.write(message);
}

let signature = projectSignature();
let restartSignature = restartFiles.map(file => {
  const stats = fs.statSync(path.join(root, file));
  return `${file}:${stats.size}:${stats.mtimeMs}`;
}).join("|");
setInterval(() => {
  try {
    const nextRestartSignature = restartFiles.map(file => {
      const stats = fs.statSync(path.join(root, file));
      return `${file}:${stats.size}:${stats.mtimeMs}`;
    }).join("|");
    if (nextRestartSignature !== restartSignature) {
      console.log("Серверный код изменён — перезапускаю сервер.");
      process.exit(0);
    }
    const nextSignature = projectSignature();
    if (nextSignature !== signature) {
      signature = nextSignature;
      broadcastReload();
      console.log("Изменения обнаружены — страница обновлена.");
    }
  } catch (error) {
    console.error("Не удалось проверить изменения:", error.message);
  }
}, 450).unref();

const server = http.createServer(async (request, response) => {
  const requestPath = decodeURIComponent(request.url.split("?")[0]);

  try {
    if (await handleOnlineHttp(request, response, requestPath)) return;
  } catch (error) {
    response.writeHead(500, {"Content-Type": "application/json; charset=utf-8"});
    response.end(JSON.stringify({status: "error", message: "Ошибка сервера"}));
    return;
  }

  if (requestPath === "/__dev_reload") {
    response.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive"
    });
    response.write(": connected\n\n");
    clients.add(response);
    request.on("close", () => clients.delete(response));
    return;
  }

  const relative = requestPath === "/" ? "index.html" : requestPath.replace(/^\/+/, "");
  const file = path.resolve(root, relative);
  if (file !== root && !file.startsWith(`${root}${path.sep}`)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  const extension = path.extname(file).toLowerCase();
  if (extension === ".mp4") {
    fs.stat(file, (error, stats) => {
      if (error || !stats.isFile()) {
        response.writeHead(404);
        response.end("Not found");
        return;
      }
      const range = request.headers.range;
      const commonHeaders = {
        "Content-Type": "video/mp4",
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-store"
      };
      if (!range) {
        response.writeHead(200, {...commonHeaders, "Content-Length": stats.size});
        if (request.method === "HEAD") response.end();
        else fs.createReadStream(file).pipe(response);
        return;
      }
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match) {
        response.writeHead(416, {"Content-Range": `bytes */${stats.size}`});
        response.end();
        return;
      }
      const start = match[1] ? Number(match[1]) : 0;
      const end = match[2] ? Math.min(Number(match[2]), stats.size - 1) : stats.size - 1;
      if (start > end || start >= stats.size) {
        response.writeHead(416, {"Content-Range": `bytes */${stats.size}`});
        response.end();
        return;
      }
      response.writeHead(206, {
        ...commonHeaders,
        "Content-Length": end - start + 1,
        "Content-Range": `bytes ${start}-${end}/${stats.size}`
      });
      if (request.method === "HEAD") response.end();
      else fs.createReadStream(file, {start, end}).pipe(response);
    });
    return;
  }

  fs.readFile(file, (error, data) => {
    if (error) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }

    if (extension === ".html") {
      const html = data.toString("utf8");
      data = Buffer.from(
        html.includes("</body>")
          ? html.replace("</body>", `${reloadClient}</body>`)
          : `${html}${reloadClient}`,
        "utf8"
      );
    }

    response.writeHead(200, {
      "Content-Type": types[extension] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    response.end(data);
  });
});

attachOnlineServer(server);
initializeDatabase().then(() => server.listen(port, "0.0.0.0", () => {
  console.log(`Режим разработки: http://localhost:${port}`);
  for (const list of Object.values(os.networkInterfaces())) {
    for (const network of list || []) {
      if (network.family === "IPv4" && !network.internal) {
        console.log(`В локальной сети: http://${network.address}:${port}`);
      }
    }
  }
})).catch(error => {
  console.error("Не удалось запустить сервер:", error);
  process.exit(1);
});
