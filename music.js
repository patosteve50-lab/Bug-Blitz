/* =========================================================================
   Bug Blitz — file-based music player
   Loads the mp3 loops and routes them through the game's existing master gain
   (via a provided AudioContext + destination node), so the mute button and
   mute-during-ads both keep working. Falls back silently if a file is missing.
   ========================================================================= */
(function () {
  const TRACKS = {
    menu:  '/music_menu.mp3',
    gameA: '/music_game_a.mp3',
    gameB: '/music_game_b.mp3',
  };
  let ctx = null, dest = null;
  const buffers = {};      // name -> AudioBuffer
  let current = null;      // { name, src, gain }
  let ready = false;

  // Called once by the game after its AudioContext exists.
  async function attach(audioCtx, destinationNode) {
    ctx = audioCtx; dest = destinationNode;
    await Promise.all(Object.keys(TRACKS).map(async (name) => {
      try {
        const res = await fetch(TRACKS[name]);
        const arr = await res.arrayBuffer();
        buffers[name] = await ctx.decodeAudioData(arr);
      } catch (e) { /* missing file — that track just won't play */ }
    }));
    ready = true;
  }

  function stop() {
    if (current && current.src) {
      try { current.src.stop(); } catch (e) {}
      try { current.src.disconnect(); current.gain.disconnect(); } catch (e) {}
    }
    current = null;
  }

  // Play a track by name, looping, with a short fade-in. No-op if not ready.
  function play(name) {
    if (!ready || !ctx || !dest || !buffers[name]) return;
    if (current && current.name === name) return; // already playing this
    stop();
    const src = ctx.createBufferSource();
    src.buffer = buffers[name];
    src.loop = true;
    const gain = ctx.createGain();
    gain.gain.value = 0.0001;
    src.connect(gain); gain.connect(dest);
    try { src.start(); } catch (e) { return; }
    // fade in
    const t = ctx.currentTime;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.6, t + 0.8);
    current = { name, src, gain };
  }

  window.BSMusic = { attach, play, stop, get ready() { return ready; } };
})();
