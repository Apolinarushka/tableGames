const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");

const root = __dirname;
const types = { ".html":"text/html; charset=utf-8", ".css":"text/css; charset=utf-8", ".js":"text/javascript; charset=utf-8" };
const server = http.createServer((req,res)=>{
  const clean = decodeURIComponent(req.url.split("?")[0]);
  const file = path.join(root, clean === "/" ? "index.html" : clean);
  if (!file.startsWith(root)) { res.writeHead(403); return res.end("Forbidden"); }
  fs.readFile(file,(err,data)=>{
    if(err){res.writeHead(404);return res.end("Not found")}
    res.writeHead(200,{"Content-Type":types[path.extname(file)]||"application/octet-stream","Cache-Control":"no-cache"});
    res.end(data);
  });
});
const port = Number(process.env.PORT || 4173);
server.listen(port,"0.0.0.0",()=>{
  console.log(`\nТихий ход запущен: http://localhost:${port}`);
  for(const list of Object.values(os.networkInterfaces())) for(const net of list||[])
    if(net.family==="IPv4"&&!net.internal) console.log(`В локальной сети: http://${net.address}:${port}`);
});
