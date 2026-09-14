import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { Aperture, ArrowDown, ArrowRight, BookOpen, ChevronLeft, ChevronRight, Check, ImagePlus, LoaderCircle, LogOut, Pencil, Pin, Plus, Search, Trash2 } from "lucide-react";
import type { Album, Photo } from "../../shared/types";
import { ALBUM_COVERS, presetCover } from "../../shared/covers";
import { api, type AppConfig } from "../upload/client";
import { AlbumDialog } from "./AlbumDialog";

export type LocalCover = { photoId: string; x: number; y: number };
export type AlbumEntry = { album: Album; rect: { x: number; y: number; width: number; height: number } };
export function BookArtwork({ album }: { album: Pick<Album,"name"|"coverUrl"|"coverX"|"coverY"> }) {
  return <>
    <span className="book-pages" aria-hidden="true"/>
    <span className="book-inside" aria-hidden="true"><img src={album.coverUrl} alt="" draggable={false} style={{objectPosition:`${album.coverX}% ${album.coverY}%`}}/><small>让回忆，在这里慢慢展开。</small></span>
    <span className="book-face">
      <img className="book-photo" src={album.coverUrl} alt="" draggable={false}
        style={{objectPosition:`${album.coverX}% ${album.coverY}%`}}
        onError={e => { if (!e.currentTarget.src.endsWith("/album-covers/linen.webp")) e.currentTarget.src = "/album-covers/linen.webp"; }}/>
      <span className="book-label"><span>{album.name}</span><small>STILLSPACE · MEMORIES</small></span>
      <span className="book-spine" aria-hidden="true"/>
    </span>
  </>;
}
export function AlbumLibrary({ config, enter, logout, home, localPhotos, localCovers, notice }: {
  config: AppConfig; enter: (entry: AlbumEntry) => void; logout: () => void; home: () => void;
  localPhotos: Map<string,Photo[]>; localCovers: Map<string,LocalCover>;
  notice?: string;
}) {
  const [albums,setAlbums] = useState<Album[]>([]), [loading,setLoading] = useState(true);
  const [error,setError] = useState(""), [message,setMessage] = useState("");
  const [editor,setEditor] = useState<Album | "new" | null>(null), [deleting,setDeleting] = useState<Album|null>(null);
  const [busy,setBusy] = useState(false), [query,setQuery] = useState("");
  const [active,setActive] = useState(0);
  const [reduced,setReduced] = useState(() => matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [hidden,setHidden] = useState(document.hidden);
  const root = useRef<HTMLDivElement>(null), request = useRef(0), live = useRef(true);
  const drag = useRef<{x:number;y:number}|null>(null);
  const suppressClickUntil = useRef(0);
  const motion = !reduced && !hidden;
  const decorate = (a: Album): Album => {
    if (config.mode !== "local") return a;
    const cover = localCovers.get(a.id), photo = (localPhotos.get(a.id)||[]).find(p => p.id === cover?.photoId);
    return {...a,photoCount:(localPhotos.get(a.id)||[]).length,
      ...(photo && cover ? {coverPhotoId:photo.id,coverUrl:photo.thumbUrl,coverX:cover.x,coverY:cover.y} : {})};
  };
  const load = async () => {
    const seq = ++request.current;
    try {
      const result = await api<{albums:Album[]}>("/api/albums");
      if (!live.current || seq !== request.current) return;
      setAlbums(result.albums.map(decorate)); setError("");
    } catch(e) { if (live.current && seq === request.current) setError((e as Error).message); }
    finally { if (live.current && seq === request.current) setLoading(false); }
  };
  useEffect(() => {
    live.current = true; void load();
    const visibility = () => { setHidden(document.hidden); if (!document.hidden) void load(); };
    const mq = matchMedia("(prefers-reduced-motion: reduce)");
    const change = () => setReduced(mq.matches);
    document.addEventListener("visibilitychange",visibility); mq.addEventListener("change",change);
    const timer = setInterval(() => { if (!document.hidden && !document.querySelector("dialog[open]")) void load(); }, 8*60000);
    return () => { live.current = false; request.current++; clearInterval(timer); document.removeEventListener("visibilitychange",visibility); mq.removeEventListener("change",change); };
  }, []);
  useEffect(() => { if (!message) return; const t = setTimeout(()=>setMessage(""),5000); return ()=>clearTimeout(t); },[message]);
  const featured = albums.slice(0,3), more = albums.slice(3);
  const index = Math.min(active,Math.max(0,more.length-1));
  const selected = more[index];
  const open = (a: Album, element: HTMLElement) => {
    const book = element.closest(".album-item")?.querySelector(".album-book") || element;
    const r = book.getBoundingClientRect(); enter({album:a,rect:{x:r.x,y:r.y,width:r.width,height:r.height}});
  };
  const tilt = (e:PointerEvent<HTMLButtonElement>) => {
    if (!motion || e.pointerType !== "mouse") return;
    const r=e.currentTarget.getBoundingClientRect();
    e.currentTarget.style.setProperty("--rx",`${-(e.clientY-r.top-r.height/2)/r.height*4}deg`);
    e.currentTarget.style.setProperty("--ry",`${(e.clientX-r.left-r.width/2)/r.width*5}deg`);
  };
  const card = (a:Album, className="") => <article className={`album-item ${className}`} key={a.id} data-album-id={a.id}>
    <button className="album-book" aria-label={`进入相册集：${a.name}`} onClick={e=>open(a,e.currentTarget)}
      onPointerMove={tilt} onPointerLeave={e=>{e.currentTarget.style.removeProperty("--rx");e.currentTarget.style.removeProperty("--ry");}}>
      <BookArtwork album={a}/>
    </button>
    <div className="album-caption"><h2 title={a.name}>{a.name}</h2><span>{a.photoCount} 张</span></div>
    <div className="album-actions">
      <button className="album-enter" onClick={e=>open(a,e.currentTarget)}>进入相册集 <ArrowRight size={16}/></button>
      <span className="album-action-divider"/>
      <button title="编辑名称与封面" aria-label={`编辑相册集：${a.name}`} onClick={()=>setEditor(a)}><Pencil size={15}/></button>
      <button aria-label={`删除相册集：${a.name}`} onClick={()=>setDeleting(a)}><Trash2 size={15}/><span className="delete-label">删除</span></button>
    </div>
  </article>;
  const remove = async () => {
    if (!deleting || busy) return; setBusy(true); setError("");
    try {
      await api(`/api/albums/${deleting.id}`,{},undefined,"DELETE");
      localPhotos.delete(deleting.id); localCovers.delete(deleting.id);
      setAlbums(v=>v.filter(a=>a.id!==deleting.id)); setDeleting(null); setMessage("相册集已删除");
    } catch(e) {setError((e as Error).message);} finally {setBusy(false);}
  };
  return <div className="album-library" ref={root} data-motion={motion} onPointerMove={e=>{
    if (motion && e.pointerType==="mouse") {root.current?.style.setProperty("--light-x",`${(e.clientX/innerWidth-.5)*8}px`); root.current?.style.setProperty("--light-y",`${(e.clientY/innerHeight-.5)*6}px`);}
  }}>
    <div className="album-ambient" aria-hidden="true"/>
    <header className="album-topbar">
      <a className="album-brand" href="/" onClick={e=>{e.preventDefault();home();}} aria-label="拾光首页"><Aperture strokeWidth={1.2}/><span>拾光<small>STILLSPACE</small></span></a>
      <button className="album-account" onClick={logout} title="退出登录"><span>{config.user?.username}</span><LogOut size={16}/></button>
    </header>
    <main className="album-main">
      <section className={`album-featured count-${Math.min(albums.length,3)}`} aria-label="首页相册">
        <div className="album-introduction">
          <span className="album-eyebrow">我的相册集</span>
          <h1>把日子，<br/>装订成诗。</h1>
          <p>收藏每一个平凡而闪光的瞬间。</p>
          <button className="album-primary" onClick={()=>setEditor("new")}><Plus size={22}/> 创建相册集</button>
          {albums.length>3 && <a className="more-hint" href="#more-albums"><ArrowDown size={15}/> 更多相册 · {more.length} 本</a>}
          {config.mode==="local" && <p className="album-demo-note">本地演示 · 相册会保存<br/>照片仅在当前页面会话保留</p>}
        </div>
        {loading ? <div className="album-empty" role="status"><LoaderCircle className="spin"/> 正在取出你的相册…</div> : albums.length===0 ?
          <div className="album-empty"><BookOpen size={46} strokeWidth={1}/><h2>故事，从第一本开始。</h2><p>选一张喜欢的封面，给回忆一个名字。</p><button onClick={()=>setEditor("new")}>创建第一个相册集 <ArrowRight size={16}/></button></div>
          : <div className="featured-books">{featured.map((a,i)=>card(a,`featured-book featured-${i}`))}</div>}
      </section>
      {more.length>0 && <section id="more-albums" className="album-more" aria-label="更多相册">
        <div className="more-heading"><div><span className="album-eyebrow">THE NEXT CHAPTER</span><h2>还有这些，值得重温。</h2></div><span>{more.length} 本相册</span></div>
        <div className={`album-carousel ${more.length<3 ? "few-albums" : ""}`} aria-roledescription="轮播"
          onPointerDown={e=>{if(e.button===0 && more.length>=3 && !(e.target as HTMLElement).closest(".album-actions,.carousel-arrow")) drag.current={x:e.clientX,y:e.clientY};}}
          onPointerMove={e=>{const d=drag.current;if(d && Math.abs(e.clientX-d.x)>50 && Math.abs(e.clientX-d.x)>Math.abs(e.clientY-d.y)) e.currentTarget.setPointerCapture(e.pointerId);}}
          onPointerUp={e=>{const d=drag.current;drag.current=null;if(d && Math.abs(e.clientX-d.x)>50 && Math.abs(e.clientX-d.x)>Math.abs(e.clientY-d.y)){suppressClickUntil.current=Date.now()+400;setActive(v=>Math.max(0,Math.min(more.length-1,v+(e.clientX<d.x?1:-1))));}}}
          onClickCapture={e=>{if(Date.now()<suppressClickUntil.current){e.preventDefault();e.stopPropagation();}}}
          onPointerCancel={()=>{drag.current=null;}}>
          {more.length<3 ? more.map(a=>card(a)) : <>
            <button className="carousel-arrow prev" aria-label="上一本相册" disabled={index===0} onClick={()=>setActive(index-1)}><ChevronLeft/></button>
            <div className="carousel-book-side">{index>0 && card(more[index-1],"carousel-neighbor")}</div>
            {selected && card(selected,"carousel-current")}
            <div className="carousel-book-side">{index<more.length-1 && card(more[index+1],"carousel-neighbor")}</div>
            <button className="carousel-arrow next" aria-label="下一本相册" disabled={index===more.length-1} onClick={()=>setActive(index+1)}><ChevronRight/></button>
          </>}
        </div>
        {more.length>=3 && <div className="carousel-position" aria-live="polite"><span>{String(index+1).padStart(2,"0")}</span><span className="position-rule"/>{String(more.length).padStart(2,"0")}<small>左右切换，翻阅更多回忆</small></div>}
      </section>}
      {albums.length>3 && <section className="album-find" aria-label="查找相册"><label><Search size={17}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="按名称寻找一本相册…" aria-label="搜索相册集"/></label>
        {query.trim() && <div className="album-search-results">{albums.filter(a=>a.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())).map(a=><button key={a.id} onClick={e=>open(a,e.currentTarget)}><img src={a.coverUrl} alt=""/><span>{a.name}<small>{a.photoCount} 张</small></span><ArrowRight size={17}/></button>)}
          {!albums.some(a=>a.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) && <p>没有找到这个名字，试试其他关键词。</p>}</div>}
      </section>}
    </main>
    <footer className="album-footer"><span>WHERE LIGHT FINDS A HOME</span><small>轻移鼠标，感受光影</small></footer>
    {error && !deleting && <div className="album-notice" role="alert">{error}<button onClick={()=>void load()}>重试</button></div>}
    {message && <div className="album-notice" role="status"><Check size={16}/>{message}</div>}
    {notice && !message && !error && <div className="album-notice" role="status">{notice}</div>}
    {editor && <AlbumEditor album={editor==="new"?null:editor} localPhotos={localPhotos} localCovers={localCovers} mode={config.mode}
      close={()=>setEditor(null)} saved={a=>{setEditor(null);setAlbums(v=>v.some(x=>x.id===a.id)?v.map(x=>x.id===a.id?decorate(a):x):[...v,decorate(a)]);setMessage(editor==="new"?"新相册已放好，可以进入上传照片了":"相册已更新");}}
      featured={async a=>{await api(`/api/albums/${a.id}/feature`,{});setEditor(null);await load();setMessage("已放到首页展示");}}/>}
    {deleting && <AlbumDialog title={`删除「${deleting.name}」？`} close={()=>{setDeleting(null);setError("");}} busy={busy}>
      <p className="album-dialog-copy">{deleting.photoCount ? `这会删除此相册集及其中的 ${deleting.photoCount} 张照片，无法恢复。` : "此相册集目前没有照片，删除后将从列表中移除。"}其他相册不受影响。</p>
      {error&&<p className="album-form-error" role="alert">{error}</p>}
      <div className="album-dialog-actions"><button onClick={()=>setDeleting(null)} disabled={busy}>保留相册</button><button className="album-danger" disabled={busy} onClick={()=>void remove()}>{busy?<LoaderCircle className="spin" size={17}/>:<Trash2 size={17}/>} 确认删除</button></div>
    </AlbumDialog>}
  </div>;
}

