import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Aperture, ArrowDown, ArrowRight, BookOpen, Hand, Images, LogOut, MoveUpRight, Pause, Play } from "lucide-react";
import type { AppConfig } from "../upload/client";
import "./home.css";

const MemoryCloud = lazy(() => import("./MemoryCloud"));
const chapters = [
  { word: "童年", line: "还记得，那个很长的夏天。", detail: "树荫下的单车，和一直没有松开的手。" },
  { word: "家人", line: "最想念的，是平常的一天。", detail: "一桌热饭，几句家常，就是回家的意义。" },
  { word: "远方", line: "风景会远去，一起的人不会。", detail: "把走过的路，和并肩的背影，一起收藏。" },
];

export default function HomePage({ config, error, retry, authenticate, enter, demo, logout, paused, protectedPage = false }: {
  config: AppConfig | null; error: string; retry: () => void;
  authenticate: (tab: "login" | "register") => void; enter: () => void;
  demo: () => void; logout: () => void; paused: boolean; protectedPage?: boolean;
}) {
  const [chapter, setChapter] = useState(0);
  const [motion, setMotion] = useState(() => !matchMedia("(prefers-reduced-motion: reduce)").matches);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const change = () => setMotion(!media.matches);
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  const start = () => config?.user ? enter() : authenticate(protectedPage || config?.registration === "closed" ? "login" : "register");
  const action = config?.user ? "进入我的相册" : protectedPage ? "登录并继续" : config?.registration === "closed" ? "登录我的相册" : config?.registration === "invite" ? "受邀创建相册" : "创建我的相册";
  return <div className="home-page" data-motion={motion} ref={root}>
    <a className="home-skip" href="#home-content">跳到主要内容</a>
    <header className="home-header">
      <a className="home-brand" href="/" aria-label="拾光首页"><Aperture size={31} strokeWidth={1.15}/><span>拾光<small>STILLSPACE</small></span></a>
      <nav className="home-links" aria-label="首页导航"><a href="#memories">关于拾光</a><a href="#spaces">探索空间</a></nav>
      <div className="home-account">{config?.user ? <><span className="home-username">{config.user.username}</span><button aria-label="退出登录" onClick={logout}><LogOut size={17}/></button></> : <button disabled={!config} onClick={()=>authenticate("login")}>登录</button>}<button className="home-nav-cta" disabled={!config} onClick={start}>{config?.user ? "我的相册" : "开始拾光"}<MoveUpRight size={15}/></button></div>
    </header>
    <main id="home-content">
      <section className="home-hero" aria-labelledby="home-title">
        <div className="home-art" aria-label="漂浮的回忆相册，悬停播放家庭记忆">
          <Suspense fallback={<img className="memory-fallback" src="/home/memory-album.png" width={1672} height={941} alt=""/>}><MemoryCloud motion={motion} paused={paused} chapter={chapter}/></Suspense>
        </div>
        <div className="home-intro">
          <p className="home-eyebrow">A LITTLE SPACE FOR YOUR MEMORIES</p>
          <h1 id="home-title">有些时光，<br/>值得<span>再走近。</span></h1>
          <p className="home-lead">那些平凡的日子，<br/>后来都成了珍贵的回忆。</p>
          <p className="home-description">把照片装订成册，让记忆在光里展开。<br/>在属于你的影像空间，重逢每一个闪光的瞬间。</p>
          <div className="home-hero-actions"><button className="home-primary" disabled={!config} onClick={start}>{!config && !error ? "正在连接…" : action}<ArrowRight size={18}/></button><button className="home-demo" onClick={demo}><Play size={13} fill="currentColor"/> 先看看示例</button></div>
          {protectedPage && <p className="home-status" role="status">登录后，继续打开你的相册。</p>}
          {config?.registration === "invite" && !config.user && <p className="home-status">目前采用邀请制，创建账户需填写邀请码。</p>}
          {error && <p className="home-status" role="alert">暂时无法连接账户服务。<button onClick={retry}>重新连接</button></p>}
          <div className="home-chapters" aria-label="回忆篇章">{chapters.map((item,i)=><button key={item.word} aria-pressed={chapter===i} onClick={()=>setChapter(i)}><span>0{i+1}</span>{item.word}</button>)}</div>
        </div>
        <div className="home-art-note"><span>{chapters[chapter].line}</span><small>悬停，让回忆动起来 · 移开，回到记忆原处</small></div>
        <div className="home-hero-bottom"><a href="#memories"><ArrowDown size={15}/> 慢慢向下，继续拾光</a><button aria-pressed={!motion} aria-label={motion ? "暂停首页动态" : "开启首页动态"} onClick={()=>setMotion(v=>!v)}>{motion ? <Pause size={13}/> : <Play size={13}/>}<span>{motion ? "光影流动中" : "光影已暂停"}</span></button></div>
      </section>
      <section id="memories" className="home-collection" aria-labelledby="collection-title">
        <div className="home-memories">
          <div className="home-section-heading"><p className="home-eyebrow">A PLACE FOR EVERY CHAPTER</p><h2 id="collection-title">为回忆，选一处风景。</h2><p>日子会走远，回忆有归处。</p></div>
          <div className="home-memory-story"><span className="home-story-number">0{chapter+1} / {chapters[chapter].word}</span><h3>{chapters[chapter].line}</h3><p>{chapters[chapter].detail}</p></div>
        </div>
        <div id="spaces" className="home-spaces">
        <div className="home-spaces-heading"><p>三处风景，三种安放回忆的方式。</p><span>选择一处，走进去看看 <ArrowRight size={14}/></span></div>
        <div className="home-space-grid">{[{id:"forest",name:"林光秘境",label:"FOREST",copy:"让记忆，栖居在光里。"},{id:"lake",name:"镜湖回廊",label:"LAKE",copy:"把心事，交给湖面的风。"},{id:"meadow",name:"旷野流光",label:"MEADOW",copy:"那些自由而明亮的日子。"}].map((space,i)=><button key={space.id} className="home-space" onClick={()=>{try{localStorage.setItem("stillspace:theme",space.id);}catch{/* Preview works without storage. */} demo();}} aria-label={`体验${space.name}`}><img src={`/environments/${space.id}-panorama.jpg`} alt={`${space.name}自然环境`} loading="lazy"/><div><small>0{i+1} / {space.label}</small><h3>{space.name}</h3><p>{space.copy}</p><span><MoveUpRight size={21}/></span></div></button>)}</div>
        </div>
      </section>
      <section className="home-begin"><div><p className="home-eyebrow">YOUR NEXT CHAPTER</p><h2>下一页，写你的故事。</h2><div className="home-steps"><span><BookOpen size={16}/>创建相册</span><ArrowRight size={12}/><span><Images size={16}/>放入照片</span><ArrowRight size={12}/><span><Hand size={16}/>走进回忆</span></div></div><button className="home-primary" disabled={!config} onClick={start}>{action}<ArrowRight size={17}/></button></section>
    </main>
    <footer className="home-footer"><span>拾光 <small>STILLSPACE</small></span><p>让每一帧记忆，都有安放的地方。</p><a href="#home-content">回到顶部 ↑</a></footer>
  </div>;
}
