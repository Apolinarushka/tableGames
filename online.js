(() => {
  const sessionStorageKey = "table-games-online-session";
  const generatedSessionId = globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID()
    : `player-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const sessionId = localStorage.getItem(sessionStorageKey) || generatedSessionId;
  localStorage.setItem(sessionStorageKey, sessionId);

  let socket;
  let connected = false;
  let reconnectTimer;
  let lastMessagesSignature = "";
  let lastTableMessagesSignature = "";
  let latestSnapshot = {players: [], tables: [], messages: [], invitations: []};
  let currentInvitationId = null;
  let currentTableNumber = null;

  const gameNames = {
    checkers: "шашки",
    giveaway: "поддавки",
    corners: "уголки",
    chess: "шахматы",
    domino: "домино",
    fives: "домино «Пятёрочки»"
  };

  const playerName = () =>
    document.querySelector("#profileName")?.textContent?.trim() || "Гость";

  function send(payload) {
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify(payload));
    return true;
  }

  function pluralPlayers(count) {
    const mod10 = count % 10;
    const mod100 = count % 100;
    if (mod10 === 1 && mod100 !== 11) return "игрок";
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "игрока";
    return "игроков";
  }

  function setConnectionLabel(text, isOnline) {
    const label = document.querySelector("#onlineCount");
    if (!label) return;
    label.textContent = text;
    label.closest(".online")?.classList.toggle("server-offline", !isOnline);
  }

  function selectedGame() {
    return document.querySelector("#challengeGame")?.value || "checkers";
  }

  function invite(targetId) {
    send({
      type: "invite",
      targetId,
      game: selectedGame(),
      tableNumber: currentTableNumber
    });
  }

  function renderMessages(messages, players) {
    const box = document.querySelector("#messages");
    if (!box) return;
    const lookingIds = new Set(players.filter(player => player.lookingForOpponent).map(player => player.id));
    const signature = messages.map(item => item.id).join(",") + "|" + [...lookingIds].join(",");
    if (signature === lastMessagesSignature) return;
    lastMessagesSignature = signature;
    box.replaceChildren();
    if (!messages.length) {
      const empty = document.createElement("p");
      empty.className = "system";
      const text = document.createElement("span");
      text.textContent = "Общий чат подключён к серверу.";
      empty.append(text);
      box.append(empty);
    }
    for (const item of messages) {
      const row = document.createElement("p");
      const author = document.createElement("b");
      const message = document.createElement("span");
      const time = document.createElement("small");
      author.textContent = item.nickname;
      message.textContent = item.message;
      time.textContent = item.time || "";
      row.append(author, message, time);
      if (item.senderId !== sessionId && lookingIds.has(item.senderId)) {
        const challenge = document.createElement("button");
        challenge.type = "button";
        challenge.className = "message-challenge";
        challenge.textContent = "Принять вызов";
        challenge.addEventListener("click", () => invite(item.senderId));
        row.append(challenge);
      }
      box.append(row);
    }
    box.scrollTop = box.scrollHeight;
  }

  function renderTableMessages(messages) {
    if (!currentTableNumber) return;
    const visible = messages.filter(item => Number(item.tableNumber) === Number(currentTableNumber));
    const signature = `${currentTableNumber}|${visible.map(item => item.id).join(",")}`;
    if (signature === lastTableMessagesSignature) return;
    lastTableMessagesSignature = signature;
    for (const box of [
      document.querySelector("#gameMessages"),
      document.querySelector("#arcadeChatMessages")
    ]) {
      if (!box) continue;
      box.replaceChildren();
      if (!visible.length) {
        const empty = document.createElement("p");
        empty.className = "system";
        empty.innerHTML = "<span>Чат стола подключён. Напишите сопернику.</span>";
        box.append(empty);
      }
      for (const item of visible) {
        const row = document.createElement("p");
        const author = document.createElement("b");
        const message = document.createElement("span");
        const time = document.createElement("small");
        author.textContent = item.nickname;
        message.textContent = item.message;
        time.textContent = item.time || "";
        row.append(author, message, time);
        box.append(row);
      }
      box.scrollTop = box.scrollHeight;
    }
  }

  function renderTables(tables) {
    const myId = sessionId;
    let freeCount = 0;
    for (const state of tables) {
      const number = String(state.tableNumber);
      const table = document.querySelector(`.table[data-table="${number}"]`);
      const row = document.querySelector(`.room-row[data-focus="${number}"]`);
      const names = [state.playerOne, state.playerTwo].filter(Boolean);
      const ids = [state.playerOneId, state.playerTwoId].filter(Boolean);
      if (ids.includes(myId)) currentTableNumber = state.tableNumber;
      const fullForAnotherPlayer = names.length >= 2 && !ids.includes(myId);
      const status = names.length
        ? names.join(" · ") + (names.length === 1 ? " ждёт соперника" : "")
        : "Свободен";
      if (!names.length) freeCount += 1;
      if (table) {
        table.classList.toggle("busy", fullForAnotherPlayer);
        table.classList.toggle("available", !fullForAnotherPlayer);
        table.classList.toggle("online-occupied", names.length > 0);
        table.querySelector(".table-status").textContent = status;
        table.setAttribute("aria-label", `Стол ${number}: ${status}`);
      }
      if (row) {
        row.classList.toggle("free", !names.length);
        row.classList.toggle("online-occupied", names.length > 0);
        row.querySelector("span").textContent = status;
        row.querySelector("small").textContent = fullForAnotherPlayer ? "Занят" : "Играть";
      }
    }
    const clubTitle = document.querySelector(".club-title b");
    if (clubTitle) clubTitle.textContent = freeCount
      ? `Свободных столов: ${freeCount}`
      : "Все столы заняты";
  }

  function renderActivePlayers(players) {
    const list = document.querySelector("#activePlayerList");
    const count = document.querySelector("#activePlayersCount");
    if (!list) return;
    count.textContent = String(players.length);
    list.replaceChildren();
    for (const player of players) {
      const row = document.createElement("div");
      row.className = "active-player";
      if (player.id === sessionId) row.classList.add("is-me");
      const avatar = document.createElement("span");
      const info = document.createElement("div");
      const name = document.createElement("b");
      const status = document.createElement("small");
      avatar.className = "active-player-avatar";
      avatar.textContent = player.nickname.slice(0, 1).toUpperCase();
      name.textContent = player.nickname + (player.id === sessionId ? " · вы" : "");
      status.textContent = player.lookingForOpponent
        ? `Ищет соперника · ${gameNames[player.lookingGame] || "любая игра"}`
        : "В клубе";
      info.append(name, status);
      row.append(avatar, info);
      if (player.id !== sessionId) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = player.lookingForOpponent ? "Сыграть" : "Пригласить";
        button.addEventListener("click", () => invite(player.id));
        row.append(button);
      }
      list.append(row);
    }
  }

  function updateLookingButton(players) {
    const mine = players.find(player => player.id === sessionId);
    const active = Boolean(mine?.lookingForOpponent);
    for (const button of [
      document.querySelector("#lookingForOpponent"),
      document.querySelector("#chatFindOpponent")
    ]) {
      if (!button) continue;
      button.classList.toggle("is-looking", active);
      button.textContent = active ? "✓ Поиск соперника включён" : "⚔ Ищу соперника";
      button.setAttribute("aria-pressed", String(active));
    }
  }

  function showIncomingInvitation(invitations) {
    const invitation = invitations.find(item => item.toId === sessionId);
    const dialog = document.querySelector("#onlineInvitationDialog");
    if (!dialog) return;
    if (!invitation) {
      currentInvitationId = null;
      if (dialog.open) dialog.close();
      return;
    }
    if (currentInvitationId === invitation.id && dialog.open) return;
    currentInvitationId = invitation.id;
    document.querySelector("#onlineInvitationText").textContent =
      `${invitation.fromName} приглашает вас сыграть в ${gameNames[invitation.game] || "настольную игру"}.`;
    if (!dialog.open) dialog.showModal();
  }

  function setHumanOpponent(name) {
    window.onlineOpponentName = name || null;
    window.setOnlineOpponent?.(name || null);
  }

  function handleMatchReady(data) {
    const opponent = data.players.find(player => player.id !== sessionId);
    if (!opponent) return;
    currentTableNumber = data.tableNumber;
    window.onlineMatch = data;
    setHumanOpponent(opponent.nickname);
    const dialog = document.querySelector("#onlineInvitationDialog");
    if (dialog?.open) dialog.close();
    if (typeof window.toast === "function") {
      window.toast(`${opponent.nickname} принял вызов. Стол ${String(data.tableNumber).padStart(2, "0")} готов.`);
    }
    window.setTimeout(() => {
      const table = document.querySelector(`.table[data-table="${data.tableNumber}"]`);
      if (table && !table.classList.contains("busy")) table.click();
    }, 250);
  }

  function handleSnapshot(data) {
    latestSnapshot = data;
    setConnectionLabel(
      `${data.onlineCount} ${pluralPlayers(data.onlineCount)} в клубе · онлайн`,
      true
    );
    renderTables(data.tables || []);
    renderActivePlayers(data.players || []);
    updateLookingButton(data.players || []);
    renderMessages(data.messages || [], data.players || []);
    renderTableMessages(data.tableMessages || []);
    showIncomingInvitation(data.invitations || []);
    const myTable = (data.tables || []).find(table =>
      [table.playerOneId, table.playerTwoId].includes(sessionId)
    );
    if (myTable) {
      const opponentName = myTable.playerOneId === sessionId ? myTable.playerTwo : myTable.playerOne;
      setHumanOpponent(opponentName || null);
    } else {
      currentTableNumber = null;
      setHumanOpponent(null);
    }
  }

  function connect() {
    clearTimeout(reconnectTimer);
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    socket = new WebSocket(`${protocol}//${location.host}/ws`);
    socket.addEventListener("open", () => {
      connected = true;
      send({type: "hello", sessionId, nickname: playerName()});
    });
    socket.addEventListener("message", event => {
      let data;
      try { data = JSON.parse(event.data); } catch { return; }
      if (data.type === "welcome" && data.sessionId !== sessionId) {
        localStorage.setItem(sessionStorageKey, data.sessionId);
      } else if (data.type === "snapshot") {
        handleSnapshot(data);
      } else if (data.type === "match_ready") {
        handleMatchReady(data);
      } else if (data.type === "notice") {
        if (typeof window.toast === "function") window.toast(data.message);
      } else if (data.type === "error") {
        if (typeof window.toast === "function") window.toast(data.message);
      }
    });
    socket.addEventListener("close", () => {
      connected = false;
      setConnectionLabel("Соединение с клубом восстанавливается…", false);
      reconnectTimer = setTimeout(connect, 1500);
    });
    socket.addEventListener("error", () => socket.close());
  }

  const chatForm = document.querySelector("#chatForm");
  const chatInput = document.querySelector("#chatInput");
  chatForm?.addEventListener("submit", event => {
    if (!connected) return;
    const message = chatInput.value.trim();
    if (!message) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (send({type: "chat", message})) chatInput.value = "";
  }, true);

  for (const [formSelector, inputSelector] of [
    ["#gameChatForm", "#gameChatInput"],
    ["#arcadeChatForm", "#arcadeChatInput"]
  ]) {
    const form = document.querySelector(formSelector);
    const input = document.querySelector(inputSelector);
    form?.addEventListener("submit", event => {
      if (!connected || !currentTableNumber) return;
      const message = input.value.trim();
      if (!message) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (send({
        type: "chat",
        channel: "table",
        tableNumber: currentTableNumber,
        message
      })) input.value = "";
    }, true);
  }

  function toggleLooking() {
    const mine = latestSnapshot.players?.find(player => player.id === sessionId);
    send({
      type: "looking_for_opponent",
      active: !mine?.lookingForOpponent,
      game: selectedGame()
    });
  }
  document.querySelector("#lookingForOpponent")?.addEventListener("click", toggleLooking);
  document.querySelector("#chatFindOpponent")?.addEventListener("click", toggleLooking);
  document.querySelector("#acceptOnlineInvitation")?.addEventListener("click", () => {
    if (currentInvitationId) {
      send({type: "invite_reply", invitationId: currentInvitationId, accept: true});
    }
  });
  document.querySelector("#declineOnlineInvitation")?.addEventListener("click", () => {
    if (currentInvitationId) {
      send({type: "invite_reply", invitationId: currentInvitationId, accept: false});
    }
  });

  document.addEventListener("click", event => {
    const table = event.target.closest?.(".table[data-table]");
    if (!table || table.classList.contains("busy")) return;
    send({type: "table_join", tableNumber: Number(table.dataset.table)});
  }, true);

  window.clubOnline = {
    joinTable(tableNumber, game) {
      return send({type: "table_join", tableNumber: Number(tableNumber), game});
    },
    leaveTable() {
      return send({type: "table_leave"});
    },
    refreshProfile() {
      return send({type: "hello", sessionId, nickname: playerName()});
    },
    isConnected() {
      return connected;
    }
  };

  setConnectionLabel("Подключение к клубу…", false);
  connect();
})();
