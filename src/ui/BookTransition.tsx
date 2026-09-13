import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { ArrowLeft, LoaderCircle, RefreshCw } from "lucide-react";
import { BookArtwork, type AlbumEntry } from "./AlbumLibrary";

export function BookTransition({entry,ready,error,background,complete,cancel,retry,reduced}:{
  entry:AlbumEntry;ready:boolean;error:string;background:string;complete:()=>void;cancel:()=>void;retry:()=>void;reduced:boolean;
}) {
  const root=useRef<HTMLDivElement>(null), timeline=useRef<gsap.core.Timeline|null>(null);
  const readyRef=useRef(ready), done=useRef(complete), [waiting,setWaiting]=useState(false), [slow,setSlow]=useState(false);
  const [attempt,setAttempt]=useState(0);
  readyRef.current=ready;done.current=complete;
  useEffect(()=>{setSlow(false);const timer=setTimeout(()=>setSlow(true),15000);return()=>clearTimeout(timer);},[attempt]);
  useEffect(()=>{
    const prior=document.activeElement as HTMLElement|null;
    root.current?.focus();
    const key=(e:KeyboardEvent)=>{
      if(e.key==="Escape"){e.preventDefault();e.stopImmediatePropagation();cancel();}
      else if(e.key!=="Tab" && e.key!=="Enter" && e.key!==" ")e.stopImmediatePropagation();
      if(e.key==="Tab"){
        const nodes=root.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)");
        if(!nodes?.length)return;
        const first=nodes[0],last=nodes[nodes.length-1];
        if(e.shiftKey&&(document.activeElement===first||document.activeElement===root.current)){e.preventDefault();last.focus();}
        else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
      }
    };
    window.addEventListener("keydown",key,true);
    const ctx=gsap.context(()=>{
      const book=root.current!.querySelector(".journey-book")!;
      const width=Math.min(420,innerWidth*.60),height=Math.min(560,innerHeight*.68);
      const targetX=(innerWidth-width)/2,targetY=(innerHeight-height)/2;
      gsap.set(book,{width,height,x:entry.rect.x,y:entry.rect.y,scaleX:entry.rect.width/width,scaleY:entry.rect.height/height,transformOrigin:"0 0"});
      const tl=gsap.timeline({defaults:{ease:"power2.inOut"}});timeline.current=tl;
      tl.to(book,{x:targetX,y:targetY,scaleX:1,scaleY:1,duration:reduced?.01:.4},0)
        .to(".journey-cover",{rotationY:reduced?0:-155,duration:reduced?.01:.55},reduced?0:.3)
        .addLabel("open")
        .addPause("open",()=>{setWaiting(true);if(readyRef.current)timeline.current?.resume();})
        .call(()=>setWaiting(false))
        .to(book,{scaleX:Math.max(innerWidth/width,innerHeight/height)*1.4,scaleY:Math.max(innerWidth/width,innerHeight/height)*1.4,
          x:innerWidth/2-width/2*Math.max(innerWidth/width,innerHeight/height)*1.4,
          y:innerHeight/2-height/2*Math.max(innerWidth/width,innerHeight/height)*1.4,
          duration:reduced?.01:.55,ease:"power2.in"})
        .to(root.current,{opacity:0,duration:reduced?.18:.3},"-=0.15")
        .call(()=>done.current());
    },root);
    return()=>{ctx.revert();timeline.current=null;window.removeEventListener("keydown",key,true);prior?.focus();};
  },[entry,reduced]);
  useEffect(()=>{if(ready&&waiting)timeline.current?.resume();},[ready,waiting]);
  return <div className="book-journey" ref={root} role="dialog" aria-modal="true" aria-label={`正在进入${entry.album.name}`} tabIndex={-1} data-reduced={reduced}>
    <div className="journey-backdrop"/>
    <div className="journey-book">
      <div className="journey-inside"><img src={background} alt=""/><span>{entry.album.name}</span></div>
      <div className="journey-cover"><BookArtwork album={entry.album}/><span className="journey-cover-back" aria-hidden="true"><span>{entry.album.name}</span><small>每一页，都是值得珍藏的时光。</small></span></div>
    </div>
    <div className="journey-status" role="status">
      {error?<p>{error}</p>:waiting?<p><LoaderCircle size={17} className="spin"/> {slow?"准备时间稍长，你可以重试或返回相册集。":"正在铺开你的影像空间…"}</p>:<p>翻开回忆，让时光围绕你。</p>}
      <div><button onClick={cancel}><ArrowLeft size={16}/> 返回相册集</button>{(error||slow)&&<button onClick={()=>{setAttempt(v=>v+1);retry();}}><RefreshCw size={16}/> 重新加载</button>}</div>
    </div>
  </div>;
}
