(() => {
  const DURATION_MS = 10_000;

  function startLoadingScreen() {
    const screen = document.getElementById("gameLoadingScreen");
    const bar = document.getElementById("gameLoadingBar");
    const percent = document.getElementById("gameLoadingPercent");
    if (!screen || !bar || !percent) return;

    const startedAt = performance.now();

    function update(now) {
      const progress = Math.min((now - startedAt) / DURATION_MS, 1);
      const value = Math.round(progress * 100);
      bar.style.width = `${progress * 100}%`;
      percent.textContent = `${value}%`;

      if (progress < 1) {
        requestAnimationFrame(update);
        return;
      }

      screen.classList.add("is-complete");
      document.body.classList.remove("loading-game");
      screen.addEventListener("transitionend", () => screen.remove(), { once: true });
    }

    requestAnimationFrame(update);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startLoadingScreen, { once: true });
  } else {
    startLoadingScreen();
  }
})();
