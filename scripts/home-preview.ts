// Disposable browser-QA server. All accounts/albums live only in memory; no OSS or user DB access.
import { createApp } from "../server/app";
import { passwordHash } from "../server/auth";
import type { Config } from "../server/config";
const config: Config = {
  production:false, origin:"http://localhost:5191", database:":memory:", port:5191,
  region:"oss-cn-hangzhou",endpoint:"",bucket:"",accessKeyId:"",accessKeySecret:"",stsToken:"",
  adminUsername:"",adminPasswordHash:"",inviteCode:"",registrationOpen:true,
  maxBytes:20*1024*1024,maxPhotos:120,trustProxy:false,
};
const {app,db}=createApp(config);
db.prepare("INSERT INTO users VALUES(?,?,?,?)").run("home-preview-user","home-preview",await passwordHash("Home-preview-2026!"),Date.now());
db.prepare("INSERT INTO albums(id,user_id,name,cover_preset,position,created_at,updated_at) VALUES(?,?,?,?,?,?,?)")
  .run("home-preview-album","home-preview-user","那些平凡的日子","meadow",0,new Date().toISOString(),new Date().toISOString());
const server=app.listen(config.port,"127.0.0.1",()=>console.log("Disposable home QA: http://localhost:5191 (in-memory, no OSS)"));
const close=()=>server.close(()=>{db.close();process.exit(0);});
process.on("SIGINT",close);process.on("SIGTERM",close);