function AlbumEditor({album,close,saved,featured,mode,localPhotos,localCovers}:{album:Album|null;close:()=>void;saved:(a:Album)=>void;featured:(a:Album)=>Promise<void>;mode:AppConfig["mode"];localPhotos:Map<string,Photo[]>;localCovers:Map<string,LocalCover>}) {
  const [name,setName]=useState(album?.name||""), [description,setDescription]=useState(album?.description||"");
  const [preset,setPreset]=useState(album?.coverPreset||"meadow"), [photoId,setPhotoId]=useState<string|null>(album?.coverPhotoId||null);
  const [x,setX]=useState(album?.coverX??50), [y,setY]=useState(album?.coverY??50);
  const [source,setSource]=useState<"presets"|"photos">(album?.coverPhotoId?"photos":"presets");
  const [photos,setPhotos]=useState<Photo[]>([]), [busy,setBusy]=useState(false), [error,setError]=useState(""), [photosBusy,setPhotosBusy]=useState(false);
  const [photoRetry,setPhotoRetry]=useState(0);
  useEffect(()=>{
    if(!album)return;
    if(mode==="local"){setPhotos(localPhotos.get(album.id)||[]);return;}
    const c=new AbortController();setPhotosBusy(true);
    api<{photos:Photo[]}>(`/api/albums/${album.id}/photos`,undefined,c.signal).then(r=>setPhotos(r.photos)).catch(e=>{if(!c.signal.aborted)setError(e.message);}).finally(()=>{if(!c.signal.aborted)setPhotosBusy(false);});
    return()=>c.abort();
  },[album?.id,photoRetry]);
  const coverUrl=photoId?(photos.find(p=>p.id===photoId)?.thumbUrl||album?.coverUrl||presetCover(preset).url):presetCover(preset).url;
  const save=async()=>{
    if(busy)return;setBusy(true);setError("");
    try{
      const a=await api<Album>(album?`/api/albums/${album.id}`:"/api/albums",{name,description,coverPreset:preset,coverPhotoId:mode==="local"?null:photoId,coverX:x,coverY:y},undefined,album?"PATCH":undefined);
      if(mode==="local"){if(photoId)localCovers.set(a.id,{photoId,x,y});else localCovers.delete(a.id);}
      saved(a);
    }catch(e){setError((e as Error).message);}finally{setBusy(false);}
  };
  return <AlbumDialog title={album?"为回忆，换一个模样":"给回忆，一个名字"} close={close} busy={busy}>
    <form onSubmit={e=>{e.preventDefault();void save();}}>
      <div className="album-editor-layout"><div className="album-editor-fields">
        <label className="album-field">相册集名称<input autoFocus required maxLength={60} value={name} onChange={e=>setName(e.target.value)} placeholder="例如：花开的日子"/></label>
        <label className="album-field">一句简介 <small>选填</small><input maxLength={240} value={description} onChange={e=>setDescription(e.target.value)} placeholder="为这段时光，留下几句话"/></label>
        <div className="cover-tabs"><button type="button" className={source==="presets"?"is-active":""} onClick={()=>setSource("presets")}>精选封面</button><button type="button" className={source==="photos"?"is-active":""} onClick={()=>setSource("photos")}>相册中的照片</button></div>
        {source==="presets"?<div className="cover-picker">{ALBUM_COVERS.map(c=><button type="button" className={!photoId&&preset===c.id?"selected":""} key={c.id} aria-label={`使用封面：${c.name}`} aria-pressed={!photoId&&preset===c.id} onClick={()=>{setPreset(c.id);setPhotoId(null);setX(50);setY(50);}}><img src={c.url} alt=""/><span>{c.name}</span>{!photoId&&preset===c.id&&<Check size={14}/>}</button>)}</div>:
          photosBusy?<p role="status">正在加载照片…</p>:photos.length?<div className="cover-picker photo-cover-picker">{photos.map(p=><button type="button" key={p.id} aria-label={`使用照片：${p.name}`} aria-pressed={photoId===p.id} className={photoId===p.id?"selected":""} onClick={()=>{setPhotoId(p.id);setX(50);setY(50);}}><img src={p.thumbUrl} alt={p.name}/>{photoId===p.id&&<Check size={14}/>}</button>)}</div>:<div className="cover-empty"><ImagePlus size={22}/><p>{album?"上传照片后，就可以在这里选择封面。":"先选一张精选封面。创建并上传照片后，可随时换成自己的照片。"}</p></div>}
      </div><div className="album-editor-preview"><div className="album-book"><BookArtwork album={{name:name||"未命名的回忆",coverUrl,coverX:x,coverY:y}}/></div><small>封面预览</small>
        <label>左右取景<input type="range" min="0" max="100" value={x} onChange={e=>setX(Number(e.target.value))}/></label>
        <label>上下取景<input type="range" min="0" max="100" value={y} onChange={e=>setY(Number(e.target.value))}/></label>
      </div></div>
      {error&&<p className="album-form-error" role="alert">{error}{source==="photos"&&<button type="button" onClick={()=>setPhotoRetry(v=>v+1)}>重试加载</button>}</p>}
      <div className="album-dialog-actions">{album&&<button type="button" disabled={busy} onClick={async()=>{setBusy(true);try{await featured(album);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}><Pin size={15}/> 放到首页首位</button>}<button className="album-primary" disabled={busy||!name.trim()} type="submit">{busy?<LoaderCircle className="spin" size={17}/>:<Check size={17}/>} {album?"保存修改":"创建相册集"}</button></div>
    </form>
  </AlbumDialog>;
}
