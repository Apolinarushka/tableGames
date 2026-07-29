const crypto = require("crypto");
const {Pool} = require("pg");
const {WebSocketServer, WebSocket} = require("ws");

const databaseUrl = process.env.DATABASE_URL;
const pool = new Pool({
  connectionString: databaseUrl,
  max: 10,
  connectionTimeoutMillis: 5000
});

const sockets = new Set();

function safeText(value, maxLength) {
  return String(value || "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, maxLength);
}

async function waitForDatabase() {
  let lastError;
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    try {
      await pool.query("SELECT 1");
      return;
    } catch (error) {
      lastError = error;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  throw lastError;
}

async function initializeDatabase() {
  if (!databaseUrl) throw new Error("DATABASE_URL не задан");
  await waitForDatabase();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS club_players (
      session_id text PRIMARY KEY,
      nickname text NOT NULL,
      connected boolean NOT NULL DEFAULT false,
      looking_for_opponent boolean NOT NULL DEFAULT false,
      looking_game text,
      last_seen timestamptz NOT NULL DEFAULT now()
    );
    ALTER TABLE club_players ADD COLUMN IF NOT EXISTS looking_for_opponent boolean NOT NULL DEFAULT false;
    ALTER TABLE club_players ADD COLUMN IF NOT EXISTS looking_game text;
    CREATE TABLE IF NOT EXISTS club_tables (
      table_number integer PRIMARY KEY CHECK (table_number BETWEEN 1 AND 5),
      player_one text REFERENCES club_players(session_id) ON DELETE SET NULL,
      player_two text REFERENCES club_players(session_id) ON DELETE SET NULL,
      selected_game text,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS club_chat (
      id bigserial PRIMARY KEY,
      session_id text REFERENCES club_players(session_id) ON DELETE SET NULL,
      nickname text NOT NULL,
      message text NOT NULL,
      channel text NOT NULL DEFAULT 'global',
      table_number integer,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    ALTER TABLE club_chat ADD COLUMN IF NOT EXISTS channel text NOT NULL DEFAULT 'global';
    ALTER TABLE club_chat ADD COLUMN IF NOT EXISTS table_number integer;
    CREATE TABLE IF NOT EXISTS club_invitations (
      id uuid PRIMARY KEY,
      from_session text NOT NULL REFERENCES club_players(session_id) ON DELETE CASCADE,
      to_session text NOT NULL REFERENCES club_players(session_id) ON DELETE CASCADE,
      game text NOT NULL DEFAULT 'checkers',
      table_number integer,
      status text NOT NULL DEFAULT 'pending',
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`
    INSERT INTO club_tables(table_number)
    SELECT value FROM generate_series(1, 5) AS value
    ON CONFLICT (table_number) DO NOTHING
  `);
  await pool.query("UPDATE club_players SET connected = false, looking_for_opponent = false");
  await pool.query("UPDATE club_tables SET player_one = NULL, player_two = NULL, updated_at = now()");
}

async function getSnapshot() {
  const [playersResult, tablesResult, chatResult, tableChatResult, invitationsResult] = await Promise.all([
    pool.query(`
      SELECT session_id AS id, nickname,
             looking_for_opponent AS "lookingForOpponent",
             looking_game AS "lookingGame"
      FROM club_players
      WHERE connected = true
      ORDER BY nickname
    `),
    pool.query(`
      SELECT t.table_number AS "tableNumber", t.selected_game AS game,
             p1.nickname AS "playerOne", p2.nickname AS "playerTwo",
             t.player_one AS "playerOneId", t.player_two AS "playerTwoId"
      FROM club_tables t
      LEFT JOIN club_players p1 ON p1.session_id = t.player_one
      LEFT JOIN club_players p2 ON p2.session_id = t.player_two
      ORDER BY t.table_number
    `),
    pool.query(`
      SELECT id, session_id AS "senderId", nickname, message,
             to_char(created_at AT TIME ZONE 'Europe/Moscow', 'HH24:MI') AS time
      FROM club_chat
      WHERE channel = 'global'
      ORDER BY id DESC
      LIMIT 50
    `),
    pool.query(`
      SELECT id, session_id AS "senderId", nickname, message,
             table_number AS "tableNumber",
             to_char(created_at AT TIME ZONE 'Europe/Moscow', 'HH24:MI') AS time
      FROM club_chat
      WHERE channel = 'table'
      ORDER BY id DESC
      LIMIT 100
    `),
    pool.query(`
      SELECT i.id, i.from_session AS "fromId", i.to_session AS "toId",
             sender.nickname AS "fromName", recipient.nickname AS "toName",
             i.game, i.table_number AS "tableNumber", i.status,
             to_char(i.created_at AT TIME ZONE 'Europe/Moscow', 'HH24:MI') AS time
      FROM club_invitations i
      JOIN club_players sender ON sender.session_id = i.from_session
      JOIN club_players recipient ON recipient.session_id = i.to_session
      WHERE i.status = 'pending' AND i.created_at > now() - interval '10 minutes'
      ORDER BY i.created_at DESC
    `)
  ]);
  return {
    type: "snapshot",
    onlineCount: playersResult.rows.length,
    players: playersResult.rows,
    tables: tablesResult.rows,
    messages: chatResult.rows.reverse(),
    tableMessages: tableChatResult.rows.reverse(),
    invitations: invitationsResult.rows
  };
}

async function broadcastSnapshot() {
  const payload = JSON.stringify(await getSnapshot());
  for (const socket of sockets) {
    if (socket.readyState === WebSocket.OPEN) socket.send(payload);
  }
}

async function registerPlayer(socket, data) {
  const proposed = safeText(data.sessionId, 80);
  socket.sessionId = proposed || crypto.randomUUID();
  socket.nickname = safeText(data.nickname, 32) || `Игрок-${socket.sessionId.slice(0, 4)}`;
  await pool.query(`
    INSERT INTO club_players(session_id, nickname, connected, last_seen)
    VALUES ($1, $2, true, now())
    ON CONFLICT (session_id) DO UPDATE
    SET nickname = EXCLUDED.nickname, connected = true, last_seen = now()
  `, [socket.sessionId, socket.nickname]);
  socket.send(JSON.stringify({
    type: "welcome",
    sessionId: socket.sessionId,
    nickname: socket.nickname
  }));
  await broadcastSnapshot();
}

async function joinTable(socket, data) {
  if (!socket.sessionId) return;
  const tableNumber = Number(data.tableNumber);
  if (!Number.isInteger(tableNumber) || tableNumber < 1 || tableNumber > 5) return;
  const game = safeText(data.game, 40) || null;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`
      UPDATE club_tables
      SET player_one = CASE WHEN player_one = $1 THEN NULL ELSE player_one END,
          player_two = CASE WHEN player_two = $1 THEN NULL ELSE player_two END,
          updated_at = now()
      WHERE table_number <> $2
    `, [socket.sessionId, tableNumber]);
    const current = await client.query(
      "SELECT player_one, player_two FROM club_tables WHERE table_number = $1 FOR UPDATE",
      [tableNumber]
    );
    const table = current.rows[0];
    if (table.player_one !== socket.sessionId && table.player_two !== socket.sessionId) {
      if (!table.player_one) {
        await client.query(
          "UPDATE club_tables SET player_one = $1, selected_game = COALESCE($2, selected_game), updated_at = now() WHERE table_number = $3",
          [socket.sessionId, game, tableNumber]
        );
      } else if (!table.player_two) {
        await client.query(
          "UPDATE club_tables SET player_two = $1, selected_game = COALESCE($2, selected_game), updated_at = now() WHERE table_number = $3",
          [socket.sessionId, game, tableNumber]
        );
      } else {
        socket.send(JSON.stringify({type: "error", message: "Этот стол уже занят двумя игроками."}));
      }
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  await broadcastSnapshot();
}

function sendToSessions(sessionIds, payload) {
  const encoded = JSON.stringify(payload);
  for (const socket of sockets) {
    if (sessionIds.includes(socket.sessionId) && socket.readyState === WebSocket.OPEN) {
      socket.send(encoded);
    }
  }
}

async function createMatch(firstId, secondId, game = "checkers", preferredTable = null) {
  const client = await pool.connect();
  let match;
  try {
    await client.query("BEGIN");
    const players = await client.query(`
      SELECT session_id, nickname
      FROM club_players
      WHERE session_id = ANY($1::text[]) AND connected = true
      FOR UPDATE
    `, [[firstId, secondId]]);
    if (players.rows.length !== 2) throw new Error("Один из игроков уже вышел из клуба.");
    await client.query(`
      UPDATE club_tables
      SET player_one = CASE WHEN player_one = ANY($1::text[]) THEN NULL ELSE player_one END,
          player_two = CASE WHEN player_two = ANY($1::text[]) THEN NULL ELSE player_two END,
          updated_at = now()
      WHERE player_one = ANY($1::text[]) OR player_two = ANY($1::text[])
    `, [[firstId, secondId]]);
    const tableResult = await client.query(`
      SELECT table_number
      FROM club_tables
      WHERE player_one IS NULL AND player_two IS NULL
      ORDER BY CASE WHEN table_number = $1 THEN 0 ELSE 1 END, table_number
      LIMIT 1
      FOR UPDATE
    `, [Number(preferredTable) || 0]);
    if (!tableResult.rows.length) throw new Error("Сейчас нет свободного стола.");
    const tableNumber = tableResult.rows[0].table_number;
    await client.query(`
      UPDATE club_tables
      SET player_one = $1, player_two = $2, selected_game = $3, updated_at = now()
      WHERE table_number = $4
    `, [firstId, secondId, safeText(game, 40) || "checkers", tableNumber]);
    await client.query(`
      UPDATE club_players
      SET looking_for_opponent = false, looking_game = NULL
      WHERE session_id = ANY($1::text[])
    `, [[firstId, secondId]]);
    const names = Object.fromEntries(players.rows.map(player => [player.session_id, player.nickname]));
    match = {
      type: "match_ready",
      tableNumber,
      game: safeText(game, 40) || "checkers",
      players: [
        {id: firstId, nickname: names[firstId]},
        {id: secondId, nickname: names[secondId]}
      ]
    };
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  sendToSessions([firstId, secondId], match);
  await broadcastSnapshot();
  return match;
}

async function invitePlayer(socket, data) {
  if (!socket.sessionId) return;
  const targetId = safeText(data.targetId, 80);
  if (!targetId || targetId === socket.sessionId) return;
  const game = safeText(data.game, 40) || "checkers";
  const target = await pool.query(
    "SELECT nickname FROM club_players WHERE session_id = $1 AND connected = true",
    [targetId]
  );
  if (!target.rows.length) {
    socket.send(JSON.stringify({type: "error", message: "Игрок уже вышел из клуба."}));
    return;
  }
  await pool.query(`
    UPDATE club_invitations
    SET status = 'cancelled'
    WHERE from_session = $1 AND to_session = $2 AND status = 'pending'
  `, [socket.sessionId, targetId]);
  const invitationId = crypto.randomUUID();
  await pool.query(`
    INSERT INTO club_invitations(id, from_session, to_session, game, table_number)
    VALUES ($1, $2, $3, $4, $5)
  `, [invitationId, socket.sessionId, targetId, game, Number(data.tableNumber) || null]);
  socket.send(JSON.stringify({
    type: "notice",
    message: `Приглашение отправлено игроку ${target.rows[0].nickname}.`
  }));
  await broadcastSnapshot();
}

async function replyToInvitation(socket, data) {
  if (!socket.sessionId) return;
  const invitationId = safeText(data.invitationId, 80);
  const invitationResult = await pool.query(`
    SELECT * FROM club_invitations
    WHERE id = $1 AND to_session = $2 AND status = 'pending'
  `, [invitationId, socket.sessionId]);
  if (!invitationResult.rows.length) return;
  const invitation = invitationResult.rows[0];
  if (data.accept !== true) {
    await pool.query("UPDATE club_invitations SET status = 'declined' WHERE id = $1", [invitationId]);
    sendToSessions([invitation.from_session], {
      type: "notice",
      message: `${socket.nickname} отклонил приглашение.`
    });
    await broadcastSnapshot();
    return;
  }
  await pool.query("UPDATE club_invitations SET status = 'accepted' WHERE id = $1", [invitationId]);
  await createMatch(
    invitation.from_session,
    invitation.to_session,
    invitation.game,
    invitation.table_number
  );
}

async function setLookingForOpponent(socket, data) {
  if (!socket.sessionId) return;
  const active = data.active === true;
  const game = safeText(data.game, 40) || "checkers";
  await pool.query(`
    UPDATE club_players
    SET looking_for_opponent = $2, looking_game = CASE WHEN $2 THEN $3 ELSE NULL END
    WHERE session_id = $1
  `, [socket.sessionId, active, game]);
  if (!active) {
    await broadcastSnapshot();
    return;
  }
  const candidate = await pool.query(`
    SELECT session_id, looking_game
    FROM club_players
    WHERE connected = true AND looking_for_opponent = true AND session_id <> $1
    ORDER BY CASE WHEN looking_game = $2 THEN 0 ELSE 1 END, last_seen
    LIMIT 1
  `, [socket.sessionId, game]);
  if (candidate.rows.length) {
    await createMatch(socket.sessionId, candidate.rows[0].session_id, game);
  } else {
    socket.send(JSON.stringify({
      type: "notice",
      message: "Поиск соперника включён. Приглашение увидят все активные игроки."
    }));
    await broadcastSnapshot();
  }
}

async function leaveTables(sessionId) {
  if (!sessionId) return;
  await pool.query(`
    UPDATE club_tables
    SET player_one = CASE WHEN player_one = $1 THEN NULL ELSE player_one END,
        player_two = CASE WHEN player_two = $1 THEN NULL ELSE player_two END,
        updated_at = now()
    WHERE player_one = $1 OR player_two = $1
  `, [sessionId]);
}

async function addChat(socket, data) {
  if (!socket.sessionId) return;
  const message = safeText(data.message, 300);
  if (!message) return;
  const channel = data.channel === "table" ? "table" : "global";
  const tableNumber = channel === "table" ? Number(data.tableNumber) : null;
  if (channel === "table") {
    const membership = await pool.query(`
      SELECT 1 FROM club_tables
      WHERE table_number = $1 AND (player_one = $2 OR player_two = $2)
    `, [tableNumber, socket.sessionId]);
    if (!membership.rows.length) return;
  }
  await pool.query(
    "INSERT INTO club_chat(session_id, nickname, message, channel, table_number) VALUES ($1, $2, $3, $4, $5)",
    [socket.sessionId, socket.nickname, message, channel, tableNumber]
  );
  await pool.query(`
    DELETE FROM club_chat
    WHERE id NOT IN (SELECT id FROM club_chat ORDER BY id DESC LIMIT 500)
  `);
  await broadcastSnapshot();
}

function attachOnlineServer(server) {
  const webSockets = new WebSocketServer({server, path: "/ws"});
  webSockets.on("connection", socket => {
    sockets.add(socket);
    socket.isAlive = true;
    socket.on("pong", () => { socket.isAlive = true; });
    socket.on("message", async raw => {
      try {
        const data = JSON.parse(String(raw));
        if (data.type === "hello") await registerPlayer(socket, data);
        else if (data.type === "chat") await addChat(socket, data);
        else if (data.type === "table_join") await joinTable(socket, data);
        else if (data.type === "invite") await invitePlayer(socket, data);
        else if (data.type === "invite_reply") await replyToInvitation(socket, data);
        else if (data.type === "looking_for_opponent") await setLookingForOpponent(socket, data);
        else if (data.type === "table_leave") {
          await leaveTables(socket.sessionId);
          await broadcastSnapshot();
        }
      } catch (error) {
        console.error("Ошибка WebSocket:", error.message);
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({type: "error", message: "Сервер не смог обработать действие."}));
        }
      }
    });
    socket.on("close", async () => {
      sockets.delete(socket);
      if (!socket.sessionId) return;
      const sameSessionIsOpen = [...sockets].some(item =>
        item !== socket && item.sessionId === socket.sessionId && item.readyState === WebSocket.OPEN
      );
      if (sameSessionIsOpen) return;
      try {
        await pool.query(
          "UPDATE club_players SET connected = false, looking_for_opponent = false, looking_game = NULL, last_seen = now() WHERE session_id = $1",
          [socket.sessionId]
        );
        await leaveTables(socket.sessionId);
        await broadcastSnapshot();
      } catch (error) {
        console.error("Ошибка отключения игрока:", error.message);
      }
    });
  });

  const heartbeat = setInterval(() => {
    for (const socket of sockets) {
      if (!socket.isAlive) {
        socket.terminate();
        continue;
      }
      socket.isAlive = false;
      socket.ping();
    }
  }, 30000);
  heartbeat.unref();
}

async function handleOnlineHttp(request, response, requestPath) {
  if (requestPath === "/health") {
    try {
      await pool.query("SELECT 1");
      response.writeHead(200, {"Content-Type": "application/json; charset=utf-8"});
      response.end(JSON.stringify({status: "ok", database: "connected", websocket: true}));
    } catch (error) {
      response.writeHead(503, {"Content-Type": "application/json; charset=utf-8"});
      response.end(JSON.stringify({status: "error", database: "unavailable"}));
    }
    return true;
  }
  if (requestPath === "/api/club") {
    response.writeHead(200, {"Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store"});
    response.end(JSON.stringify(await getSnapshot()));
    return true;
  }
  return false;
}

module.exports = {
  attachOnlineServer,
  handleOnlineHttp,
  initializeDatabase
};
