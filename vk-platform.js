(() => {
  const params = new URLSearchParams(window.location.search);
  const isMock = params.get("vk_test") === "1";
  const isSignedLaunch = /^\d+$/.test(params.get("vk_app_id") || "")
    && /^\d+$/.test(params.get("vk_user_id") || "")
    && Boolean(params.get("sign"));
  const isVK = isMock || isSignedLaunch;
  const bridge = window.vkBridge;
  const state = {
    enabled: isVK,
    mock: isMock,
    authenticated: false,
    appId: params.get("vk_app_id") || "",
    userId: params.get("vk_user_id") || "",
    sessionId: "",
    user: null,
    error: ""
  };

  function applyViewport(config = {}) {
    const height = Number(config.viewport_height || config.viewportHeight || window.innerHeight);
    const width = Number(config.viewport_width || config.viewportWidth || window.innerWidth);
    if (Number.isFinite(height) && height > 0) {
      document.documentElement.style.setProperty("--vk-viewport-height", `${height}px`);
    }
    if (Number.isFinite(width) && width > 0) {
      document.documentElement.style.setProperty("--vk-viewport-width", `${width}px`);
    }
  }

  function markPlatform() {
    document.documentElement.dataset.vkPlatform = isMock ? "mock" : isSignedLaunch ? "vk" : "web";
    if (!isVK) return;
    document.documentElement.classList.add("vk-mini-app");
    document.body?.classList.add("vk-mini-app");
    applyViewport();
  }

  function subscribeToBridge() {
    if (!bridge?.subscribe) return;
    bridge.subscribe(event => {
      if (event?.detail?.type === "VKWebAppUpdateConfig") {
        applyViewport(event.detail.data || {});
      }
    });
    window.addEventListener("resize", () => applyViewport(), {passive: true});
  }

  async function createServerSession() {
    const response = await fetch("/api/vk/session", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      credentials: "same-origin",
      cache: "no-store",
      body: JSON.stringify({launchParams: window.location.search.slice(1)})
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.message || `vk_session_${response.status}`);
    }
    return response.json();
  }

  async function initializeRealVK() {
    if (!bridge?.send) throw new Error("vk_bridge_unavailable");
    await bridge.send("VKWebAppInit");
    subscribeToBridge();
    await bridge.send("VKWebAppSetViewSettings", {
      status_bar_style: "light",
      action_bar_color: "#3b2115",
      navigation_bar_color: "#15251e"
    }).catch(() => null);

    const [session, user] = await Promise.all([
      createServerSession(),
      bridge.send("VKWebAppGetUserInfo").catch(() => null)
    ]);
    state.authenticated = true;
    state.sessionId = session.sessionId || "";
    state.appId = String(session.appId || state.appId);
    state.userId = String(session.userId || state.userId);
    state.user = user;
    document.documentElement.dataset.vkAuthenticated = "true";
    return state;
  }

  async function initializeMockVK() {
    state.user = {
      id: 100000001,
      first_name: "Тестовая",
      last_name: "Игрок",
      photo_200: "",
      city: {title: "Москва"}
    };
    state.userId = String(state.user.id);
    return state;
  }

  markPlatform();
  const ready = (isSignedLaunch ? initializeRealVK() : isMock ? initializeMockVK() : Promise.resolve(state))
    .catch(error => {
      state.error = error?.message || "vk_initialization_failed";
      console.warn("Не удалось инициализировать VK Mini Apps:", state.error);
      return state;
    });

  window.vkPlatform = {
    state,
    ready,
    isVK,
    isMock,
    inviteFriends() {
      if (!isSignedLaunch || !bridge?.send) return Promise.reject(new Error("vk_not_available"));
      return bridge.send("VKWebAppShowInviteBox");
    },
    addToFavorites() {
      if (!isSignedLaunch || !bridge?.send) return Promise.reject(new Error("vk_not_available"));
      return bridge.send("VKWebAppAddToFavorites");
    }
  };
})();
