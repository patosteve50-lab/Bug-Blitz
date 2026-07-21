(function () {
  const TRACKS = { menu:'music_menu.mp3', gameA:'music_game_a.mp3', gameB:'music_game_b.mp3' };
  let ctx=null, dest=null; const buffers={};
  let current=null, ready=false, attaching=false, pending=null;
  async function attach(audioCtx, destinationNode){
    if(ready||attaching){ if(ready&&pending){ const p=pending; pending=null; play(p); } return; }
    attaching=true; ctx=audioCtx; dest=destinationNode;
    await Promise.all(Object.keys(TRACKS).map(async(name)=>{
      try{ const res=await fetch(TRACKS[name]); const arr=await res.arrayBuffer(); buffers[name]=await ctx.decodeAudioData(arr); }catch(e){}
    }));
    ready=true; attaching=false;
    if(pending){ const p=pending; pending=null; play(p); }
  }
  function stop(){ if(current&&current.src){ try{current.src.stop();}catch(e){} try{current.src.disconnect(); current.gain.disconnect();}catch(e){} } current=null; }
  function play(name){
    if(!ctx||!dest){ pending=name; return; }
    if(!ready){ pending=name; return; }
    if(!buffers[name]) return;
    if(current&&current.name===name) return;
    stop();
    const src=ctx.createBufferSource(); src.buffer=buffers[name]; src.loop=true;
    const gain=ctx.createGain(); gain.gain.value=0.0001;
    src.connect(gain); gain.connect(dest);
    try{ src.start(); }catch(e){ return; }
    const t=ctx.currentTime; gain.gain.setValueAtTime(0.0001,t); gain.gain.exponentialRampToValueAtTime(0.6,t+0.8);
    current={name,src,gain};
  }
  window.BSMusic={ attach, play, stop, get ready(){return ready;} };
})();
