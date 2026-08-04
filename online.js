(() => {
  const sessionStorageKey = "table-games-online-session";
  const generatedSessionId = globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID()
    : `player-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  let sessionId = localStorage.getItem(sessionStorageKey) || generatedSessionId;
  localStorage.setItem(sessionStorageKey, sessionId);

  let socket;
  let connected = false;
  let reconnectTimer;
  let lastMessagesSignature = "";
  let lastTableMessagesSignature = "";
  let latestSnapshot = {players: [], tables: [], messages: [], invitations: [], heartRequests: []};
  let currentInvitationId = null;
  let currentTableNumber = null;
  let localGuestInitialized = false;
  let pendingPresence = null;
  let presenceTimer = null;
  let lastPresenceSentAt = 0;

  const gameNames = {
    checkers: "шашки",
    giveaway: "поддавки",
    corners: "уголки",
    chess: "шахматы",
    domino: "домино",
    fives: "домино «Пятёрочки»"
  };
  const levelNames = {
    A1: "А1", A2: "А2", B1: "Б1", B2: "Б2", V1: "В1", V2: "В2"
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
    return document.querySelector("#opponentSearchGame")?.value || "checkers";
  }

  function selectedLevel() {
    return document.querySelector("#opponentSearchLevel")?.value || "B2";
  }

  function invite(targetId, game = selectedGame(), level = selectedLevel()) {
    send({
      type: "invite",
      targetId,
      game,
      level,
      tableNumber: currentTableNumber
    });
  }

  function acceptSearch(player) {
    cancelOwnSearch();
    send({
      type: "accept_search",
      targetId: player.id,
      tableNumber: currentTableNumber
    });
  }

  function cancelOwnSearch() {
    const mine = latestSnapshot.players?.find(player => player.id === sessionId);
    if (mine) {
      mine.lookingForOpponent = false;
      mine.lookingSecondsLeft = 0;
      updateLookingButton(latestSnapshot.players || []);
    }
    return send({
      type: "looking_for_opponent",
      active: false,
      game: mine?.lookingGame || selectedGame(),
      level: mine?.lookingLevel || selectedLevel()
    });
  }

  function renderMessages(messages, players) {
    const box = document.querySelector("#messages");
    if (!box) return;
    const lookingPlayers = players.filter(player => player.lookingForOpponent);
    const lookingById = new Map(lookingPlayers.map(player => [player.id, player]));
    const signature = messages.map(item => item.id).join(",") + "|" + lookingPlayers
      .map(player => `${player.id}:${player.lookingGame}:${player.lookingLevel}`).join(",");
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
      if (item.senderId !== sessionId && lookingById.has(item.senderId)) {
        const challenge = document.createElement("button");
        challenge.type = "button";
        challenge.className = "message-challenge";
        challenge.textContent = "Согласиться";
        challenge.addEventListener("click", () => acceptSearch(lookingById.get(item.senderId)));
        row.append(challenge);
      }
      box.append(row);
    }
    for (const player of lookingPlayers) {
      const row = document.createElement("p");
      const author = document.createElement("b");
      const message = document.createElement("span");
      const time = document.createElement("small");
      row.className = "search-announcement";
      author.textContent = player.nickname;
      message.textContent = `Ищу соперника — ${gameNames[player.lookingGame] || "настольная игра"}, уровень ${levelNames[player.lookingLevel] || "Б1"}.`;
      time.textContent = "сейчас";
      row.append(author, message, time);
      if (player.id !== sessionId) {
        const agree = document.createElement("button");
        agree.type = "button";
        agree.className = "message-challenge";
        agree.textContent = "Согласиться и начать игру";
        agree.addEventListener("click", () => acceptSearch(player));
        row.append(agree);
      }
      box.append(row);
    }
    box.scrollTop = box.scrollHeight;
  }

  function renderHeartInbox(requests) {
    const incoming = (requests || []).filter(request => request.requesterId !== sessionId);
    const badge = document.querySelector("#heartInboxBadge");
    const button = document.querySelector("#heartInboxButton");
    const list = document.querySelector("#heartInboxList");
    const sendAll = document.querySelector("#heartInboxSendAll");
    if (badge) {
      badge.textContent = String(incoming.length);
      badge.classList.toggle("hidden", incoming.length === 0);
    }
    button?.classList.toggle("has-requests", incoming.length > 0);
    if (sendAll) {
      sendAll.classList.toggle("hidden", incoming.length === 0);
      sendAll.disabled = false;
    }
    if (!list) return;
    list.replaceChildren();
    if (!incoming.length) {
      const empty = document.createElement("p");
      empty.textContent = "Новых просьб пока нет.";
      list.append(empty);
      return;
    }
    for (const request of incoming) {
      const row = document.createElement("div");
      row.className = "heart-inbox-request";
      const copy = document.createElement("span");
      const name = document.createElement("b");
      const time = document.createElement("small");
      name.textContent = request.nickname || "Гость";
      time.textContent = `Просит одно сердечко · ${request.time || "сейчас"}`;
      copy.append(name,time);
      const help = document.createElement("button");
      help.type = "button";
      help.textContent = "Отправить ♥";
      help.addEventListener("click",()=>{
        if(send({type:"heart_gift",targetId:request.requesterId})) help.disabled=true;
      });
      row.append(copy,help);
      list.append(row);
    }
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

  const guestDressPalette = [
    {name: "Голубой", color: "#9fb9d8"},
    {name: "Кремовый", color: "#e6ddc3"},
    {name: "Каменный", color: "#c2a08c"},
    {name: "Мокко", color: "#8f725f"},
    {name: "Луговой", color: "#9ca665"},
    {name: "Кипарисовый", color: "#4f6951"},
    {name: "Хаки", color: "#737044"},
    {name: "Ореховый", color: "#5a3b2f"}
  ];
  const guestStandingPoints = [8, 19, 31, 43, 56, 70, 84];

  function roomTableX(tableNumber) {
    const normalized = Math.max(1, Number(tableNumber) || 1);
    const panel = Math.floor((normalized - 1) / 3);
    return panel * 100 + [20, 50, 80][(normalized - 1) % 3];
  }

  function guestFallbackX(guestSlot) {
    const slot = Math.max(1, Number(guestSlot) || 1);
    const tableNumber = Math.ceil(slot / 2);
    return roomTableX(tableNumber) + (slot % 2 ? -7 : 7);
  }

  function guestAppearance(player) {
    const slot = Math.max(1, Number(player?.guestSlot) || 1);
    return {slot, ...guestDressPalette[(slot - 1) % guestDressPalette.length]};
  }

  function createRoomTable(tableNumber) {
    const table = document.createElement("button");
    const number = String(tableNumber);
    table.type = "button";
    table.className = `table new-room-table table-${number} available dynamic-room-furniture`;
    table.dataset.table = number;
    table.style.setProperty("--x", String(roomTableX(tableNumber)));
    table.style.setProperty("--y", "65%");
    table.setAttribute("aria-label", `Стол ${number}, свободен`);

    const label = document.createElement("span");
    label.className = "table-number";
    label.textContent = number.padStart(2, "0");
    const status = document.createElement("span");
    status.className = "table-status";
    status.textContent = "Свободен";
    table.append(label, status);
    return table;
  }

  function createRoomSeat(tableNumber, side) {
    const seat = document.createElement("button");
    const tablePosition = roomTableX(tableNumber);
    seat.type = "button";
    seat.className = `seat-hotspot dynamic-room-furniture seat-${tableNumber}-${side}`;
    seat.dataset.seatTable = String(tableNumber);
    seat.dataset.seatSide = side;
    seat.style.setProperty("--seat-x", String(tablePosition + (side === "right" ? 8 : -7)));
    seat.setAttribute("aria-label", `Сесть ${side === "right" ? "справа" : "слева"} за стол ${tableNumber}`);
    return seat;
  }

  function createRoomBoard(tableNumber) {
    const board = document.createElement("img");
    board.className = "new-room-board dynamic-room-board";
    board.dataset.boardTable = String(tableNumber);
    board.style.setProperty("--board-x", String(roomTableX(tableNumber)));
    board.src = "assets/new-room/left-board.png";
    board.alt = "";
    board.setAttribute("aria-hidden", "true");
    return board;
  }

  function createRoomRow(tableNumber) {
    const row = document.createElement("div");
    row.className = "room-row free dynamic-room-row";
    row.dataset.focus = String(tableNumber);
    const title = document.createElement("b");
    title.textContent = `Стол ${String(tableNumber).padStart(2, "0")}`;
    const status = document.createElement("span");
    status.textContent = "Свободен";
    const action = document.createElement("small");
    action.textContent = "Играть";
    row.append(title, status, action);
    return row;
  }

  function ensureRoomFurniture(tables, requestedWidth) {
    const club = document.querySelector("#club");
    const boards = document.querySelector(".new-room-boards");
    const guests = document.querySelector("#roomOnlineGuests");
    const roomsPanel = document.querySelector("#roomsPanel");
    if (!club || !boards || !guests || !roomsPanel) return;

    const tableNumbers = tables
      .map(table => Number(table.tableNumber))
      .filter(number => Number.isFinite(number) && number > 0);
    const valid = new Set(tableNumbers.map(String));
    const width = Math.max(
      100,
      Number(requestedWidth) || 0,
      Math.ceil((Math.max(3, ...tableNumbers) || 3) / 3) * 100
    );
    club.style.setProperty("--room-width-units", String(width));
    window.setRoomExtent?.(width);

    for (const tableNumber of tableNumbers) {
      if (!document.querySelector(`.table[data-table="${tableNumber}"]`)) {
        club.insertBefore(createRoomTable(tableNumber), guests);
      }
      for (const side of ["left", "right"]) {
        if (!document.querySelector(`[data-seat-table="${tableNumber}"][data-seat-side="${side}"]`)) {
          club.insertBefore(createRoomSeat(tableNumber, side), guests);
        }
      }
      if (!document.querySelector(`[data-board-table="${tableNumber}"]`)) {
        boards.append(createRoomBoard(tableNumber));
      }
      if (!document.querySelector(`.room-row[data-focus="${tableNumber}"]`)) {
        roomsPanel.append(createRoomRow(tableNumber));
      }
    }

    document.querySelectorAll(".dynamic-room-furniture").forEach(element => {
      const number = element.dataset.table || element.dataset.seatTable;
      if (!valid.has(String(number))) element.remove();
    });
    document.querySelectorAll(".dynamic-room-board").forEach(element => {
      if (!valid.has(String(element.dataset.boardTable))) element.remove();
    });
    document.querySelectorAll(".dynamic-room-row").forEach(element => {
      if (!valid.has(String(element.dataset.focus))) element.remove();
    });
  }

  function occupiedSeat(tables, tableNumber, side) {
    const table = tables.find(item => Number(item.tableNumber) === Number(tableNumber));
    if (!table) return null;
    if (table.playerOneId && (table.playerOneSeat || "left") === side) {
      return {id: table.playerOneId, nickname: table.playerOne};
    }
    if (table.playerTwoId && (table.playerTwoSeat || "right") === side) {
      return {id: table.playerTwoId, nickname: table.playerTwo};
    }
    return null;
  }

  function updateSeatAvailability(tables) {
    document.querySelectorAll("[data-seat-table][data-seat-side]").forEach(seat => {
      const owner = occupiedSeat(tables, seat.dataset.seatTable, seat.dataset.seatSide);
      const occupiedByMe = owner?.id === sessionId;
      const occupiedByOther = Boolean(owner && !occupiedByMe);
      seat.classList.toggle("occupied", Boolean(owner));
      seat.classList.toggle("occupied-by-me", occupiedByMe);
      seat.classList.toggle("occupied-other", occupiedByOther);
      seat.disabled = occupiedByOther;
      seat.setAttribute("aria-disabled", String(occupiedByOther));
      seat.title = owner
        ? occupiedByMe
          ? "Ваш стул"
          : `Стул занят: ${owner.nickname || "гостья"}`
        : "Свободный стул";
    });
  }

  function playerSeat(tables, playerId) {
    for (const table of tables) {
      if (table.playerOneId === playerId) {
        return {tableNumber: table.tableNumber, side: table.playerOneSeat || "left"};
      }
      if (table.playerTwoId === playerId) {
        return {tableNumber: table.tableNumber, side: table.playerTwoSeat || "right"};
      }
    }
    return null;
  }

  function renderRoomGuests(players, tables) {
    const container = document.querySelector("#roomOnlineGuests");
    if (!container) return;
    const guests = players
      .filter(player => player.id !== sessionId)
      .sort((first, second) => Number(first.guestSlot) - Number(second.guestSlot));
    container.replaceChildren();

    guests.forEach((player, index) => {
      const palette = guestAppearance(player);
      const seat = playerSeat(tables, player.id);
      const guest = document.createElement("div");
      const sprite = seat
        ? "assets/new-room/sprites/sit-side-left-pose.png"
        : "assets/new-room/sprites/walk-right-a.png";
      const image = document.createElement("img");
      const tint = document.createElement("span");
      const label = document.createElement("span");
      let x = Number(player.roomX) || guestFallbackX(player.guestSlot)
        || guestStandingPoints[index % guestStandingPoints.length];

      guest.className = "room-guest blue-dress-player";
      guest.dataset.playerId = player.id;
      guest.style.setProperty("--guest-dress", palette.color);
      guest.style.setProperty("--guest-mask", `url("${sprite}")`);
      guest.style.setProperty("--py", seat ? "82.8%" : "69%");

      if (seat) {
        const tableElement = document.querySelector(`.table[data-table="${seat.tableNumber}"]`);
        const tableX = Number.parseFloat(tableElement?.style.getPropertyValue("--x")) || 50;
        x = tableX + (seat.side === "right" ? 7.3 : -7.3);
        guest.classList.add("sitting", `seat-${seat.side}`);
        guest.classList.add(seat.side === "left" ? "facing-right" : "facing-left");
      } else {
        guest.classList.add(player.roomFacing === "right" ? "facing-right" : "facing-left");
      }

      guest.style.setProperty("--px", String(x));
      guest.setAttribute("aria-label", `Гостья ${palette.slot}, ${palette.name.toLowerCase()} платье`);
      guest.title = `${player.nickname || `Гостья ${palette.slot}`} · ${palette.name} платье`;

      image.src = sprite;
      image.alt = "";
      tint.className = "guest-dress-tint";
      tint.setAttribute("aria-hidden", "true");
      label.className = "room-player-name";
      label.textContent = `Гостья ${palette.slot}`;
      guest.append(image, tint, label);
      container.append(guest);
    });
  }

  function applyLocalGuest(players) {
    const mine = players.find(player => player.id === sessionId);
    if (!mine) return;
    const appearance = guestAppearance(mine);
    const player = document.querySelector("#player");
    const label = player?.querySelector(".room-player-name");
    player?.style.setProperty("--guest-dress", appearance.color);
    player?.setAttribute("data-guest-slot", String(appearance.slot));
    if (label) label.textContent = `Гостья ${appearance.slot} · вы`;
    if (!localGuestInitialized) {
      localGuestInitialized = true;
      window.setRoomPlayerPresence?.({
        x: Number(mine.roomX) || 94,
        y: Number(mine.roomY) || 69,
        facing: mine.roomFacing || "left"
      });
    }
  }

  function updateRemotePresence(data) {
    const player = latestSnapshot.players?.find(item => item.id === data.playerId);
    if (player) {
      player.roomX = data.x;
      player.roomY = data.y;
      player.roomFacing = data.facing;
    }
    const guest = document.querySelector(`.room-guest[data-player-id="${data.playerId}"]`);
    if (!guest || guest.classList.contains("sitting")) return;
    guest.style.setProperty("--px", String(data.x));
    guest.style.setProperty("--py", `${data.y}%`);
    guest.classList.toggle("facing-right", data.facing === "right");
    guest.classList.toggle("facing-left", data.facing !== "right");
    guest.classList.add("walking");
    clearTimeout(guest._walkTimer);
    guest._walkTimer = setTimeout(() => guest.classList.remove("walking"), 220);
  }

  function flushRoomPresence() {
    if (!pendingPresence) return false;
    const presence = pendingPresence;
    pendingPresence = null;
    lastPresenceSentAt = Date.now();
    return send({type: "room_presence", ...presence});
  }

  function updateRoomPresence(presence) {
    pendingPresence = presence;
    const elapsed = Date.now() - lastPresenceSentAt;
    if (elapsed >= 120) return flushRoomPresence();
    clearTimeout(presenceTimer);
    presenceTimer = setTimeout(flushRoomPresence, 120 - elapsed);
    return true;
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
        ? `Ищет: ${gameNames[player.lookingGame] || "любая игра"} · ${levelNames[player.lookingLevel] || "Б1"}`
        : "В клубе";
      info.append(name, status);
      row.append(avatar, info);
      if (player.id !== sessionId) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = player.lookingForOpponent ? "Согласиться" : "Пригласить";
        button.addEventListener("click", () => player.lookingForOpponent
          ? acceptSearch(player)
          : invite(player.id));
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
      button.textContent = active
        ? `✓ ${gameNames[mine.lookingGame] || "Игра"} · ${levelNames[mine.lookingLevel] || "Б1"} · до 30 сек`
        : "⚔ Ищу соперника";
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
      `${invitation.fromName} приглашает вас сыграть в ${gameNames[invitation.game] || "настольную игру"}, уровень ${levelNames[invitation.level] || "Б1"}.`;
    if (!dialog.open) dialog.showModal();
  }

  function setHumanOpponent(name) {
    window.onlineOpponentName = name || null;
    window.setOnlineOpponent?.(name || null);
  }

  function handleMatchReady(data) {
    const me = data.players.find(player => player.id === sessionId);
    const opponent = data.players.find(player => player.id !== sessionId);
    if (!me || !opponent) return;
    currentTableNumber = data.tableNumber;
    window.onlineMatch = {...data, me, opponent};
    setHumanOpponent(opponent.nickname);
    const dialog = document.querySelector("#onlineInvitationDialog");
    if (dialog?.open) dialog.close();
    if (typeof window.toast === "function") {
      window.toast(`${opponent.nickname} принял вызов. Стол ${String(data.tableNumber).padStart(2, "0")} готов.`);
    }
    window.setTimeout(() => {
      if (typeof window.launchOnlineMatch === "function") {
        window.launchOnlineMatch(window.onlineMatch);
      } else if (["checkers", "giveaway"].includes(data.game) && typeof window.startGame === "function") {
        window.startGame(data.tableNumber, data.game);
      }
    }, 180);
  }

  function handleSnapshot(data) {
    latestSnapshot = data;
    setConnectionLabel(
      `${data.onlineCount} ${pluralPlayers(data.onlineCount)} в клубе · онлайн`,
      true
    );
    ensureRoomFurniture(data.tables || [], data.roomWidthUnits);
    renderTables(data.tables || []);
    updateSeatAvailability(data.tables || []);
    applyLocalGuest(data.players || []);
    renderRoomGuests(data.players || [], data.tables || []);
    renderActivePlayers(data.players || []);
    updateLookingButton(data.players || []);
    renderMessages(data.messages || [], data.players || []);
    renderTableMessages(data.tableMessages || []);
    renderHeartInbox(data.heartRequests || []);
    showIncomingInvitation(data.invitations || []);
    const myTable = (data.tables || []).find(table =>
      [table.playerOneId, table.playerTwoId].includes(sessionId)
    );
    if (myTable) {
      const opponentName = myTable.playerOneId === sessionId ? myTable.playerTwo : myTable.playerOne;
      setHumanOpponent(opponentName || null);
    } else {
      currentTableNumber = null;
      window.onlineMatch = null;
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
      } else if (data.type === "game_action") {
        window.receiveOnlineGameAction?.(data.game, data.action);
      } else if (data.type === "room_presence") {
        updateRemotePresence(data);
      } else if (data.type === "heart_update") {
        window.applyServerHeartState?.(data.hearts,data.coins,data.message);
      } else if (data.type === "fortune_result") {
        window.handleFortuneResult?.(data);
      } else if (data.type === "notice") {
        if (typeof window.toast === "function") window.toast(data.message);
        if (data.message?.startsWith("30 секунд истекли")) {
          const interaction = document.querySelector("#interaction");
          if (interaction) interaction.textContent = "Заявка завершена. Гостья остаётся за столом — можно начать новый поиск.";
        }
      } else if (data.type === "error") {
        if (data.code === "seat_taken" || data.code === "table_full") {
          window.cancelRoomSeatAttempt?.();
        }
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

  function openSearchDialog(tableNumber = null) {
    if (tableNumber) currentTableNumber = Number(tableNumber);
    const dialog = document.querySelector("#opponentSearchDialog");
    const title = document.querySelector("#opponentSearchTitle");
    const start = document.querySelector("#startOpponentSearch");
    if (title) title.textContent = tableNumber ? "Заявка на партию" : "Поиск соперника";
    if (start) start.textContent = "Опубликовать на 30 секунд";
    if (dialog && !dialog.open) dialog.showModal();
    return Boolean(dialog);
  }

  function toggleLooking() {
    const mine = latestSnapshot.players?.find(player => player.id === sessionId);
    if (!mine?.lookingForOpponent) {
      openSearchDialog();
      return;
    }
    cancelOwnSearch();
  }
  document.querySelector("#lookingForOpponent")?.addEventListener("click", toggleLooking);
  document.querySelector("#chatFindOpponent")?.addEventListener("click", toggleLooking);
  document.querySelector("#startOpponentSearch")?.addEventListener("click", () => {
    if (send({
      type: "looking_for_opponent",
      active: true,
      game: selectedGame(),
      level: selectedLevel()
    })) {
      document.querySelector("#opponentSearchDialog")?.close();
      const interaction = document.querySelector("#interaction");
      if (interaction) interaction.textContent = "Заявка опубликована. Гостья ждёт соперника за столом 30 секунд.";
    }
  });
  document.querySelector("#cancelOpponentSearch")?.addEventListener("click", () => {
    document.querySelector("#opponentSearchDialog")?.close();
  });
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
  document.querySelector("#heartInboxButton")?.addEventListener("click",()=>{
    renderHeartInbox(latestSnapshot.heartRequests || []);
    const dialog=document.querySelector("#heartInboxDialog");
    dialog?.classList.remove("hidden");
    if(dialog&&!dialog.open)dialog.showModal();
  });
  document.querySelector("#closeHeartInbox")?.addEventListener("click",()=>{
    const dialog=document.querySelector("#heartInboxDialog");
    if(dialog?.open)dialog.close();dialog?.classList.add("hidden");
  });
  document.querySelector("#heartInboxSendAll")?.addEventListener("click",event=>{
    if(send({type:"heart_gift_all"}))event.currentTarget.disabled=true;
  });

  window.clubOnline = {
    joinTable(tableNumber, game, seatSide) {
      return send({type: "table_join", tableNumber: Number(tableNumber), game, seatSide});
    },
    leaveTable() {
      window.onlineMatch = null;
      return send({type: "table_leave"});
    },
    refreshProfile() {
      return send({type: "hello", sessionId, nickname: playerName()});
    },
    sendGameAction(action) {
      if (!currentTableNumber || !window.onlineMatch) return false;
      return send({
        type: "game_action",
        tableNumber: currentTableNumber,
        action
      });
    },
    currentMatch() {
      return window.onlineMatch || null;
    },
    isConnected() {
      return connected;
    },
    cancelSearch() {
      return cancelOwnSearch();
    },
    openSearch(tableNumber = null) {
      return openSearchDialog(tableNumber);
    },
    onlinePlayers() {
      return (latestSnapshot.players || []).filter(player => player.id !== sessionId);
    },
    requestHeart() {
      return send({type:"heart_request"});
    },
    giftHeart(targetId) {
      return send({type:"heart_gift",targetId});
    },
    giftHeartAll() {
      return send({type:"heart_gift_all"});
    },
    spinFortune(segments) {
      return send({type:"fortune_spin",segments});
    },
    updateRoomPresence(presence) {
      return updateRoomPresence(presence);
    }
  };

  setConnectionLabel("Подключение к клубу…", false);
  Promise.resolve(window.profileSessionReady)
    .catch(() => null)
    .then(() => {
      sessionId = localStorage.getItem(sessionStorageKey) || sessionId;
      connect();
    });
})();
