import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import sharp from "sharp";
import { createApp } from "../server/app";
import { openDatabase } from "../server/db";
import { getConfig } from "../server/config";
import type { Storage } from "../server/storage";

test("legacy photos and pending uploads migrate together once without changing object keys",async()=>{
  const dir=await mkdtemp(join(tmpdir(),"album-migration-")),path=join(dir,"db.sqlite");
  let db=new DatabaseSync(path);
  try {
    db.exec(`CREATE TABLE users(id TEXT PRIMARY KEY,username TEXT NOT NULL UNIQUE,password_hash TEXT NOT NULL,created_at INTEGER NOT NULL);
      CREATE TABLE photos(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,name TEXT NOT NULL,object_key TEXT NOT NULL,display_key TEXT NOT NULL,thumb_key TEXT NOT NULL,width INTEGER NOT NULL,height INTEGER NOT NULL,size INTEGER NOT NULL,created_at TEXT NOT NULL);
      CREATE TABLE uploads(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,object_key TEXT NOT NULL UNIQUE,name TEXT NOT NULL,mime TEXT NOT NULL,size INTEGER NOT NULL,sha256 TEXT NOT NULL,expires INTEGER NOT NULL,photo_id TEXT);
      INSERT INTO users VALUES('a','alice','hash',0),('b','bob','hash',0),('c','empty','hash',0);
      INSERT INTO photos VALUES('p','a','photo','original','view','thumb',120,80,999,'2026-09-01');
      INSERT INTO uploads VALUES('u','a','staged','pending','image/jpeg',9,'hash',100,NULL),('v','b','staged-b','pending','image/jpeg',9,'hash',100,NULL);`);
    db.close();db=openDatabase(path);
    const albums=db.prepare("SELECT * FROM albums").all();assert.equal(albums.length,2);
    const photo=db.prepare("SELECT * FROM photos WHERE id='p'").get()!;
    assert.equal(photo.object_key,"original");assert.equal(photo.thumb_key,"thumb");
    assert.equal(photo.album_id,db.prepare("SELECT album_id FROM uploads WHERE id='u'").get()?.album_id);
    assert.notEqual(photo.album_id,db.prepare("SELECT album_id FROM uploads WHERE id='v'").get()?.album_id);
    assert.throws(()=>db.prepare("UPDATE photos SET user_id='b' WHERE id='p'").run(),/ownership/);
    db.close();db=openDatabase(path);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM albums").get()?.n,2);
    assert.equal(db.prepare("SELECT album_id FROM photos WHERE id='p'").get()?.album_id,photo.album_id);
  } finally {db.close();await rm(dir,{recursive:true,force:true});}
});

test("existing album schema gains independent persistent themes without resetting data",async()=>{
  const dir=await mkdtemp(join(tmpdir(),"album-themes-")),path=join(dir,"db.sqlite");
  let db=new DatabaseSync(path);
  try {
    db.exec(`CREATE TABLE users(id TEXT PRIMARY KEY,username TEXT NOT NULL UNIQUE,password_hash TEXT NOT NULL,created_at INTEGER NOT NULL);
      CREATE TABLE albums(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,name TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',cover_preset TEXT NOT NULL DEFAULT 'meadow',cover_photo_id TEXT,cover_x REAL NOT NULL DEFAULT 50,cover_y REAL NOT NULL DEFAULT 50,position INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
      INSERT INTO users VALUES('a','alice','hash',0);
      INSERT INTO albums(id,user_id,name,created_at,updated_at) VALUES('one','a','one','2026-09-13','2026-09-13'),('two','a','two','2026-09-13','2026-09-13');
      PRAGMA user_version=1;`);
    db.close();db=openDatabase(path);
    assert.equal(db.prepare("SELECT space_theme FROM albums WHERE id='one'").get()?.space_theme,"forest");
    db.prepare("UPDATE albums SET space_theme='lake' WHERE id='one'").run();
    assert.throws(()=>db.exec("UPDATE albums SET space_theme='invalid' WHERE id='two'"),/CHECK/);
    db.close();db=openDatabase(path);
    assert.equal(db.prepare("SELECT space_theme FROM albums WHERE id='one'").get()?.space_theme,"lake");
    assert.equal(db.prepare("SELECT space_theme FROM albums WHERE id='two'").get()?.space_theme,"forest");
    assert.equal(db.prepare("SELECT COUNT(*) n FROM albums").get()?.n,2);
  } finally {db.close();await rm(dir,{recursive:true,force:true});}
});

