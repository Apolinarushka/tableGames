const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const {attachOnlineServer, handleOnlineHttp, initializeDatabase} = require("./online-server");

const root = __dirname;
const types = { ".html":"text/html; charset=utf-8", ".css":"text/css; charset=utf-8", ".js":"text/javascript; charset=utf-8", ".mp4":"video/mp4" };
const server = http.createServer(async (req,res)=>{
  const clean = decodeURIComponent(req.url.split("?")[0]);
  try {
    if (await handleOnlineHttp(req, res, clean)) return;
  } catch (error) {
    res.writeHead(500, {"Content-Type":"application/json; charset=utf-8"});
    return res.end(JSON.stringify({status:"error", message:"Ошибка сервера"}));
  }
  const file = path.join(root, clean === "/" ? "index.html" : clean);
  if (!file.startsWith(root)) { res.writeHead(403); return res.end("Forbidden"); }
  if(path.extname(file).toLowerCase()===".mp4"){
    fs.stat(file,(error,stats)=>{
      if(error||!stats.isFile()){res.writeHead(404);return res.end("Not found")}
      const range=req.headers.range;
      const common={"Content-Type":"video/mp4","Accept-Ranges":"bytes","Cache-Control":"no-cache"};
      if(!range){
        res.writeHead(200,{...common,"Content-Length":stats.size});
        return req.method==="HEAD"?res.end():fs.createReadStream(file).pipe(res);
      }
      const match=/^bytes=(\d*)-(\d*)$/.exec(range);
      if(!match){res.writeHead(416,{"Content-Range":`bytes */${stats.size}`});return res.end()}
      const start=match[1]?Number(match[1]):0;
      const end=match[2]?Math.min(Number(match[2]),stats.size-1):stats.size-1;
      if(start>end||start>=stats.size){res.writeHead(416,{"Content-Range":`bytes */${stats.size}`});return res.end()}
      res.writeHead(206,{...common,"Content-Length":end-start+1,"Content-Range":`bytes ${start}-${end}/${stats.size}`});
      return req.method==="HEAD"?res.end():fs.createReadStream(file,{start,end}).pipe(res);
    });
    return;
  }
  fs.readFile(file,(err,data)=>{
    if(err){res.writeHead(404);return res.end("Not found")}
    res.writeHead(200,{"Content-Type":types[path.extname(file)]||"application/octet-stream","Cache-Control":"no-cache"});
    res.end(data);
  });
});
const port = Number(process.env.PORT || 4173);
attachOnlineServer(server);
initializeDatabase().then(()=>server.listen(port,"0.0.0.0",()=>{
  console.log(`\nТвой ход запущен: http://localhost:${port}`);
  for(const list of Object.values(os.networkInterfaces())) for(const net of list||[])
    if(net.family==="IPv4"&&!net.internal) console.log(`В локальной сети: http://${net.address}:${port}`);
})).catch(error=>{
  console.error("Не удалось запустить сервер:", error);
  process.exit(1);
});
