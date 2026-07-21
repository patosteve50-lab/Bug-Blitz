/* =========================================================================
   Bug Blitz — data layer (CrazyGames edition)

   Keeps the exact same window.BSData interface the game already expects
   (load / save / submitScore / leaderboard / username / online), but routes
   persistence through the CrazyGames v3 SDK Data module when available, and
   falls back to localStorage everywhere else (Codespaces preview, itch, etc).

   The game calls window.BSData.load() once at startup and
   window.BSData.save(state) whenever progress changes. Everything is async
   and safe to call regardless of environment.
   ========================================================================= */
(function () {
  const LS_KEY = 'bugblitz_save_v2';       // progress save
  const LB_KEY = 'bugblitz_localboard_v1'; // local daily high-score board

  // Is the CrazyGames SDK present and initialized? Set true after init below.
  let sdkReady = false;
  let currentUser = null;

  function sdk() {
    return (typeof window !== 'undefined' && window.CrazyGames && window.CrazyGames.SDK)
      ? window.CrazyGames.SDK
      : null;
  }

  // ---- day key so the local leaderboard resets daily, like the old server ----
  function dayKey() {
    const d = new Date();
    return `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}`;
  }

  // ------------------------------- load -------------------------------------
  async function load() {
    const S = sdk();
    if (S && sdkReady) {
      try {
        // CrazyGames data module is synchronous getItem, string|null
        const raw = S.data.getItem(LS_KEY);
        if (raw) return JSON.parse(raw);
      } catch (e) { /* fall through to localStorage */ }
    }
    // fallback: localStorage
    try {
      const raw = localStorage.getItem(LS_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  // ------------------------------- save -------------------------------------
  async function save(state) {
    const json = JSON.stringify(state);
    // always mirror to localStorage so nothing is lost if the SDK hiccups
    try { localStorage.setItem(LS_KEY, json); } catch (e) {}
    const S = sdk();
    if (S && sdkReady) {
      try { S.data.setItem(LS_KEY, json); } catch (e) {}
    }
  }

  // --------------------------- submit a score -------------------------------
  // v1: local daily board. The interface is kept identical so a real
  // server-backed CrazyGames leaderboard can be dropped in later without
  // touching game.js.
  async function submitScore(mode, score, wave) {
    score = Number(score) || 0;
    const name = currentUser || 'You';
    let board;
    try { board = JSON.parse(localStorage.getItem(LB_KEY)) || {}; } catch (e) { board = {}; }
    const today = dayKey();
    if (!board.date || board.date !== today) board = { date: today, entries: {} };
    // keep each player's best for the day
    if (board.entries[name] == null || score > board.entries[name]) {
      board.entries[name] = score;
    }
    try { localStorage.setItem(LB_KEY, JSON.stringify(board)); } catch (e) {}
    return { ok: true, best: board.entries[name] };
  }

  // --------------------------- read leaderboard -----------------------------
  async function leaderboard() {
    let board;
    try { board = JSON.parse(localStorage.getItem(LB_KEY)) || {}; } catch (e) { board = {}; }
    const today = dayKey();
    if (!board.date || board.date !== today || !board.entries) return { entries: [] };
    const entries = Object.keys(board.entries)
      .map((name) => ({ name, score: board.entries[name] }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);
    return { entries };
  }

  // Expose the identical interface game.js already binds to.
  window.BSData = {
    load,
    save,
    submitScore,
    leaderboard,
    username: () => currentUser,
    get online() { return sdkReady; },
    // called by the boot glue in index.html once the SDK is initialized
    _markReady(user) { sdkReady = true; currentUser = user || null; },
  };
})();