test("album ownership, fixed upload destination, cover validation, order, deletion and durable cleanup",async()=>{
  const objects=new Map<string,{data:Buffer;mime:string}>();let failDelete=false;
  const storage:Storage={
    grant:(key,mime)=>({host:"https://test.invalid",fields:{key,"Content-Type":mime},expiresAt:Date.now()+900000}),
    head:async key=>({size:objects.get(key)!.data.length,mime:objects.get(key)!.mime}),
    get:async key=>objects.get(key)!.data,
    put:async(key,data,mime)=>{objects.set(key,{data,mime});},
    delete:async key=>{if(failDelete)throw new Error("offline");objects.delete(key);},
    read:key=>`https://test.invalid/${key}`,
  };
  const config={...getConfig(),database:":memory:",origin:"http://localhost:5188",production:false,adminPasswordHash:"",bucket:"",registrationOpen:true,maxPhotos:3};
  const {app,db}=createApp(config,storage),server=app.listen(0);
  await new Promise<void>(r=>server.once("listening",r));
  const base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
  const call=async(path:string,cookie="",body?:unknown,method=body===undefined?"GET":"POST")=>{
    const r=await fetch(base+path,{method,headers:{Origin:config.origin,Cookie:cookie,...(body!==undefined?{"Content-Type":"application/json"}:{})},body:body===undefined?undefined:JSON.stringify(body)});
    return {status:r.status,data:await r.json(),cookie:r.headers.get("set-cookie")?.split(";")[0]||""};
  };
  try {
    assert.equal((await call("/api/albums")).status,401);
    const alice=await call("/api/auth/register","",{username:"alice",password:"test-password-123"});
    const bob=await call("/api/auth/register","",{username:"bob",password:"test-password-456"});
    const a=alice.cookie,b=bob.cookie;
    assert.equal((await call("/api/albums",a)).data.albums.length,0);
    assert.equal((await call("/api/albums",a,{name:" "})).status,400);
    assert.equal((await call("/api/albums",a,{name:"x",coverPreset:"../../bad"})).status,400);
    const first=(await call("/api/albums",a,{name:"first",coverPreset:"coast"})).data;
    const second=(await call("/api/albums",a,{name:"second"})).data;
    const other=(await call("/api/albums",b,{name:"private"})).data;
    assert.equal(first.theme,"forest");
    assert.equal((await call(`/api/albums/${first.id}`,a,{theme:"lake"},"PATCH")).data.theme,"lake");
    assert.equal((await call(`/api/albums/${second.id}`,a,{theme:"meadow"},"PATCH")).data.theme,"meadow");
    for(const theme of ["unknown",null,42])
      assert.equal((await call(`/api/albums/${first.id}`,a,{theme},"PATCH")).status,400);
    assert.equal((await call(`/api/albums/${first.id}`,b,{theme:"forest"},"PATCH")).status,404);
    await call(`/api/albums/${first.id}`,a,{name:"renamed"},"PATCH");
    const nextSession=await call("/api/auth/login","",{username:"alice",password:"test-password-123"});
    assert.equal((await call(`/api/albums/${first.id}`,nextSession.cookie)).data.theme,"lake");
    const themes=(await call("/api/albums",nextSession.cookie)).data.albums;
    assert.equal(themes.find((item:{id:string})=>item.id===first.id).theme,"lake");
    assert.equal(themes.find((item:{id:string})=>item.id===second.id).theme,"meadow");
    assert.equal((await call(`/api/albums/${other.id}`,b)).data.theme,"forest");
    for(const path of [`/api/albums/${first.id}`,`/api/albums/${first.id}/photos`])assert.equal((await call(path,b)).status,404);
    assert.equal((await call(`/api/albums/${first.id}`,b,{name:"stolen"},"PATCH")).status,404);
    assert.equal((await call(`/api/albums/${first.id}`,b,{},"DELETE")).status,404);
    const bytes=await sharp({create:{width:20,height:30,channels:3,background:"#aabbcc"}}).jpeg().toBuffer();
    const metadata={name:"photo",mime:"image/jpeg",size:bytes.length,sha256:createHash("sha256").update(bytes).digest("hex")};
    assert.equal((await call("/api/uploads/authorize",a,metadata)).status,400);
    assert.equal((await call("/api/uploads/authorize",a,{...metadata,albumId:other.id})).status,404);
    const grant=(await call("/api/uploads/authorize",a,{...metadata,albumId:first.id})).data;
    objects.set(grant.fields.key,{data:bytes,mime:"image/jpeg"});
    const completed=await call(`/api/uploads/${grant.uploadId}/complete`,a,{albumId:second.id});
    assert.equal(completed.status,201);assert.equal(completed.data.albumId,first.id);
    assert.equal((await call(`/api/albums/${first.id}/photos`,a)).data.photos.length,1);
    assert.equal((await call(`/api/albums/${second.id}/photos`,a)).data.photos.length,0);
    const cover=await call(`/api/albums/${first.id}`,a,{coverPhotoId:completed.data.id,coverX:25,coverY:70},"PATCH");
    assert.equal(cover.status,200);assert.equal(cover.data.coverPhotoId,completed.data.id);assert.equal(cover.data.coverX,25);
    assert.equal(cover.data.theme,"lake");
    assert.equal((await call(`/api/albums/${second.id}`,a,{coverPhotoId:completed.data.id},"PATCH")).status,400);
    assert.equal((await call(`/api/albums/${first.id}`,a,{coverX:101},"PATCH")).status,400);
    await call(`/api/albums/${second.id}/feature`,a,{});
    assert.equal((await call("/api/albums",a)).data.albums[0].id,second.id);
    const pending=(await call("/api/uploads/authorize",a,{...metadata,albumId:first.id})).data;
    objects.set(pending.fields.key,{data:bytes,mime:"image/jpeg"});
    const crossAlbum=await call("/api/uploads/authorize",a,{...metadata,albumId:second.id});
    assert.equal(crossAlbum.status,200);
    assert.equal((await call("/api/uploads/authorize",a,{...metadata,albumId:second.id})).status,429);
    await call(`/api/uploads/${crossAlbum.data.uploadId}/cancel`,a,{});
    failDelete=true;
    assert.equal((await call(`/api/albums/${first.id}`,a,{},"DELETE")).status,200);
    assert.equal((await call(`/api/uploads/${pending.uploadId}/complete`,a,{})).status,404);
    assert.equal((await call(`/api/photos/${completed.data.id}/read`,a)).status,404);
    assert.ok(Number(db.prepare("SELECT COUNT(*) n FROM storage_cleanup").get()?.n)>0);
    assert.equal((await call(`/api/albums/${second.id}`,a)).status,200);
    failDelete=false;await call("/api/albums",a);
    // Allow asynchronous cleanup after the list response.
    for(let i=0;i<30 && Number(db.prepare("SELECT COUNT(*) n FROM storage_cleanup").get()?.n)>0;i++)await new Promise(r=>setTimeout(r,10));
    assert.equal(objects.size,0);
    assert.equal((await call("/api/albums",a)).data.totalPhotos,0);
    assert.equal((await call("/api/albums",b)).data.albums.length,1);
    const again=await call(`/api/albums/${first.id}`,a,{},"DELETE");assert.equal(again.status,404);
  }finally{await new Promise<void>(r=>server.close(()=>r()));db.close();}
});
