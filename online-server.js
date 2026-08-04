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
const sessionCookieName = "table_games_session";
const supportedGames = new Set(["checkers", "giveaway", "corners", "chess", "domino", "fives"]);
const supportedLevels = new Set(["A1", "A2", "B1", "B2", "V1", "V2"]);
const searchRequestTtlMs = 30_000;
const roomPresence = new Map();
const heartMax = 10;
const heartFirstRestoreMs = 10 * 60 * 1000;
const heartNextRestoreMs = 15 * 60 * 1000;
// Временно отключено для тестирования колеса. Вернуть: 12 * 60 * 60 * 1000.
const fortuneCooldownMs = 0;

function tableX(tableNumber) {
  const panel = Math.floor((Number(tableNumber) - 1) / 3);
  return panel * 100 + [20, 50, 80][(Number(tableNumber) - 1) % 3];
}

function guestSpawnX(guestSlot) {
  const tableNumber = Math.ceil(Number(guestSlot) / 2);
  return tableX(tableNumber) + (Number(guestSlot) % 2 ? -7 : 7);
}

function safeText(value, maxLength) {
  return String(value || "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, maxLength);
}

function safeSessionId(value) {
  const sessionId = safeText(value, 80);
  return /^[a-zA-Z0-9_-]{12,80}$/.test(sessionId) ? sessionId : "";
}

function parseCookies(request) {
  return Object.fromEntries(
    String(request.headers.cookie || "")
      .split(";")
      .map(part => part.trim())
      .filter(Boolean)
      .map(part => {
        const separator = part.indexOf("=");
        if (separator < 0) return [part, ""];
        return [part.slice(0, separator), decodeURIComponent(part.slice(separator + 1))];
      })
  );
}

function sessionIdFromRequest(request) {
  const cookies = parseCookies(request);
  return safeSessionId(cookies[sessionCookieName])
    || safeSessionId(request.headers["x-session-id"])
    || crypto.randomUUID();
}

function sessionCookie(request, sessionId) {
  const forwardedProtocol = safeText(request.headers["x-forwarded-proto"], 20).toLowerCase();
  const secure = request.socket.encrypted || forwardedProtocol === "https";
  return `${sessionCookieName}=${encodeURIComponent(sessionId)}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
}

function sendJson(response, status, payload, headers = {}) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers
  });
  response.end(JSON.stringify(payload));
}

function readJsonBody(request, maximumBytes = 1200000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let settled = false;
    request.on("data", chunk => {
      if (settled) return;
      total += chunk.length;
      if (total > maximumBytes) {
        settled = true;
        reject(Object.assign(new Error("payload_too_large"), {statusCode: 413}));
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      if (settled) return;
      try {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve(text ? JSON.parse(text) : {});
      } catch {
        reject(Object.assign(new Error("invalid_json"), {statusCode: 400}));
      }
    });
    request.on("error", reject);
  });
}

function safeInteger(value, fallback, minimum, maximum) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.round(number)));
}

function safeGame(value) {
  const game = safeText(value, 40);
  return supportedGames.has(game) ? game : "checkers";
}

function safeLevel(value) {
  const level = safeText(value, 8);
  return supportedLevels.has(level) ? level : "B1";
}

function normalizeHeartState(value, now = Date.now()) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const currentValue = Number(source.current ?? heartMax);
  const state = {
    current: Math.min(heartMax, Math.max(0, Number.isFinite(currentValue) ? Math.round(currentValue) : heartMax)),
    nextHeartAt: null,
    nextDurationMs: Number(source.nextDurationMs) === heartNextRestoreMs ? heartNextRestoreMs : heartFirstRestoreMs
  };
  let nextAt = Date.parse(String(source.nextHeartAt || ""));
  if (state.current < heartMax && !Number.isFinite(nextAt)) {
    state.nextDurationMs = heartFirstRestoreMs;
    nextAt = now + heartFirstRestoreMs;
  }
  while (state.current < heartMax && now >= nextAt) {
    state.current += 1;
    if (state.current >= heartMax) break;
    state.nextDurationMs = heartNextRestoreMs;
    nextAt += heartNextRestoreMs;
  }
  if (state.current < heartMax) state.nextHeartAt = new Date(nextAt).toISOString();
  else state.nextDurationMs = heartFirstRestoreMs;
  return state;
}

function normalizeFortuneState(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const parsedNext = Date.parse(String(source.nextSpinAt || ""));
  return {
    nextSpinAt: Number.isFinite(parsedNext) ? new Date(parsedNext).toISOString() : null,
    lastReward: safeInteger(source.lastReward, 0, 0, 6)
  };
}

function sanitizeProfile(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const allowedPhoto = typeof source.photo === "string"
    && /^data:image\/(?:png|jpeg|webp);base64,/i.test(source.photo)
    && source.photo.length <= 900000
      ? source.photo
      : "";
  const allowedStyles = {
    hairStyle: new Set(["hair-wave", "hair-bob", "hair-bun", "hair-short"]),
    faceStyle: new Set(["face-smile", "face-calm", "face-freckles"]),
    mustacheStyle: new Set(["mustache-none", "mustache-thin", "mustache-classic", "mustache-handlebar"]),
    botLevel: new Set(["A1", "A2", "B1", "B2", "V1", "V2"])
  };
  const games = Array.isArray(source.games)
    ? source.games.slice(-500).map(game => ({
        result: safeText(game?.result, 24),
        opponent: safeText(game?.opponent, 48),
        date: safeText(game?.date, 32),
        delta: safeInteger(game?.delta, 0, -1000, 1000)
      }))
    : [];
  const interests = Array.isArray(source.interests)
    ? [...new Set(source.interests.map(item => safeText(item, 60)).filter(Boolean))].slice(0, 10)
    : [];
  const timeValue = (value, fallback) => /^\d{2}:\d{2}$/.test(String(value || "")) ? String(value) : fallback;
  const choice = (key, fallback) => allowedStyles[key].has(source[key]) ? source[key] : fallback;
  return {
    name: safeText(source.name, 32) || "Гость",
    city: safeText(source.city, 80),
    birthDate: safeText(source.birthDate, 10),
    interests,
    timezone: safeText(source.timezone, 80) || "Europe/Moscow",
    activityFrom: timeValue(source.activityFrom, "18:00"),
    activityTo: timeValue(source.activityTo, "23:00"),
    photo: allowedPhoto,
    authProvider: safeText(source.authProvider, 40),
    clothes: safeText(source.clothes, 24) || "#c84a42",
    hair: safeText(source.hair, 24) || "#4a2d22",
    skin: safeText(source.skin, 24) || "#d9a77f",
    hairStyle: choice("hairStyle", "hair-wave"),
    faceStyle: choice("faceStyle", "face-smile"),
    mustacheStyle: choice("mustacheStyle", "mustache-none"),
    botLevel: choice("botLevel", "B1"),
    rating: safeInteger(source.rating, 1000, 0, 100000),
    games,
    winStreak: safeInteger(source.winStreak, 0, 0, 100000),
    bestWinStreak: safeInteger(source.bestWinStreak, 0, 0, 100000),
    hearts: normalizeHeartState(source.hearts),
    clubCoins: safeInteger(source.clubCoins, 200, 0, 1000000),
    fortune: normalizeFortuneState(source.fortune)
  };
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
      looking_level text,
      looking_started_at timestamptz,
      guest_slot integer,
      last_seen timestamptz NOT NULL DEFAULT now()
    );
    ALTER TABLE club_players ADD COLUMN IF NOT EXISTS looking_for_opponent boolean NOT NULL DEFAULT false;
    ALTER TABLE club_players ADD COLUMN IF NOT EXISTS looking_game text;
    ALTER TABLE club_players ADD COLUMN IF NOT EXISTS looking_level text;
    ALTER TABLE club_players ADD COLUMN IF NOT EXISTS looking_started_at timestamptz;
    ALTER TABLE club_players ADD COLUMN IF NOT EXISTS guest_slot integer;
    CREATE UNIQUE INDEX IF NOT EXISTS club_players_active_guest_slot_idx
      ON club_players(guest_slot)
      WHERE connected = true AND guest_slot IS NOT NULL;
    ALTER TABLE club_players ADD COLUMN IF NOT EXISTS profile jsonb NOT NULL DEFAULT '{}'::jsonb;
    ALTER TABLE club_players ADD COLUMN IF NOT EXISTS profile_completed boolean NOT NULL DEFAULT false;
    CREATE TABLE IF NOT EXISTS club_tables (
      table_number integer PRIMARY KEY,
      player_one text REFERENCES club_players(session_id) ON DELETE SET NULL,
      player_two text REFERENCES club_players(session_id) ON DELETE SET NULL,
      player_one_seat text,
      player_two_seat text,
      selected_game text,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    ALTER TABLE club_tables DROP CONSTRAINT IF EXISTS club_tables_table_number_check;
    ALTER TABLE club_tables ADD COLUMN IF NOT EXISTS player_one_seat text;
    ALTER TABLE club_tables ADD COLUMN IF NOT EXISTS player_two_seat text;
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
      level text NOT NULL DEFAULT 'B1',
      table_number integer,
      status text NOT NULL DEFAULT 'pending',
      created_at timestamptz NOT NULL DEFAULT now()
    );
    ALTER TABLE club_invitations ADD COLUMN IF NOT EXISTS level text NOT NULL DEFAULT 'B1';
    CREATE TABLE IF NOT EXISTS club_heart_requests (
      requester_session text PRIMARY KEY REFERENCES club_players(session_id) ON DELETE CASCADE,
      requested_at timestamptz NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`
    INSERT INTO club_tables(table_number)
    SELECT value FROM generate_series(1, 3) AS value
    ON CONFLICT (table_number) DO NOTHING
  `);
  await pool.query("UPDATE club_players SET connected = false, looking_for_opponent = false, looking_game = NULL, looking_level = NULL, looking_started_at = NULL, guest_slot = NULL");
  await pool.query("UPDATE club_tables SET player_one = NULL, player_two = NULL, player_one_seat = NULL, player_two_seat = NULL, updated_at = now()");
  await pool.query("DELETE FROM club_chat WHERE message LIKE 'Просит помочь с попыткой:%'");
}

async function getSnapshot() {
  await expireSearchRequests();
  const capacityResult = await pool.query(`
    SELECT GREATEST(
      3,
      CEIL(COUNT(*)::numeric / 2)::integer,
      COALESCE((
        SELECT MAX(table_number)
        FROM club_tables
        WHERE player_one IS NOT NULL OR player_two IS NOT NULL
      ), 3)
    ) AS "tableCount"
    FROM club_players
    WHERE connected = true
  `);
  const tableCount = Number(capacityResult.rows[0]?.tableCount) || 3;
  await pool.query(`
    INSERT INTO club_tables(table_number)
    SELECT value FROM generate_series(1, $1) AS value
    ON CONFLICT (table_number) DO NOTHING
  `, [tableCount]);
  const [playersResult, tablesResult, chatResult, tableChatResult, invitationsResult, heartRequestsResult] = await Promise.all([
    pool.query(`
      SELECT session_id AS id, nickname,
             (looking_for_opponent AND looking_started_at > now() - interval '30 seconds') AS "lookingForOpponent",
             looking_game AS "lookingGame",
             looking_level AS "lookingLevel",
             guest_slot AS "guestSlot",
             CASE
               WHEN looking_for_opponent AND looking_started_at IS NOT NULL
               THEN GREATEST(
                 0,
                 CEIL(EXTRACT(EPOCH FROM (looking_started_at + interval '30 seconds' - now())))
               )::integer
               ELSE 0
             END AS "lookingSecondsLeft"
      FROM club_players
      WHERE connected = true
      ORDER BY nickname
    `),
    pool.query(`
      SELECT t.table_number AS "tableNumber", t.selected_game AS game,
             p1.nickname AS "playerOne", p2.nickname AS "playerTwo",
             t.player_one AS "playerOneId", t.player_two AS "playerTwoId",
             t.player_one_seat AS "playerOneSeat", t.player_two_seat AS "playerTwoSeat"
      FROM club_tables t
      LEFT JOIN club_players p1 ON p1.session_id = t.player_one
      LEFT JOIN club_players p2 ON p2.session_id = t.player_two
      WHERE t.table_number <= $1
      ORDER BY t.table_number
    `, [tableCount]),
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
      WHERE channel = 'table' AND table_number <= $1
      ORDER BY id DESC
      LIMIT 100
    `, [tableCount]),
    pool.query(`
      SELECT i.id, i.from_session AS "fromId", i.to_session AS "toId",
             sender.nickname AS "fromName", recipient.nickname AS "toName",
             i.game, i.level, i.table_number AS "tableNumber", i.status,
             to_char(i.created_at AT TIME ZONE 'Europe/Moscow', 'HH24:MI') AS time
      FROM club_invitations i
      JOIN club_players sender ON sender.session_id = i.from_session
      JOIN club_players recipient ON recipient.session_id = i.to_session
      WHERE i.status = 'pending' AND i.created_at > now() - interval '10 minutes'
      ORDER BY i.created_at DESC
    `),
    pool.query(`
      SELECT r.requester_session AS "requesterId", p.nickname,
             to_char(r.requested_at AT TIME ZONE 'Europe/Moscow', 'HH24:MI') AS time
      FROM club_heart_requests r
      JOIN club_players p ON p.session_id = r.requester_session
      WHERE r.requested_at > now() - interval '24 hours'
      ORDER BY r.requested_at
    `)
  ]);
  for (const player of playersResult.rows) {
    const presence = roomPresence.get(player.id);
    const fallbackX = guestSpawnX(Number(player.guestSlot) || 1);
    player.roomX = presence?.x ?? fallbackX;
    player.roomY = presence?.y ?? 69;
    player.roomFacing = presence?.facing || "left";
  }
  return {
    type: "snapshot",
    tableCount,
    roomWidthUnits: Math.ceil(tableCount / 3) * 100,
    onlineCount: playersResult.rows.length,
    players: playersResult.rows,
    tables: tablesResult.rows,
    messages: chatResult.rows.reverse(),
    tableMessages: tableChatResult.rows.reverse(),
    invitations: invitationsResult.rows,
    heartRequests: heartRequestsResult.rows
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
  const client = await pool.connect();
  let guestSlot;
  try {
    await client.query("BEGIN");
    await client.query("LOCK TABLE club_players IN SHARE ROW EXCLUSIVE MODE");
    const existing = await client.query(
      "SELECT guest_slot FROM club_players WHERE session_id = $1 FOR UPDATE",
      [socket.sessionId]
    );
    guestSlot = Number(existing.rows[0]?.guest_slot) || null;
    if (!guestSlot) {
      const freeSlot = await client.query(`
        WITH limits AS (
          SELECT COALESCE(MAX(guest_slot), 0) + 1 AS maximum
          FROM club_players
          WHERE connected = true
        )
        SELECT slot
        FROM limits, generate_series(1, limits.maximum) AS slot
        WHERE NOT EXISTS (
          SELECT 1
          FROM club_players
          WHERE connected = true AND guest_slot = slot
        )
        ORDER BY slot
        LIMIT 1
      `);
      guestSlot = Number(freeSlot.rows[0]?.slot) || null;
    }
    await client.query(`
      INSERT INTO club_players(session_id, nickname, connected, guest_slot, last_seen)
      VALUES ($1, $2, true, $3, now())
      ON CONFLICT (session_id) DO UPDATE
      SET nickname = EXCLUDED.nickname,
          connected = true,
          guest_slot = EXCLUDED.guest_slot,
          last_seen = now()
    `, [socket.sessionId, socket.nickname, guestSlot]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  socket.guestSlot = guestSlot;
  if (!roomPresence.has(socket.sessionId)) {
    roomPresence.set(socket.sessionId, {
      x: guestSpawnX(guestSlot),
      y: 69,
      facing: "left"
    });
  }
  socket.send(JSON.stringify({
    type: "welcome",
    sessionId: socket.sessionId,
    nickname: socket.nickname,
    guestSlot
  }));
  await broadcastSnapshot();
}

function updateRoomPresence(socket, data) {
  if (!socket.sessionId) return;
  const activeSessions = new Set(
    [...sockets]
      .filter(item => item.sessionId && item.readyState === WebSocket.OPEN)
      .map(item => item.sessionId)
  );
  const tableCount = Math.max(3, Math.ceil(activeSessions.size / 2));
  const roomWidth = Math.ceil(tableCount / 3) * 100;
  const x = Math.max(7, Math.min(roomWidth - 4, Number(data.x) || 94));
  const y = 69;
  const facing = data.facing === "right" ? "right" : "left";
  roomPresence.set(socket.sessionId, {x, y, facing});
  const encoded = JSON.stringify({
    type: "room_presence",
    playerId: socket.sessionId,
    x,
    y,
    facing
  });
  for (const client of sockets) {
    if (client !== socket && client.readyState === WebSocket.OPEN) client.send(encoded);
  }
}

async function joinTable(socket, data) {
  if (!socket.sessionId) return;
  const tableNumber = Number(data.tableNumber);
  if (!Number.isInteger(tableNumber) || tableNumber < 1 || tableNumber > 1000) return;
  const game = safeText(data.game, 40) || null;
  const requestedSeat = data.seatSide === "right"
    ? "right"
    : data.seatSide === "left"
      ? "left"
      : null;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "INSERT INTO club_tables(table_number) VALUES ($1) ON CONFLICT (table_number) DO NOTHING",
      [tableNumber]
    );
    await client.query(`
      UPDATE club_tables
      SET player_one_seat = CASE WHEN player_one = $1 THEN NULL ELSE player_one_seat END,
          player_two_seat = CASE WHEN player_two = $1 THEN NULL ELSE player_two_seat END,
          player_one = CASE WHEN player_one = $1 THEN NULL ELSE player_one END,
          player_two = CASE WHEN player_two = $1 THEN NULL ELSE player_two END,
          updated_at = now()
      WHERE table_number <> $2
    `, [socket.sessionId, tableNumber]);
    const current = await client.query(
      "SELECT player_one, player_two, player_one_seat, player_two_seat FROM club_tables WHERE table_number = $1 FOR UPDATE",
      [tableNumber]
    );
    const table = current.rows[0];
    const currentSlot = table.player_one === socket.sessionId
      ? "one"
      : table.player_two === socket.sessionId
        ? "two"
        : null;
    const occupiedSeats = new Map();
    if (table.player_one) occupiedSeats.set(table.player_one_seat || "left", table.player_one);
    if (table.player_two) occupiedSeats.set(table.player_two_seat || "right", table.player_two);
    const currentSeat = currentSlot === "one"
      ? table.player_one_seat
      : currentSlot === "two"
        ? table.player_two_seat
        : null;
    const seatSide = requestedSeat || currentSeat || (!occupiedSeats.has("left") ? "left" : "right");
    const seatOwner = occupiedSeats.get(seatSide);

    if (seatOwner && seatOwner !== socket.sessionId) {
      await client.query("ROLLBACK");
      socket.send(JSON.stringify({
        type: "error",
        code: "seat_taken",
        message: "Этот стул уже занят другой гостьей."
      }));
      return;
    }

    const slot = currentSlot || (!table.player_one ? "one" : !table.player_two ? "two" : null);
    if (!slot) {
      await client.query("ROLLBACK");
      socket.send(JSON.stringify({
        type: "error",
        code: "table_full",
        message: "Этот стол уже занят двумя игроками."
      }));
      return;
    }

    if (slot === "one") {
      await client.query(`
        UPDATE club_tables
        SET player_one = $1, player_one_seat = $2,
            selected_game = COALESCE($3, selected_game), updated_at = now()
        WHERE table_number = $4
      `, [socket.sessionId, seatSide, game, tableNumber]);
    } else {
      await client.query(`
        UPDATE club_tables
        SET player_two = $1, player_two_seat = $2,
            selected_game = COALESCE($3, selected_game), updated_at = now()
        WHERE table_number = $4
      `, [socket.sessionId, seatSide, game, tableNumber]);
    }
    await client.query("COMMIT");
    socket.send(JSON.stringify({type: "table_joined", tableNumber, seatSide}));
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

async function expireSearchRequests() {
  const result = await pool.query(`
    UPDATE club_players
    SET looking_for_opponent = false,
        looking_game = NULL,
        looking_level = NULL,
        looking_started_at = NULL
    WHERE looking_for_opponent = true
      AND looking_started_at IS NOT NULL
      AND looking_started_at <= now() - interval '30 seconds'
    RETURNING session_id
  `);
  if (result.rows.length) {
    sendToSessions(result.rows.map(row => row.session_id), {
      type: "notice",
      message: "30 секунд истекли. Заявка на поиск соперника аннулирована."
    });
  }
  return result.rowCount;
}

function scheduleSearchExpiration() {
  const timer = setTimeout(async () => {
    try {
      const expired = await expireSearchRequests();
      if (expired) await broadcastSnapshot();
    } catch (error) {
      console.error("Ошибка завершения поиска соперника:", error.message);
    }
  }, searchRequestTtlMs + 150);
  timer.unref?.();
}

async function createMatch(firstId, secondId, game = "checkers", preferredTable = null, level = "B1") {
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
    const capacityResult = await client.query(`
      SELECT GREATEST(3, CEIL(COUNT(*)::numeric / 2)::integer) AS "tableCount"
      FROM club_players
      WHERE connected = true
    `);
    const tableCount = Number(capacityResult.rows[0]?.tableCount) || 3;
    await client.query(`
      INSERT INTO club_tables(table_number)
      SELECT value FROM generate_series(1, $1) AS value
      ON CONFLICT (table_number) DO NOTHING
    `, [tableCount]);
    await client.query(`
      UPDATE club_tables
      SET player_one_seat = CASE WHEN player_one = ANY($1::text[]) THEN NULL ELSE player_one_seat END,
          player_two_seat = CASE WHEN player_two = ANY($1::text[]) THEN NULL ELSE player_two_seat END,
          player_one = CASE WHEN player_one = ANY($1::text[]) THEN NULL ELSE player_one END,
          player_two = CASE WHEN player_two = ANY($1::text[]) THEN NULL ELSE player_two END,
          updated_at = now()
      WHERE player_one = ANY($1::text[]) OR player_two = ANY($1::text[])
    `, [[firstId, secondId]]);
    const tableResult = await client.query(`
      SELECT table_number
      FROM club_tables
      WHERE table_number <= $2 AND player_one IS NULL AND player_two IS NULL
      ORDER BY CASE WHEN table_number = $1 THEN 0 ELSE 1 END, table_number
      LIMIT 1
      FOR UPDATE
    `, [Number(preferredTable) || 0, tableCount]);
    if (!tableResult.rows.length) throw new Error("Сейчас нет свободного стола.");
    const tableNumber = tableResult.rows[0].table_number;
    await client.query(`
      UPDATE club_tables
      SET player_one = $1, player_two = $2,
          player_one_seat = 'left', player_two_seat = 'right',
          selected_game = $3, updated_at = now()
      WHERE table_number = $4
    `, [firstId, secondId, safeGame(game), tableNumber]);
    await client.query(`
      UPDATE club_players
      SET looking_for_opponent = false, looking_game = NULL, looking_level = NULL,
          looking_started_at = NULL
      WHERE session_id = ANY($1::text[])
    `, [[firstId, secondId]]);
    const names = Object.fromEntries(players.rows.map(player => [player.session_id, player.nickname]));
    const firstIsWhite = crypto.randomInt(0, 2) === 0;
    match = {
      type: "match_ready",
      matchId: crypto.randomUUID(),
      tableNumber,
      game: safeGame(game),
      level: safeLevel(level),
      seed: crypto.randomBytes(8).readBigUInt64BE().toString(),
      coinResult: firstIsWhite ? "tails" : "heads",
      starterId: crypto.randomInt(0, 2) === 0 ? firstId : secondId,
      players: [
        {id: firstId, nickname: names[firstId], color: firstIsWhite ? "white" : "black"},
        {id: secondId, nickname: names[secondId], color: firstIsWhite ? "black" : "white"}
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
  const game = safeGame(data.game);
  const level = safeLevel(data.level);
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
    INSERT INTO club_invitations(id, from_session, to_session, game, level, table_number)
    VALUES ($1, $2, $3, $4, $5, $6)
  `, [invitationId, socket.sessionId, targetId, game, level, Number(data.tableNumber) || null]);
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
    invitation.table_number,
    invitation.level
  );
}

async function setLookingForOpponent(socket, data) {
  if (!socket.sessionId) return;
  const active = data.active === true;
  const game = safeGame(data.game);
  const level = safeLevel(data.level);
  await pool.query(`
    UPDATE club_players
    SET looking_for_opponent = $2,
        looking_game = CASE WHEN $2 THEN $3 ELSE NULL END,
        looking_level = CASE WHEN $2 THEN $4 ELSE NULL END,
        looking_started_at = CASE WHEN $2 THEN now() ELSE NULL END
    WHERE session_id = $1
  `, [socket.sessionId, active, game, level]);
  if (!active) {
    await broadcastSnapshot();
    return;
  }
  socket.send(JSON.stringify({
    type: "notice",
    message: `Поиск соперника включён на 30 секунд: ${game}, уровень ${level}.`
  }));
  scheduleSearchExpiration();
  await broadcastSnapshot();
}

async function acceptSearch(socket, data) {
  if (!socket.sessionId) return;
  const targetId = safeSessionId(data.targetId);
  if (!targetId || targetId === socket.sessionId) return;
  const target = await pool.query(`
    SELECT looking_game, looking_level
    FROM club_players
    WHERE session_id = $1
      AND connected = true
      AND looking_for_opponent = true
      AND looking_started_at > now() - interval '30 seconds'
  `, [targetId]);
  if (!target.rows.length) {
    socket.send(JSON.stringify({type: "error", message: "Этот игрок уже нашёл соперника."}));
    return;
  }
  await createMatch(
    targetId,
    socket.sessionId,
    target.rows[0].looking_game,
    Number(data.tableNumber) || null,
    target.rows[0].looking_level
  );
}

async function relayGameAction(socket, data) {
  if (!socket.sessionId || !data.action || typeof data.action !== "object") return;
  const tableNumber = Number(data.tableNumber);
  const encodedAction = JSON.stringify(data.action);
  if (!Number.isInteger(tableNumber) || tableNumber < 1 || tableNumber > 1000 || encodedAction.length > 50000) return;
  const table = await pool.query(`
    SELECT player_one, player_two, selected_game
    FROM club_tables
    WHERE table_number = $1 AND (player_one = $2 OR player_two = $2)
  `, [tableNumber, socket.sessionId]);
  if (!table.rows.length) return;
  const row = table.rows[0];
  const recipientId = row.player_one === socket.sessionId ? row.player_two : row.player_one;
  if (!recipientId) return;
  sendToSessions([recipientId], {
    type: "game_action",
    tableNumber,
    game: row.selected_game,
    action: data.action
  });
}

async function leaveTables(sessionId) {
  if (!sessionId) return;
  await pool.query(`
    UPDATE club_tables
    SET player_one_seat = CASE WHEN player_one = $1 THEN NULL ELSE player_one_seat END,
        player_two_seat = CASE WHEN player_two = $1 THEN NULL ELSE player_two_seat END,
        player_one = CASE WHEN player_one = $1 THEN NULL ELSE player_one END,
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

function sendToSession(sessionId, payload) {
  const serialized = JSON.stringify(payload);
  for (const clientSocket of sockets) {
    if (clientSocket.sessionId === sessionId && clientSocket.readyState === WebSocket.OPEN) {
      clientSocket.send(serialized);
    }
  }
}

async function requestHeart(socket) {
  if (!socket.sessionId) return;
  const result = await pool.query("SELECT profile FROM club_players WHERE session_id = $1", [socket.sessionId]);
  const savedProfile = sanitizeProfile(result.rows[0]?.profile);
  if (normalizeHeartState(savedProfile.hearts).current >= heartMax) {
    sendToSession(socket.sessionId, {type:"notice",message:"Все десять сердец уже заполнены — помощь пока не нужна."});
    return;
  }
  await pool.query(`
    INSERT INTO club_heart_requests(requester_session, requested_at)
    VALUES ($1, now())
    ON CONFLICT (requester_session) DO UPDATE SET requested_at = now()
  `, [socket.sessionId]);
  sendToSession(socket.sessionId, {type:"notice",message:"Просьба отправлена в клубный ящик помощи."});
  await broadcastSnapshot();
}

async function giftHeart(socket, data) {
  if (!socket.sessionId) return;
  const targetId = safeSessionId(data.targetId);
  if (!targetId || targetId === socket.sessionId) return;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(`
      SELECT p.session_id, p.nickname, p.profile
      FROM club_heart_requests r
      JOIN club_players p ON p.session_id = r.requester_session
      WHERE r.requester_session = $1
      FOR UPDATE OF p, r
    `, [targetId]);
    const targetRow = result.rows[0];
    if (!targetRow) {
      throw Object.assign(new Error("request_closed"), {publicMessage:"Эта просьба уже выполнена."});
    }
    const targetProfile = sanitizeProfile(targetRow.profile);
    targetProfile.hearts = normalizeHeartState(targetProfile.hearts);
    if (targetProfile.hearts.current >= heartMax) {
      await client.query("DELETE FROM club_heart_requests WHERE requester_session = $1", [targetId]);
      await client.query("COMMIT");
      sendToSession(socket.sessionId, {type:"notice",message:`У игрока ${targetRow.nickname} уже полный запас сердец.`});
      await broadcastSnapshot();
      return;
    }
    targetProfile.hearts.current += 1;
    if (targetProfile.hearts.current >= heartMax) {
      targetProfile.hearts.current = heartMax;
      targetProfile.hearts.nextHeartAt = null;
      targetProfile.hearts.nextDurationMs = heartFirstRestoreMs;
    }
    await client.query("UPDATE club_players SET profile = $2::jsonb, last_seen = now() WHERE session_id = $1", [targetId, JSON.stringify(targetProfile)]);
    await client.query("DELETE FROM club_heart_requests WHERE requester_session = $1", [targetId]);
    await client.query("COMMIT");
    sendToSession(socket.sessionId, {type:"notice",message:`Вы бесплатно отправили сердечко игроку ${targetRow.nickname}.`});
    sendToSession(targetId, {
      type:"heart_update",
      hearts:targetProfile.hearts,
      coins:targetProfile.clubCoins,
      message:`${socket.nickname || "Друг клуба"} восстановил вам сердечко!`
    });
    await broadcastSnapshot();
  } catch (error) {
    await client.query("ROLLBACK");
    sendToSession(socket.sessionId, {type:"notice", message:error.publicMessage || "Не удалось передать сердечко."});
  } finally {
    client.release();
  }
}

async function giftHeartToAll(socket) {
  if (!socket.sessionId) return;
  const client = await pool.connect();
  let helped = 0;
  const updates = [];
  try {
    await client.query("BEGIN");
    const result = await client.query(`
      SELECT p.session_id, p.nickname, p.profile
      FROM club_heart_requests r
      JOIN club_players p ON p.session_id = r.requester_session
      WHERE r.requester_session <> $1
      FOR UPDATE OF p, r
    `, [socket.sessionId]);
    const completedIds = [];
    for (const row of result.rows) {
      const targetProfile = sanitizeProfile(row.profile);
      targetProfile.hearts = normalizeHeartState(targetProfile.hearts);
      completedIds.push(row.session_id);
      if (targetProfile.hearts.current >= heartMax) continue;
      targetProfile.hearts.current += 1;
      if (targetProfile.hearts.current >= heartMax) {
        targetProfile.hearts.current = heartMax;
        targetProfile.hearts.nextHeartAt = null;
        targetProfile.hearts.nextDurationMs = heartFirstRestoreMs;
      }
      await client.query("UPDATE club_players SET profile = $2::jsonb, last_seen = now() WHERE session_id = $1", [row.session_id, JSON.stringify(targetProfile)]);
      updates.push({sessionId:row.session_id,payload:{
        type:"heart_update",
        hearts:targetProfile.hearts,
        coins:targetProfile.clubCoins,
        message:`${socket.nickname || "Друг клуба"} восстановил вам сердечко!`
      }});
      helped += 1;
    }
    if (completedIds.length) {
      await client.query("DELETE FROM club_heart_requests WHERE requester_session = ANY($1::text[])", [completedIds]);
    }
    await client.query("COMMIT");
    for (const update of updates) sendToSession(update.sessionId,update.payload);
    sendToSession(socket.sessionId, {
      type:"notice",
      message:helped?`Вы бесплатно помогли ${helped} ${helped===1?"игроку":"игрокам"}.`:"Новых просьб о помощи нет."
    });
    await broadcastSnapshot();
  } catch (error) {
    await client.query("ROLLBACK");
    sendToSession(socket.sessionId, {type:"notice",message:"Не удалось отправить сердечки всем игрокам."});
  } finally {
    client.release();
  }
}

function safeFortuneSegments(value) {
  const segments = Array.isArray(value)
    ? value.map(item=>safeInteger(item,0,0,6))
    : [];
  const valid = segments.length === 12 && [1,2,3,4,5,6].every(number =>
    segments.filter(item=>item===number).length === 2
  );
  if (valid) return segments;
  const generated = [1,2,3,4,5,6,1,2,3,4,5,6];
  for (let index=generated.length-1;index>0;index-=1) {
    const swapIndex=crypto.randomInt(0,index+1);
    [generated[index],generated[swapIndex]]=[generated[swapIndex],generated[index]];
  }
  return generated;
}

async function spinFortune(socket,data) {
  if(!socket.sessionId)return;
  const client=await pool.connect();
  try{
    await client.query("BEGIN");
    const result=await client.query(`
      SELECT profile FROM club_players WHERE session_id=$1 FOR UPDATE
    `,[socket.sessionId]);
    const savedProfile=sanitizeProfile(result.rows[0]?.profile);
    savedProfile.hearts=normalizeHeartState(savedProfile.hearts);
    savedProfile.fortune=normalizeFortuneState(savedProfile.fortune);
    const now=Date.now();
    const nextSpinAt=Date.parse(String(savedProfile.fortune.nextSpinAt||""));
    if(fortuneCooldownMs>0&&Number.isFinite(nextSpinAt)&&nextSpinAt>now){
      await client.query("ROLLBACK");
      sendToSession(socket.sessionId,{type:"fortune_result",allowed:false,nextSpinAt:savedProfile.fortune.nextSpinAt});
      return;
    }
    const segments=safeFortuneSegments(data.segments);
    const winningIndex=crypto.randomInt(0,12);
    const reward=segments[winningIndex];
    const before=savedProfile.hearts.current;
    savedProfile.hearts.current=Math.min(heartMax,before+reward);
    if(savedProfile.hearts.current>=heartMax){
      savedProfile.hearts.nextHeartAt=null;
      savedProfile.hearts.nextDurationMs=heartFirstRestoreMs;
    }
    savedProfile.fortune={
      nextSpinAt:fortuneCooldownMs>0?new Date(now+fortuneCooldownMs).toISOString():null,
      lastReward:reward
    };
    await client.query("UPDATE club_players SET profile=$2::jsonb,last_seen=now() WHERE session_id=$1",[socket.sessionId,JSON.stringify(savedProfile)]);
    await client.query("COMMIT");
    sendToSession(socket.sessionId,{
      type:"fortune_result",
      allowed:true,
      winningIndex,
      reward,
      added:savedProfile.hearts.current-before,
      hearts:savedProfile.hearts,
      coins:savedProfile.clubCoins,
      nextSpinAt:savedProfile.fortune.nextSpinAt
    });
  }catch(error){
    await client.query("ROLLBACK");
    sendToSession(socket.sessionId,{type:"error",message:"Колесо фортуны временно недоступно."});
  }finally{
    client.release();
  }
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
        else if (data.type === "heart_request") await requestHeart(socket);
        else if (data.type === "heart_gift") await giftHeart(socket, data);
        else if (data.type === "heart_gift_all") await giftHeartToAll(socket);
        else if (data.type === "fortune_spin") await spinFortune(socket,data);
        else if (data.type === "table_join") await joinTable(socket, data);
        else if (data.type === "invite") await invitePlayer(socket, data);
        else if (data.type === "invite_reply") await replyToInvitation(socket, data);
        else if (data.type === "looking_for_opponent") await setLookingForOpponent(socket, data);
        else if (data.type === "accept_search") await acceptSearch(socket, data);
        else if (data.type === "game_action") await relayGameAction(socket, data);
        else if (data.type === "room_presence") updateRoomPresence(socket, data);
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
          "UPDATE club_players SET connected = false, looking_for_opponent = false, looking_game = NULL, looking_level = NULL, looking_started_at = NULL, guest_slot = NULL, last_seen = now() WHERE session_id = $1",
          [socket.sessionId]
        );
        roomPresence.delete(socket.sessionId);
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
  if (requestPath === "/api/profile") {
    const sessionId = sessionIdFromRequest(request);
    const cookieHeader = {"Set-Cookie": sessionCookie(request, sessionId)};
    await pool.query(`
      INSERT INTO club_players(session_id, nickname, connected, last_seen)
      VALUES ($1, 'Гость', false, now())
      ON CONFLICT (session_id) DO NOTHING
    `, [sessionId]);
    if (request.method === "GET") {
      const result = await pool.query(`
        SELECT profile, profile_completed AS completed
        FROM club_players
        WHERE session_id = $1
      `, [sessionId]);
      const row = result.rows[0] || {profile: {}, completed: false};
      sendJson(response, 200, {
        sessionId,
        profile: row.profile || {},
        completed: Boolean(row.completed)
      }, cookieHeader);
      return true;
    }
    if (request.method === "PUT") {
      let body;
      try {
        body = await readJsonBody(request);
      } catch (error) {
        sendJson(response, error.statusCode || 400, {status: "error"}, cookieHeader);
        return true;
      }
      const savedProfile = sanitizeProfile(body.profile);
      const completed = body.completed === true;
      await pool.query(`
        UPDATE club_players
        SET nickname = $2, profile = $3::jsonb, profile_completed = $4, last_seen = now()
        WHERE session_id = $1
      `, [sessionId, savedProfile.name, JSON.stringify(savedProfile), completed]);
      sendJson(response, 200, {
        status: "ok",
        sessionId,
        profile: savedProfile,
        completed
      }, cookieHeader);
      return true;
    }
    response.writeHead(405, {"Allow": "GET, PUT"});
    response.end();
    return true;
  }
  return false;
}

module.exports = {
  attachOnlineServer,
  handleOnlineHttp,
  initializeDatabase
};
