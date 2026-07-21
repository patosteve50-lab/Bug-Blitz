/* =========================================================================
   Bug Blitz — ad layer (CrazyGames v3)
   Wraps rewarded + midgame ads with the required mute/pause on start and
   resume on finish/error. No-ops safely on localhost / when SDK is absent,
   so the game is fully playable in Codespaces preview.
   ========================================================================= */
(function () {
  function sdk() {
    return (window.CrazyGames && window.CrazyGames.SDK) ? window.CrazyGames.SDK : null;
  }
  function muteGame(on) {
    try { if (window.Audio && typeof window.Audio.setMuted === 'function') window.Audio.setMuted(on); } catch (e) {}
  }

  // Rewarded: player opts in, reward only granted on genuine completion.
  // onReward runs only if the ad actually finished.
  async function rewarded(onReward, onSkipOrFail) {
    const S = sdk();
    if (!S) { // no SDK (preview) — grant so testing works locally
      if (onReward) onReward();
      return;
    }
    muteGame(true);
    try {
      await S.ad.requestAd('rewarded', {
        adFinished: () => { muteGame(false); if (onReward) onReward(); },
        adError:    () => { muteGame(false); if (onSkipOrFail) onSkipOrFail(); },
      });
    } catch (e) {
      muteGame(false);
      if (onSkipOrFail) onSkipOrFail();
    }
  }

  // Midgame: brief automatic ad at natural breaks (level transitions).
  // onDone always runs (ad shown or not) so gameplay never stalls.
  async function midgame(onDone) {
    const S = sdk();
    if (!S) { if (onDone) onDone(); return; }
    muteGame(true);
    try {
      await S.ad.requestAd('midgame', {
        adFinished: () => { muteGame(false); if (onDone) onDone(); },
        adError:    () => { muteGame(false); if (onDone) onDone(); },
      });
    } catch (e) {
      muteGame(false);
      if (onDone) onDone();
    }
  }

  window.BSAds = { rewarded, midgame };
})();
