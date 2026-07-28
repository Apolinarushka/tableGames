const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];

const profile = JSON.parse(localStorage.getItem("quietMoveProfile") || "null") || {
  name: "Гость", clothes: "#c84a42", hair: "#34261f", skin: "#d9a77f",
  hairStyle: "hair-wave", faceStyle: "face-smile", rating: 1000, games: []
};
profile.skin ||= "#d9a77f"; profile.hairStyle ||= "hair-wave"; profile.faceStyle ||= "face-smile"; profile.botLevel ||= "B1";
profile.city ||= "";
profile.birthDate ||= "";
profile.interests = Array.isArray(profile.interests) ? profile.interests : [];
profile.timezone ||= Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Moscow";
profile.activityFrom ||= "18:00";
profile.activityTo ||= "23:00";
profile.photo ||= "";
profile.authProvider ||= "";
const clothesColorUpgrade = {
  "#a44b36": "#c84a42",
  "#315f75": "#3099cb",
  "#55704b": "#339565",
  "#6c507d": "#7b4bb7"
};
profile.clothes = clothesColorUpgrade[profile.clothes] || profile.clothes;
if (!["#c84a42", "#e0782f", "#d7ad32", "#339565", "#3099cb", "#7b4bb7"].includes(profile.clothes)) {
  profile.clothes = "#c84a42";
}
let pos = { x: 50, y: 84 }, targetPos = null, arrivalCallback = null, nearTable = null, nearBulletin = false, soundOn = true, audioCtx;
let board = [], turn = "white", selected = null, chainPiece = null, seconds = 60, timerId, gameOver = false, moveHistory = [], activeOpeningName = null, announcedOpeningName = null, announcedEndgameClass = null;
let playerPieceColor = "white", coinTossRun = 0, pendingCoinStart = null;
let currentGameMode = "checkers";
let seatingInProgress = false, activeSeat = null, currentTableNo = "05";
const defaultNotices = [
  {text:"Ищу соперника на спокойную партию после 19:00.",author:"Лена",date:"сегодня",color:"#f2d66e"},
  {text:"В субботу — клубный круг. Запись открыта до пятницы.",author:"Администратор",date:"вчера",color:"#b9d7c5"},
  {text:"Новичкам: разбор правил русских шашек у стола 03.",author:"Старый Мастер",date:"сегодня",color:"#efb3b2"},
  {text:"Поздравляем Севера с серией из пяти побед!",author:"Клуб",date:"2 дня назад",color:"#d3c3e7"}
];
const clubCharacters = [
  {
    id:"yulia",
    number:1,
    name:"Юлия",
    role:"Дружелюбный советчик",
    image:"assets/characters/yulia.png",
    bio:"Юлия поддерживает новичков и спокойно разбирает ошибки. Она вступает в разговор, когда к ней обращаются, отвечает одним сообщением и ждёт ответ игрока, не перегружая чат.",
    summary:"Шашки Б1 · Поддавки Б1 · Шахматы В2 · Домино Б2",
    skills:{checkers:"B1",giveaway:"B1",corners:"B1",chess:"V2",domino:"B2",fives:"B2"},
    traits:["Отвечает по обращению","Одно сообщение","Задаёт вопрос","Даёт советы","Дружелюбна"],
    levels:[
      {game:"Шашки",level:"Б1"},
      {game:"Поддавки",level:"Б1"},
      {game:"Шахматы",level:"В2"},
      {game:"Домино",level:"Б2"}
    ],
    globalMessages:[
      "Всем добрый вечер! Если захотите, после партии помогу разобрать позицию.",
      "Не торопитесь с ходом: сначала проверьте обязательные взятия и ответ соперника.",
      "Хорошая партия — та, после которой стало понятнее, что попробовать в следующей.",
      "Если проиграли, выберите один решающий момент и разберите именно его — так прогресс идёт быстрее."
    ],
    tips:{
      checkers:"Совет: перед ходом проверьте не только своё взятие, но и всю ответную цепочку соперника.",
      giveaway:"В поддавках полезно заранее считать, сможет ли соперник отказаться от вашей жертвы.",
      chess:"В шахматах сначала проверьте шахи, взятия и угрозы — свои и соперника.",
      domino:"В домино берегите кости, которые подходят к обоим открытым концам.",
      fives:"В «Пятёрочках» считайте сумму концов до хода: иногда менее очевидная кость приносит больше очков.",
      corners:"В уголках не запирайте дальние фишки — заранее оставляйте им коридор."
    }
  },
  {
    id:"sofia",
    number:2,
    name:"София",
    role:"Ночная чемпионка",
    image:"assets/characters/sofia.png",
    bio:"София уверена, что играет лучше всех, и её результаты дают для этого основания. Она постоянно вызывает участников на матч и часто побеждает. Предпочитает чёрные фигуры, считает их счастливыми, любит американское кино и джаз. Особенно активна с 18:00 до 05:00.",
    summary:"Все игры В2 · активна 18:00–05:00",
    skills:{checkers:"V2",giveaway:"V2",corners:"V2",chess:"V2",domino:"V2",fives:"V2"},
    traits:["Все игры В2","Счастливый цвет — чёрный","Американское кино","Джаз","Активна вечером и ночью"],
    levels:[
      {game:"Шашки",level:"В2"},
      {game:"Поддавки",level:"В2"},
      {game:"Уголки",level:"В2"},
      {game:"Шахматы",level:"В2"},
      {game:"Домино",level:"В2"},
      {game:"Пятёрочки",level:"В2"}
    ],
    globalMessages:[
      "Кто сегодня готов сыграть против лучшей? Сразу предупреждаю: чёрные мои.",
      "Чёрные фигуры снова принесли удачу. Хотя дело, конечно, не только в удаче.",
      "Ночной турнир открыт. Есть здесь кто-нибудь, кто способен меня удивить?",
      "После хорошего джаза особенно приятно выигрывать красивой комбинацией.",
      "Американское кино учит эффектным финалам. Мои партии — тоже."
    ],
    tips:{
      checkers:"Если претендуете на сильную игру, считайте комбинацию до конца, а не до первого красивого взятия.",
      giveaway:"В поддавках очевидная жертва часто самая слабая. Ищите ход, который оставляет сопернику единственный ответ.",
      chess:"Сильный шахматист сначала ограничивает фигуры соперника, а уже потом начинает атаку.",
      domino:"В домино побеждает тот, кто управляет концами цепочки, а не просто быстрее выкладывает крупные кости.",
      fives:"В «Пятёрочках» хороший ход меняет не только сумму концов, но и лишает соперника выгодного ответа.",
      corners:"В уголках скорость ничего не значит без маршрута. Освободите диагонали раньше соперника."
    }
  },
  {
    id:"innokentiy",
    number:3,
    name:"Иннокентий",
    role:"Наставник старой школы",
    image:"assets/characters/innokentiy.png",
    bio:"Иннокентий играет в настольные игры ещё со времён СССР. Он любит знакомиться с новыми людьми, охотно обучает правилам, поддерживает после неудач и делится жизненным опытом. Утро и день проводит в клубе, а вечером рано уходит домой к своей овчарке Рексу.",
    summary:"Все игры В2 · активен 06:00–19:00",
    skills:{checkers:"V2",giveaway:"V2",corners:"V2",chess:"V2",domino:"V2",fives:"V2"},
    traits:["Все игры В2","Играл ещё в СССР","Обучает новичков","Жизненные советы","Овчарка Рекс","Рано ложится спать"],
    levels:[
      {game:"Шашки",level:"В2"},
      {game:"Поддавки",level:"В2"},
      {game:"Уголки",level:"В2"},
      {game:"Шахматы",level:"В2"},
      {game:"Домино",level:"В2"},
      {game:"Пятёрочки",level:"В2"}
    ],
    favoritePhrases:[
      "Век живи, век учись.",
      "Труд сделал из обезьяны человека.",
      "Делу время, а потехе час."
    ],
    globalMessages:[
      "Доброе утро, друзья! Век живи, век учись — кто хочет вместе разобрать новую игру?",
      "Не бойтесь ошибаться. За доской каждая ошибка может стать хорошим учителем.",
      "Делу время, а потехе час. Сначала спокойно продумаем ход, потом порадуемся победе.",
      "Рекс сегодня поднял меня на прогулку с рассветом, так что я уже готов к первой партии.",
      "Труд сделал из обезьяны человека, а регулярная практика делает из новичка сильного игрока."
    ],
    tips:{
      checkers:"В шашках сперва ищите обязательное взятие, затем проверяйте, куда попадёт шашка после всей серии.",
      giveaway:"В поддавках важно не просто отдать шашку, а лишить соперника удобного выбора.",
      chess:"В шахматах перед ходом спросите себя: что изменилось после последнего хода соперника?",
      domino:"В домино запоминайте, какие значения уже вышли, и не спешите тратить универсальные кости.",
      fives:"В «Пятёрочках» считайте открытые концы до и после каждого возможного хода.",
      corners:"В уголках ведите фишки группой и не оставляйте последнюю без свободной диагонали."
    }
  },
  {
    id:"olesya",
    number:4,
    name:"Олеся",
    role:"Обаяние клуба",
    image:"assets/characters/olesya.png",
    bio:"Олеся живёт жизнью клуба круглосуточно: интересуется людьми, любит литературу, комплименты и дружеское внимание. Она обаятельна, умеет быть хорошей подругой, открыта новым знакомствам и находится в поиске любви. Ведёт социальные сети, отлично готовит мясо, а дома её ждёт кошка Муся породы мейн-кун.",
    summary:"Шахматы А2 · остальные игры Б2 · онлайн 24/7",
    skills:{checkers:"B2",giveaway:"B2",corners:"B2",chess:"A2",domino:"B2",fives:"B2"},
    traits:["В клубе круглосуточно","Любит литературу","Рада комплиментам","В поиске любви","Ведёт соцсети","Вкусно готовит мясо","Мейн-кун Муся"],
    levels:[
      {game:"Шашки",level:"Б2"},
      {game:"Поддавки",level:"Б2"},
      {game:"Уголки",level:"Б2"},
      {game:"Шахматы",level:"А2"},
      {game:"Домино",level:"Б2"},
      {game:"Пятёрочки",level:"Б2"}
    ],
    globalMessages:[
      "Как проходит ваш день? Расскажите, мне правда интересно.",
      "Кто какую книгу сейчас читает? Я всегда ищу хорошую историю на вечер.",
      "Муся снова заняла моё кресло. У мейн-кунов талант быть главными в любом доме.",
      "Сегодня выложила новый пост из клуба. Здесь очень красивые люди и ещё более красивые партии.",
      "Думаю, что приготовить на ужин. Хорошо запечённое мясо способно примирить даже соперников после партии.",
      "Кто готов сказать мне что-нибудь приятное? Обещаю искренне порадоваться."
    ],
    tips:{
      checkers:"В шашках я люблю сохранять красивые диагонали и не отдавать центр без причины.",
      giveaway:"В поддавках лучше всего выглядит жертва, после которой у соперника почти нет выбора.",
      chess:"В шахматах я пока А2, поэтому предпочитаю играть спокойно и сначала выводить все фигуры.",
      domino:"В домино полезно оставить кость, которая подходит к обоим концам цепочки.",
      fives:"В «Пятёрочках» я сначала считаю сумму концов, а потом уже выбираю самую красивую кость.",
      corners:"В уголках стараюсь не оставлять одинокую фишку далеко позади остальных."
    }
  },
  {
    id:"master",
    number:5,
    name:"Старый Мастер",
    role:"Основатель клуба",
    image:"assets/characters/master.png",
    bio:"Старый Мастер основал клуб, чтобы найти учеников, которые продолжат его дело и со временем создадут большое дружное сообщество любителей настольных игр. Он одинаково силён во всех клубных играх и награждён медалью мастера спорта по шахматам. Его жена Серафима обожает выпечку и турецкие сериалы, поэтому Мастер часто проводит много времени в клубе. Дома его ждёт попугай Гоша: ему уже 70 лет, и он достался Мастеру в наследство от отца.",
    summary:"Все игры В2 · основатель клуба · мастер спорта",
    skills:{checkers:"V2",giveaway:"V2",corners:"V2",chess:"V2",domino:"V2",fives:"V2"},
    traits:["Основатель клуба","Ищет учеников","Создаёт сообщество","🏅 Мастер спорта по шахматам","Жена Серафима","Попугай Гоша · 70 лет"],
    levels:[
      {game:"Шашки",level:"В2"},
      {game:"Поддавки",level:"В2"},
      {game:"Уголки",level:"В2"},
      {game:"Шахматы",level:"В2"},
      {game:"Домино",level:"В2"},
      {game:"Пятёрочки",level:"В2"}
    ],
    globalMessages:[
      "Этот клуб я создавал ради учеников, которые однажды сделают наше сообщество ещё больше.",
      "Сильный игрок не прячет знания — он передаёт их дальше.",
      "Серафима сегодня снова печёт пирог и смотрит турецкий сериал, так что у нас есть время на обстоятельную партию.",
      "Гоше уже семьдесят лет. Этого попугая мне оставил отец, и он слышал больше шахматных разборов, чем многие мастера."
    ],
    tips:{
      checkers:"В шашках сильный ход должен улучшать не одну шашку, а всю позицию.",
      giveaway:"В поддавках сначала найдите обязательный ответ соперника и только потом предлагайте жертву.",
      corners:"В уголках заранее стройте маршрут для последней фишки — именно она чаще всего решает исход партии.",
      chess:"Медаль мастера спорта учит главному: прежде чем атаковать, завершите развитие и обеспечьте безопасность короля.",
      domino:"В домино следите не только за своими костями, но и за значениями, которых соперник старается избегать.",
      fives:"В «Пятёрочках» каждый ход должен одновременно приносить очки и ухудшать следующий ответ соперника."
    }
  }
];
let activeOpponentId=null;
function activeOpponent(){return clubCharacters.find(character=>character.id===activeOpponentId)||null}
function opponentName(){return activeOpponent()?.name||"Старый Мастер"}
function opponentLevelForMode(mode){
  return activeOpponent()?.skills?.[mode]||profile.botLevel||"B1";
}
function setActiveOpponent(characterId=null){
  activeOpponentId=clubCharacters.some(character=>character.id===characterId)?characterId:null;
  const opponent=activeOpponent();
  const name=opponent?.name||"Старый Мастер";
  if($("#selectedOpponentLabel"))$("#selectedOpponentLabel").textContent=`Соперник: ${name}`;
  if($("#gameOpponentName"))$("#gameOpponentName").textContent=name;
  if($("#gameOpponentMeta"))$("#gameOpponentMeta").textContent=opponent?"Персонаж клуба":"Бот · 1120";
  if($("#gameOpponentAvatar"))$("#gameOpponentAvatar").textContent=name[0]?.toUpperCase()||"М";
  if($("#arcadeBotLabel"))$("#arcadeBotLabel").textContent=name;
  updateDifficultyUI();
}
const matchGreetings={
  yulia:name=>`Приветствую, ${name}! Давайте начнём игру? Буду рада после партии обсудить самый интересный ход.`,
  sofia:name=>`Приветствую, ${name}. Начнём? Постарайтесь меня удивить — лёгкой партии не обещаю.`,
  innokentiy:name=>`Приветствую, ${name}! Давайте начнём игру. Век живи, век учись — сегодня наверняка найдём красивый ход.`,
  olesya:name=>`Приветствую, ${name}! Давайте сыграем красиво и с удовольствием?`,
  master:name=>`Приветствую, ${name}! Я основал этот клуб ради таких партий и новых учеников. Давайте начнём?`
};
function matchOpponent(){
  return activeOpponent()||{id:"master",name:"Старый Мастер",tips:{}};
}
function startMatchConversation(box,mode,systemText=""){
  if(!box)return;
  box.dataset.replyRun=String(Date.now());
  box.innerHTML=systemText?`<p class="system">${escapeHtml(systemText)}</p>`:"";
  const opponent=matchOpponent();
  const greeting=matchGreetings[opponent.id]?.(profile.name)
    ||`Приветствую, ${profile.name}. Давайте начнём игру?`;
  appendCharacterMessage(box,opponent,greeting);
}
function matchReply(text){
  const opponent=matchOpponent();
  const normalized=text.toLowerCase();
  const namedTechnique=["рокиров","вилк","люльк","каблук","роздых","гамбит","дубл","пятёр","пятер","шах","прыж"].find(word=>normalized.includes(word));
  if(namedTechnique)return opponent.id==="sofia"
    ?`Вы знаете этот приём. Неплохо — посмотрим, сумеете ли довести замысел до конца.`
    :`Да, этот приём стоит запомнить. ${opponent.tips?.[currentGameMode]||"Главное — заранее проверить ответ соперника."}`;
  if(opponent.id==="yulia")return `${opponent.tips?.[currentGameMode]||"Давайте спокойно оценим позицию."} Какой вариант вы рассматриваете дальше?`;
  if(opponent.id==="sofia")return "За разговором я всё равно слежу за доской. Ваш следующий ход должен быть сильнее.";
  if(opponent.id==="innokentiy")return `Хорошо сказано. ${opponent.tips?.[currentGameMode]||"Делу время, а потехе час."}`;
  if(opponent.id==="olesya")return `${opponent.tips?.[currentGameMode]||"Мне нравится обсуждать красивые партии."} Какой ход вам понравился больше всего?`;
  return "Интересная мысль. Посмотрим, как она проявится на доске.";
}
function scheduleMatchOpponentReply(box,text){
  const run=Date.now();
  box.dataset.replyRun=String(run);
  window.setTimeout(()=>{
    if(!box?.isConnected||box.dataset.replyRun!==String(run))return;
    appendCharacterMessage(box,matchOpponent(),matchReply(text));
  },650+Math.random()*650);
}
let lastTechniqueAnnouncement="";
let lastTechniqueAnnouncementAt=0;
function announceTechnique(technique,actor="player",reason=""){
  const box=$("#gameDialog")?.open?$("#gameMessages"):$("#arcadeDialog")?.open?$("#arcadeChatMessages"):null;
  if(!box||!technique)return;
  const key=`${actor}:${technique}`;
  const now=Date.now();
  if(key===lastTechniqueAnnouncement&&now-lastTechniqueAnnouncementAt<1800)return;
  lastTechniqueAnnouncement=key;lastTechniqueAnnouncementAt=now;
  const opponent=matchOpponent();
  let text;
  if(actor==="player"){
    if(opponent.id==="sofia")text=`О, вы применили приём «${technique}». Неплохо — но теперь сумейте удержать преимущество.`;
    else if(opponent.id==="innokentiy")text=`Отлично, ${profile.name}: это приём «${technique}». Век живи, век учись!`;
    else if(opponent.id==="olesya")text=`Как красиво! Вы использовали приём «${technique}». Мне нравится такой смелый ход.`;
    else text=`Удивительно, ${profile.name}, вы применили приём «${technique}»! ${reason||"Теперь важно проверить ответ соперника."}`;
  }else{
    const explanation=reason||"так я ограничу ваши ответы и улучшу свою позицию";
    text=opponent.id==="sofia"
      ?`Сейчас применю «${technique}»: ${explanation}. Посмотрим, найдёте ли вы защиту.`
      :`Воспользуюсь-ка я приёмом «${technique}»: ${explanation}.`;
  }
  appendCharacterMessage(box,opponent,text);
}

function runCoinToss(gameName, onResolved, purpose = "color") {
  const dialog = $("#coinTossDialog"), coin = $("#coinTossCoin"), status = $("#coinTossStatus"), startButton = $("#coinTossStart");
  const run = ++coinTossRun;
  const result = Math.random() < .5 ? "heads" : "tails";
  const color = result === "heads" ? "black" : "white";
  const starter = result === "heads" ? "player" : "bot";
  $("#coinTossTitle").textContent = purpose === "firstMove"
    ? `${gameName}: жеребьёвка первого хода`
    : `${gameName}: розыгрыш цвета`;
  status.textContent = "Монетка взлетает…";
  pendingCoinStart = null;
  startButton.classList.add("hidden");
  startButton.disabled = true;
  coin.className = "toss-coin";
  void coin.offsetWidth;
  coin.classList.add("flipping", result);
  if (!dialog.open) dialog.showModal();
  setTimeout(() => {
    if (run !== coinTossRun) return;
    status.textContent = purpose === "firstMove"
      ? result === "heads" ? "Орёл — первый ход ваш" : `Решка — первым ходит ${opponentName()}`
      : result === "heads" ? "Орёл — вы играете чёрными" : "Решка — вы играете белыми";
    pendingCoinStart = () => {
      if (run !== coinTossRun) return;
      pendingCoinStart = null;
      if (dialog.open) dialog.close();
      onResolved({ result, color, starter });
    };
    startButton.disabled = false;
    startButton.classList.remove("hidden");
    startButton.focus();
  }, 1660);
}
function cancelCoinToss() {
  coinTossRun++;
  pendingCoinStart = null;
  if ($("#coinTossDialog").open) $("#coinTossDialog").close();
}
$("#coinTossDialog").addEventListener("cancel", event => event.preventDefault());
$("#coinTossStart").addEventListener("click", () => pendingCoinStart?.());
let notices = JSON.parse(localStorage.getItem("quietMoveNotices") || "null") || defaultNotices;
const seededTournament = {
  results: [
    [null,null,null,null,null,null],
    [null,null,2,1,2,0],
    [null,0,null,2,1,2],
    [null,1,0,null,2,1],
    [null,0,1,0,null,0],
    [null,2,0,1,2,null]
  ]
};
let tournament = JSON.parse(localStorage.getItem("quietMoveTournament") || "null") || seededTournament;

function profileAge() {
  if(!profile.birthDate)return null;
  const born=new Date(`${profile.birthDate}T12:00:00`);
  if(Number.isNaN(born.getTime()))return null;
  const today=new Date();
  let age=today.getFullYear()-born.getFullYear();
  if(today.getMonth()<born.getMonth()||(today.getMonth()===born.getMonth()&&today.getDate()<born.getDate()))age--;
  return Math.max(0,age);
}
function isActivityHour(hour,from=profile.activityFrom,to=profile.activityTo) {
  const start=Number(from?.split(":")[0]||0),end=Number(to?.split(":")[0]||0);
  return start<=end ? hour>=start&&hour<=end : hour>=start||hour<=end;
}
function activityHoursMarkup(from=profile.activityFrom,to=profile.activityTo) {
  return Array.from({length:24},(_,hour)=>`<i class="${isActivityHour(hour,from,to)?"active":""}" title="${String(hour).padStart(2,"0")}:00"></i>`).join("");
}
function localTimeForProfile() {
  try{return new Intl.DateTimeFormat("ru-RU",{timeZone:profile.timezone,hour:"2-digit",minute:"2-digit"}).format(new Date())}
  catch{return new Intl.DateTimeFormat("ru-RU",{hour:"2-digit",minute:"2-digit"}).format(new Date())}
}
function formattedBirthDate() {
  if(!profile.birthDate)return "Не указана";
  const date=new Date(`${profile.birthDate}T12:00:00`);
  return Number.isNaN(date.getTime())?"Не указана":new Intl.DateTimeFormat("ru-RU",{day:"numeric",month:"long",year:"numeric"}).format(date);
}
function renderActivityPreview() {
  const preview=$("#activityHoursPreview");
  if(!preview)return;
  preview.innerHTML=activityHoursMarkup($("#activityFromInput").value,$("#activityToInput").value);
}
function renderPlayerProfile() {
  const card=$("#playerProfileCard");
  if(!card)return;
  const age=profileAge();
  const interests=profile.interests.length
    ? profile.interests.map(item=>`<span>${escapeHtml(item)}</span>`).join("")
    : "<span>Интересы не указаны</span>";
  const photo=profile.photo
    ? `<img src="${profile.photo}" alt="Фотография ${escapeHtml(profile.name)}">`
    : escapeHtml(profile.name[0]?.toUpperCase()||"Г");
  card.innerHTML=`
    <div class="player-profile-cover"></div>
    <div class="player-profile-main">
      <div class="player-profile-photo">${photo}</div>
      <h3>${escapeHtml(profile.name)}</h3>
      <p class="player-profile-location">${escapeHtml(profile.city||"Город не указан")}</p>
      <div class="player-profile-meta">
        <span>Возраст<b>${age===null?"Не указан":`${age} ${age%10===1&&age%100!==11?"год":age%10>=2&&age%10<=4&&!(age%100>=12&&age%100<=14)?"года":"лет"}`}</b></span>
        <span>Дата рождения<b>${escapeHtml(formattedBirthDate())}</b></span>
        <span>Местное время<b>${escapeHtml(localTimeForProfile())}</b></span>
        <span>Часовой пояс<b>${escapeHtml(profile.timezone)}</b></span>
        <span>Авторизация<b>${escapeHtml(profile.authProvider||"Локальный профиль")}</b></span>
      </div>
      <div class="player-interests">${interests}</div>
      <div class="profile-activity-title"><span>Активность</span><b>${escapeHtml(profile.activityFrom)}–${escapeHtml(profile.activityTo)}</b></div>
      <div class="activity-hours">${activityHoursMarkup()}</div>
      <div class="activity-scale"><span>00</span><span>06</span><span>12</span><span>18</span><span>23</span></div>
    </div>`;
}
function syncProfileEditor() {
  $("#cityInput").value=profile.city;
  $("#birthDateInput").value=profile.birthDate;
  $("#birthDateInput").max=new Date().toISOString().slice(0,10);
  $("#interestsInput").value=profile.interests.join(", ");
  const timezone=$("#timezoneInput");
  if(![...timezone.options].some(option=>option.value===profile.timezone)){
    timezone.add(new Option(profile.timezone,profile.timezone));
  }
  timezone.value=profile.timezone;
  $("#activityFromInput").value=profile.activityFrom;
  $("#activityToInput").value=profile.activityTo;
  const preview=$("#profilePhotoPreview"),remove=$("#removeProfilePhoto");
  preview.classList.toggle("hidden",!profile.photo);
  remove.classList.toggle("hidden",!profile.photo);
  if(profile.photo)preview.src=profile.photo;else preview.removeAttribute("src");
  $("#socialAuthStatus").textContent=profile.authProvider
    ? `Профиль связан с ${profile.authProvider}`
    :"Вы играете как локальный гость";
  $$("[data-social-provider]").forEach(button=>button.classList.toggle("connected",button.dataset.socialProvider===profile.authProvider));
  $$(".interest-suggestions button").forEach(button=>button.classList.toggle("selected",profile.interests.includes(button.dataset.interest)));
  renderActivityPreview();
}
function saveProfile() {
  localStorage.setItem("quietMoveProfile", JSON.stringify(profile));
}
function applyProfile() {
  document.documentElement.style.setProperty("--clothes", profile.clothes);
  document.documentElement.style.setProperty("--hair", profile.hair);
  document.documentElement.style.setProperty("--skin", profile.skin);
  $$("#character, #avatarPreview").forEach(el => {
    [...el.classList].filter(c => c.startsWith("hair-") || c.startsWith("face-")).forEach(c => el.classList.remove(c));
    el.classList.add(profile.hairStyle, profile.faceStyle);
  });
  $$("#clothesSwatches button").forEach(b => b.classList.toggle("selected", b.dataset.color === profile.clothes));
  $$("#hairSwatches button").forEach(b => b.classList.toggle("selected", b.dataset.color === profile.hair));
  $$("#skinSwatches button").forEach(b => b.classList.toggle("selected", b.dataset.color === profile.skin));
  $$("#hairStyles button").forEach(b => b.classList.toggle("selected", b.dataset.style === profile.hairStyle));
  $$("#faceStyles button").forEach(b => b.classList.toggle("selected", b.dataset.style === profile.faceStyle));
  $("#profileName").textContent = profile.name;
  $("#playerLabel").textContent = profile.name;
  $("#rating").textContent = profile.rating;
  $("#gameRating").textContent = profile.rating;
  $("#gamePlayerName").textContent = profile.name;
  $("#gameAvatar").textContent = profile.photo?"":profile.name[0]?.toUpperCase() || "Г";
  $("#gameAvatar").style.backgroundImage=profile.photo?`url("${profile.photo}")`:"";
  $("#gameAvatar").style.backgroundSize=profile.photo?"cover":"";
  $("#gameAvatar").style.backgroundPosition=profile.photo?"center":"";
  $("#nameInput").value = profile.name;
  const miniAvatar=$("#miniAvatar");
  miniAvatar.style.backgroundImage=profile.photo?`url("${profile.photo}")`:"";
  miniAvatar.classList.toggle("has-photo",Boolean(profile.photo));
  syncProfileEditor();
  renderPlayerProfile();
  const playerTier=calculatePlayerTier();
  const levelLabel=$("#playerLevel");
  levelLabel.textContent=playerTier?`Уровень ${tierLabels[playerTier]}`:`До уровня: ${Math.max(0,10-profile.games.length)} партий`;
  levelLabel.classList.toggle("has-level",Boolean(playerTier));
  updateDifficultyUI();
  renderHistory();
  renderStandings();
}
function renderHistory() {
  const panel = $("#historyPanel");
  if (!profile.games.length) { panel.innerHTML = '<p class="empty-history">Сыгранных партий пока нет.</p>'; return; }
  panel.innerHTML = profile.games.slice().reverse().map(g =>
    `<div class="room-row"><b>${g.result}</b><span>${g.opponent} · ${g.date}</span><small>${g.delta > 0 ? "+" : ""}${g.delta}</small></div>`
  ).join("");
}
function beep(freq = 280, duration = .08) {
  if (!soundOn) return;
  try {
    audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator(), gain = audioCtx.createGain();
    osc.frequency.value = freq; gain.gain.setValueAtTime(.05, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(.001, audioCtx.currentTime + duration);
    osc.connect(gain).connect(audioCtx.destination); osc.start(); osc.stop(audioCtx.currentTime + duration);
  } catch {}
}
function toast(text) {
  $("#toast").textContent = text; $("#toast").classList.add("show");
  clearTimeout(toast.t); toast.t = setTimeout(() => $("#toast").classList.remove("show"), 2200);
}

function movePlayer(x, y) {
  pos.x = Math.max(8, Math.min(90, x)); pos.y = Math.max(43, Math.min(91, y));
  const player = $("#player"); player.style.setProperty("--px", `${pos.x}%`); player.style.setProperty("--py", `${pos.y}%`);
  player.classList.add("walking"); clearTimeout(movePlayer.t); movePlayer.t = setTimeout(() => player.classList.remove("walking"), 180);
  detectTable();
}
function walkTo(x, y, callback = null) {
  targetPos = { x: Math.max(8, Math.min(90, x)), y: Math.max(43, Math.min(91, y)) };
  arrivalCallback = callback;
}
function detectTable() {
  nearTable = null; let closest = 16;
  $$(".table").forEach(t => {
    const x = parseFloat(t.style.getPropertyValue("--x")), y = parseFloat(t.style.getPropertyValue("--y"));
    const d = Math.hypot((pos.x - x) * 1.1, pos.y - y);
    t.classList.remove("near");
    if (d < closest) { closest = d; nearTable = t; }
  });
  const bulletin = $("#wallBulletin");
  const bulletinDistance = Math.hypot((pos.x - 10.5) * 1.1, pos.y - 43);
  nearBulletin = bulletinDistance < 10.5;
  bulletin.classList.toggle("near", nearBulletin);
  if(seatingInProgress)return;
  if (nearTable) {
    nearTable.classList.add("near");
    const kind = nearTable.classList.contains("busy") ? "Кликните по столу, чтобы подойти" : "Кликните по столу, чтобы сесть";
    $("#interaction").textContent = `${kind} · стол ${nearTable.dataset.table.padStart(2, "0")}`;
  } else if (nearBulletin) {
    $("#interaction").textContent = "Кликните по доске клуба, чтобы подойти";
  } else $("#interaction").textContent = "Кликните по предмету, столу или человеку";
}
document.addEventListener("keydown", e => {
  if (e.key === "F3") {
    e.preventDefault();
    if ($("#gameDialog").open || $("#gameMenuDialog")?.open || $("#arcadeDialog")?.open || $("#customizer").open || seatingInProgress) return;
    if ($("#bulletinDialog").open) $("#bulletinDialog").close();
    else openBulletin();
  }
});
setInterval(() => {
  if (targetPos) {
    const tx = targetPos.x - pos.x, ty = targetPos.y - pos.y, distance = Math.hypot(tx, ty);
    if (distance < .28) {
      movePlayer(targetPos.x, targetPos.y); targetPos = null;
      const done = arrivalCallback; arrivalCallback = null; if (done) done();
    } else {
      const step = Math.min(.22, distance);
      movePlayer(pos.x + tx / distance * step, pos.y + ty / distance * step);
    }
  }
}, 30);
$("#club").addEventListener("click", e => {
  if (seatingInProgress || e.target.closest("button,aside,.chat-panel")) return;
  const r = $("#club").getBoundingClientRect(); walkTo((e.clientX - r.left) / r.width * 100, (e.clientY - r.top) / r.height * 100);
});
$$(".table").forEach(table => table.addEventListener("click", event => {
  if(event.target.closest(".npc[data-character-id]"))return;
  interact(table);
}));
$$("[data-focus]").forEach(row => row.addEventListener("click", () => {
  if (seatingInProgress) return;
  const t = $(`.table[data-table="${row.dataset.focus}"]`), x = parseFloat(t.style.getPropertyValue("--x")), y = parseFloat(t.style.getPropertyValue("--y"));
  walkTo(x, y + 9, () => interact(t));
}));
$("#wallBulletin").addEventListener("click", () => {
  if (seatingInProgress) return;
  walkTo(10.5, 43, openBulletin);
});
function interact(table) {
  const n = table.dataset.table;
  if (table.classList.contains("busy")) {
    const x=parseFloat(table.style.getPropertyValue("--x")),y=parseFloat(table.style.getPropertyValue("--y"));
    $("#interaction").textContent=`Подходим к столу ${n.padStart(2,"0")}…`;
    walkTo(x,y+10,()=>toast(`Вы наблюдаете за партией за столом ${n.padStart(2, "0")}`));
    return;
  }
  sitAtTable(table);
}
function sitAtTable(table) {
  if (seatingInProgress || activeSeat) return;
  setActiveOpponent(table.dataset.table==="5"?"master":null);
  seatingInProgress = true;
  const x = parseFloat(table.style.getPropertyValue("--x"));
  const y = parseFloat(table.style.getPropertyValue("--y"));
  $("#interaction").textContent = "Подходим к стулу…";
  walkTo(x - 7.5, y + 8, () => {
    const chair = $(".chair.c1", table);
    activeSeat = { table, chair };
    table.classList.add("seat-in-use");
    chair.classList.add("pulled");
    $("#interaction").textContent = "Отодвигаем стул…";
    beep(145,.08);
    setTimeout(() => {
      movePlayer(x - 7.5, y + 3.5);
      $("#player").classList.add("sitting");
      $("#interaction").textContent = "Вы садитесь за стол";
      setTimeout(() => {
        seatingInProgress = false;
        openTableGameMenu(table.dataset.table);
      }, 650);
    }, 420);
  });
}
function leaveSeat() {
  if (!activeSeat) return;
  const { table, chair } = activeSeat;
  $("#player").classList.remove("sitting");
  movePlayer(pos.x - 1.5, pos.y + 5);
  setTimeout(() => {
    chair.classList.remove("pulled");
    table.classList.remove("seat-in-use");
    activeSeat = null;
    detectTable();
  }, 320);
}

$$(".sidebar-tabs button").forEach(b => b.addEventListener("click", () => {
  $$(".sidebar-tabs button").forEach(x => x.classList.toggle("active", x === b));
  const panels={rooms:"#roomsPanel",history:"#historyPanel",characters:"#charactersPanel",playerProfile:"#playerProfilePanel"};
  Object.entries(panels).forEach(([name,selector])=>$(selector).classList.toggle("hidden",b.dataset.panel!==name));
}));
$("#customizeButton").addEventListener("click", () => $("#customizer").showModal());
$("#editPlayerProfile").addEventListener("click", () => $("#customizer").showModal());
function setupSwatches(id, key) {
  $$(`#${id} button`).forEach(btn => btn.addEventListener("click", () => {
    $$(`#${id} button`).forEach(x => x.classList.toggle("selected", x === btn));
    document.documentElement.style.setProperty(`--${key}`, btn.dataset.color);
  }));
}
setupSwatches("clothesSwatches", "clothes"); setupSwatches("hairSwatches", "hair"); setupSwatches("skinSwatches", "skin");
function setupChoices(id, prefix) {
  $$(`#${id} button`).forEach(btn => btn.addEventListener("click", () => {
    $$(`#${id} button`).forEach(x => x.classList.toggle("selected", x === btn));
    $$("#character, #avatarPreview").forEach(el => {
      [...el.classList].filter(c => c.startsWith(prefix)).forEach(c => el.classList.remove(c));
      el.classList.add(btn.dataset.style);
    });
  }));
}
setupChoices("hairStyles", "hair-"); setupChoices("faceStyles", "face-");
function resizeProfilePhoto(file,maxSize=512) {
  return new Promise((resolve,reject)=>{
    if(!file.type.startsWith("image/")){reject(new Error("Выберите изображение"));return}
    if(file.size>8*1024*1024){reject(new Error("Файл должен быть меньше 8 МБ"));return}
    const reader=new FileReader();
    reader.onerror=()=>reject(new Error("Не удалось прочитать фотографию"));
    reader.onload=()=>{
      const image=new Image();
      image.onerror=()=>reject(new Error("Не удалось открыть фотографию"));
      image.onload=()=>{
        const side=Math.min(image.naturalWidth,image.naturalHeight);
        const sx=(image.naturalWidth-side)/2,sy=(image.naturalHeight-side)/2;
        const canvas=document.createElement("canvas");canvas.width=maxSize;canvas.height=maxSize;
        canvas.getContext("2d").drawImage(image,sx,sy,side,side,0,0,maxSize,maxSize);
        resolve(canvas.toDataURL("image/jpeg",.84));
      };
      image.src=reader.result;
    };
    reader.readAsDataURL(file);
  });
}
$("#profilePhotoInput").addEventListener("change",async event=>{
  const file=event.target.files?.[0];if(!file)return;
  try{
    profile.photo=await resizeProfilePhoto(file);
    saveProfile();applyProfile();toast("Фотография добавлена в анкету");
  }catch(error){toast(error.message)}
  event.target.value="";
});
$("#removeProfilePhoto").addEventListener("click",()=>{
  profile.photo="";saveProfile();applyProfile();toast("Фотография удалена");
});
$$("[data-social-provider]").forEach(button=>button.addEventListener("click",()=>{
  profile.authProvider=button.dataset.socialProvider;
  saveProfile();applyProfile();
  toast(`Профиль связан с ${profile.authProvider} на этом устройстве`);
}));
$$(".interest-suggestions button").forEach(button=>button.addEventListener("click",()=>{
  const items=$("#interestsInput").value.split(",").map(item=>item.trim()).filter(Boolean);
  const interest=button.dataset.interest,index=items.findIndex(item=>item.toLowerCase()===interest.toLowerCase());
  if(index>=0)items.splice(index,1);else items.push(interest);
  $("#interestsInput").value=items.slice(0,10).join(", ");
  button.classList.toggle("selected",index<0);
}));
$("#activityFromInput").addEventListener("input",renderActivityPreview);
$("#activityToInput").addEventListener("input",renderActivityPreview);
$("#customizer").addEventListener("close", () => applyProfile());
$("#saveAvatar").addEventListener("click", e => {
  e.preventDefault();
  profile.name = $("#nameInput").value.trim() || "Гость";
  profile.city = $("#cityInput").value.trim();
  profile.birthDate = $("#birthDateInput").value;
  profile.timezone = $("#timezoneInput").value;
  profile.activityFrom = $("#activityFromInput").value || "18:00";
  profile.activityTo = $("#activityToInput").value || "23:00";
  profile.interests = [...new Set($("#interestsInput").value.split(",").map(item=>item.trim()).filter(Boolean))].slice(0,10);
  profile.clothes = $("#clothesSwatches .selected").dataset.color;
  profile.hair = $("#hairSwatches .selected").dataset.color;
  profile.skin = $("#skinSwatches .selected").dataset.color;
  profile.hairStyle = $("#hairStyles .selected").dataset.style;
  profile.faceStyle = $("#faceStyles .selected").dataset.style;
  saveProfile(); applyProfile(); $("#customizer").close(); toast(`Анкета ${profile.name} сохранена`);
});

function appendCharacterMessage(box, character, text) {
  box.insertAdjacentHTML("beforeend",`<p class="character-message"><b>${escapeHtml(character.name)}</b><span>${escapeHtml(text)}</span></p>`);
  while(box.children.length>40)box.firstElementChild?.remove();
  box.scrollTop=box.scrollHeight;
}
const yuliaConversation={
  global:{awaiting:false,pending:false,run:0},
  game:{awaiting:false,pending:false,run:0}
};
function yuliaIsAddressed(text) {
  return /(^|\s|@)(юлия|юля|юле|юлю|юлии)(?=\s|[,.!?;:]|$)/i.test(text);
}
function yuliaReply(text,isGameChat=false,continuing=false) {
  const yulia=clubCharacters[0],normalized=text.toLowerCase();
  if(isGameChat){
    const tip=yulia.tips[currentGameMode]||"Давайте спокойно разберём позицию.";
    return `${tip} Какой ход вы сейчас рассматриваете?`;
  }
  if(normalized.includes("шах"))return `${yulia.tips.chess} Какая фигура соперника сейчас создаёт вам больше всего проблем?`;
  if(normalized.includes("поддав"))return `${yulia.tips.giveaway} Какую шашку вы хотите отдать первой?`;
  if(normalized.includes("пят"))return `${yulia.tips.fives} Какую сумму открытых концов вы хотите получить следующим ходом?`;
  if(normalized.includes("домино"))return `${yulia.tips.domino} Какие значения у вас остались в руке?`;
  if(normalized.includes("угол"))return `${yulia.tips.corners} Какая фишка сейчас сильнее всего отстаёт?`;
  if(normalized.includes("шаш"))return `${yulia.tips.checkers} Где вы видите возможное обязательное взятие?`;
  if(normalized.includes("проиг"))return "Не расстраивайтесь: полезнее всего найти момент, где инициатива перешла к сопернику. Какой ход показался вам решающим?";
  if(continuing)return "Поняла вас. Давайте разберём это по одному шагу: какой вариант хода вы уже пробовали?";
  return "Конечно, давайте разберёмся вместе. Какую игру или позицию вы хотите обсудить?";
}
function scheduleYuliaMessage(box,text,isGameChat=false,delay=900) {
  const state=yuliaConversation[isGameChat?"game":"global"];
  if(state.pending||(!state.awaiting&&!yuliaIsAddressed(text)))return;
  const continuing=state.awaiting;
  state.awaiting=false;
  state.pending=true;
  const run=++state.run;
  window.setTimeout(()=>{
    if(run!==state.run)return;
    state.pending=false;
    if(!box?.isConnected)return;
    appendCharacterMessage(box,clubCharacters[0],yuliaReply(text,isGameChat,continuing));
    state.awaiting=true;
  },delay);
}
function resetYuliaConversation(scope="game") {
  yuliaConversation[scope].run++;
  yuliaConversation[scope].awaiting=false;
  yuliaConversation[scope].pending=false;
}
function isSofiaActiveTime(date=new Date()) {
  const hour=date.getHours();
  return hour>=18||hour<5;
}
function canSofiaReplyToPlayer() {
  return ["V1","V2"].includes(calculatePlayerTier());
}
function sofiaReply(text) {
  const sofia=clubCharacters.find(character=>character.id==="sofia"),normalized=text.toLowerCase();
  if(normalized.includes("шах"))return sofia.tips.chess;
  if(normalized.includes("поддав"))return sofia.tips.giveaway;
  if(normalized.includes("пят"))return sofia.tips.fives;
  if(normalized.includes("домино"))return sofia.tips.domino;
  if(normalized.includes("угол"))return sofia.tips.corners;
  if(normalized.includes("шаш"))return sofia.tips.checkers;
  if(normalized.includes("чёр")||normalized.includes("черн"))return "Чёрные — мой счастливый цвет. Но победу всё равно приходится заслужить расчётом.";
  if(normalized.includes("джаз")||normalized.includes("кино"))return "Наконец-то достойная тема. Хороший джаз и сильная партия не терпят фальшивых нот.";
  return sofia.globalMessages[Math.floor(Math.random()*sofia.globalMessages.length)];
}
function scheduleSofiaMessage(box,text,delay=1500) {
  if(!isSofiaActiveTime()||!canSofiaReplyToPlayer())return;
  window.setTimeout(()=>{
    if(!box?.isConnected||!isSofiaActiveTime()||!canSofiaReplyToPlayer())return;
    const sofia=clubCharacters.find(character=>character.id==="sofia");
    appendCharacterMessage(box,sofia,sofiaReply(text));
  },delay);
}
const innokentiyConversation={
  global:{pending:false,run:0},
  game:{pending:false,run:0}
};
function isInnokentiyActiveTime(date=new Date()) {
  const hour=date.getHours();
  return hour>=6&&hour<19;
}
function innokentiyIsAddressed(text) {
  return /(^|\s|@)(иннокентий|иннокентия|иннокентию|иннокентиевич)(?=\s|[,.!?;:]|$)/i.test(text);
}
function messageAddressesAnotherCharacter(text) {
  return yuliaIsAddressed(text)||
    /(^|\s|@)(софия|софию|софии|софье)(?=\s|[,.!?;:]|$)/i.test(text)||
    innokentiyIsAddressed(text)||
    olesyaIsAddressed(text);
}
function innokentiyReply(text,isGameChat=false) {
  const innokentiy=clubCharacters.find(character=>character.id==="innokentiy"),normalized=text.toLowerCase();
  if(isGameChat)return `${innokentiy.tips[currentGameMode]||"Не торопитесь и спокойно сравните варианты."} Век живи, век учись.`;
  if(normalized.includes("шах"))return `${innokentiy.tips.chess} Век живи, век учись.`;
  if(normalized.includes("поддав"))return `${innokentiy.tips.giveaway} Дело мастера боится.`;
  if(normalized.includes("пят"))return `${innokentiy.tips.fives} Делу время, а потехе час.`;
  if(normalized.includes("домино"))return `${innokentiy.tips.domino} Полезная привычка приходит с практикой.`;
  if(normalized.includes("угол"))return `${innokentiy.tips.corners} Труд сделал из обезьяны человека.`;
  if(normalized.includes("шаш"))return `${innokentiy.tips.checkers} Век живи, век учись.`;
  if(normalized.includes("проиг")||normalized.includes("ошиб"))return "Не огорчайтесь: поражение показывает, чему стоит научиться следующим. Век живи, век учись.";
  if(normalized.includes("рекс")||normalized.includes("собак")||normalized.includes("овчарк"))return "Рекс — овчарка и мой лучший утренний товарищ. После прогулки с ним голова особенно хорошо считает варианты.";
  if(normalized.includes("устал")||normalized.includes("поздно"))return "Отдых тоже часть хорошей игры. Делу время, а потехе час — я и сам предпочитаю ложиться пораньше.";
  return innokentiy.favoritePhrases[Math.floor(Math.random()*innokentiy.favoritePhrases.length)];
}
function scheduleInnokentiyMessage(box,text,isGameChat=false,delay=1050) {
  if(!isInnokentiyActiveTime())return;
  if(messageAddressesAnotherCharacter(text)&&!innokentiyIsAddressed(text))return;
  const scope=isGameChat?"game":"global";
  const state=innokentiyConversation[scope];
  if(state.pending)return;
  state.pending=true;
  const run=++state.run;
  window.setTimeout(()=>{
    if(run!==state.run)return;
    state.pending=false;
    if(!box?.isConnected||!isInnokentiyActiveTime())return;
    const innokentiy=clubCharacters.find(character=>character.id==="innokentiy");
    appendCharacterMessage(box,innokentiy,innokentiyReply(text,isGameChat));
  },delay);
}
function resetInnokentiyConversation(scope="game") {
  innokentiyConversation[scope].run++;
  innokentiyConversation[scope].pending=false;
}
const olesyaConversation={
  global:{pending:false,run:0},
  game:{pending:false,run:0}
};
function olesyaIsAddressed(text) {
  return /(^|\s|@)(олеся|олесю|олесе|олеси)(?=\s|[,.!?;:]|$)/i.test(text);
}
function olesyaTopicMentioned(text) {
  return /(комплимент|красив|милая|обаятельн|нравиш|любов|знаком|книг|литератур|чита|муся|кошк|мейн|соцсет|социальн|блог|мяс|готов|рецепт)/i.test(text);
}
function olesyaReply(text,isGameChat=false) {
  const olesya=clubCharacters.find(character=>character.id==="olesya"),normalized=text.toLowerCase();
  if(isGameChat)return `${olesya.tips[currentGameMode]||"Давайте сыграем красиво и без спешки."} А какой ход нравится вам?`;
  if(/комплимент|красив|милая|обаятельн|нравиш/.test(normalized))return "Спасибо, вы умеете заставить меня улыбнуться. Вы всегда так красиво говорите людям приятные вещи?";
  if(/любов|знаком|отношен|свидан/.test(normalized))return "Я открыта хорошим знакомствам и верю, что симпатия начинается с интересного разговора. Что для вас важнее всего в человеке?";
  if(/книг|литератур|чита|роман|поэз/.test(normalized))return "Я люблю книги, после которых хочется ещё долго обсуждать героев. Какая история запомнилась вам сильнее всего?";
  if(/муся|кошк|мейн/.test(normalized))return "Муся — большая мейн-кун и настоящая хозяйка дома. У вас есть питомец?";
  if(/мяс|готов|рецепт|ужин|еда/.test(normalized))return "Я люблю готовить мясо медленно, чтобы оно оставалось сочным. Какое блюдо вы назвали бы своим любимым?";
  if(/соцсет|социальн|блог|пост|фото/.test(normalized))return "Я веду страницы клуба и люблю замечать красивые моменты между партиями. Что вам интереснее видеть в ленте — людей или разборы игр?";
  return "Я рада, что вы заговорили со мной. Как проходит ваш день и что привело вас сегодня в клуб?";
}
function scheduleOlesyaMessage(box,text,isGameChat=false,delay=1250) {
  if(messageAddressesAnotherCharacter(text)&&!olesyaIsAddressed(text))return;
  if(!olesyaIsAddressed(text)&&!olesyaTopicMentioned(text))return;
  const scope=isGameChat?"game":"global",state=olesyaConversation[scope];
  if(state.pending)return;
  state.pending=true;
  const run=++state.run;
  window.setTimeout(()=>{
    if(run!==state.run)return;
    state.pending=false;
    if(!box?.isConnected)return;
    const olesya=clubCharacters.find(character=>character.id==="olesya");
    appendCharacterMessage(box,olesya,olesyaReply(text,isGameChat));
  },delay);
}
function resetOlesyaConversation(scope="game") {
  olesyaConversation[scope].run++;
  olesyaConversation[scope].pending=false;
}
function postChat(form, input, box, isGameChat=false) {
  if(!form||!input||!box)return;
  form.addEventListener("submit", e => {
    e.preventDefault(); const text = input.value.trim(); if (!text) return;
    box.insertAdjacentHTML("beforeend", `<p><b>${escapeHtml(profile.name)}</b><span>${escapeHtml(text)}</span></p>`);
    input.value = ""; box.scrollTop = box.scrollHeight;
    if(isGameChat)scheduleMatchOpponentReply(box,text);
    else{
      scheduleYuliaMessage(box,text,false,700+Math.random()*900);
      scheduleSofiaMessage(box,text,1300+Math.random()*1200);
      scheduleInnokentiyMessage(box,text,false,900+Math.random()*900);
      scheduleOlesyaMessage(box,text,false,1100+Math.random()*1000);
    }
  });
}
function escapeHtml(s) { const d = document.createElement("div"); d.textContent = s; return d.innerHTML; }
postChat($("#chatForm"), $("#chatInput"), $("#messages"));
postChat($("#gameChatForm"), $("#gameChatInput"), $("#gameMessages"),true);
$$(".chat-tabs button").forEach(b => b.addEventListener("click", () => {
  $$(".chat-tabs button").forEach(x => x.classList.toggle("active", x === b));
  toast(b.dataset.chat === "global" ? "Общий чат клуба" : "Чат текущего стола");
}));

function roomPersonProfile(id) {
  return clubCharacters.find(character=>character.id===id)||null;
}
function openCharacterProfile(character) {
  const image=$("#characterProfileImage"),fallback=$("#characterProfileFallback");
  const hasImage=Boolean(character.image);
  image.classList.toggle("hidden",!hasImage);
  fallback.classList.toggle("hidden",hasImage);
  if(hasImage){image.src=character.image;image.alt=`Портрет ${character.name}`}
  else{
    image.removeAttribute("src");image.alt="";
    fallback.textContent=character.name.split(/\s+/).map(part=>part[0]).join("").slice(0,2).toUpperCase();
  }
  $("#characterProfileNumber").textContent=character.profileLabel||`Персонаж ${String(character.number).padStart(2,"0")}`;
  $("#characterProfileName").textContent=character.name;
  $("#characterProfileRole").textContent=character.role;
  $("#characterProfileBio").textContent=character.bio;
  $("#characterLevelGrid").innerHTML=character.levels.map(item=>
    `<div class="character-level-row"><span>${escapeHtml(item.game)}</span><b>${escapeHtml(item.level)}</b></div>`
  ).join("");
  $("#characterTraits").innerHTML=character.traits.map(trait=>`<span>${escapeHtml(trait)}</span>`).join("");
  const dialog=$("#characterProfileDialog");
  if(!dialog.open)dialog.showModal();
}
$("#club").addEventListener("click",event=>{
  const person=event.target.closest(".npc[data-character-id]");
  if(!person)return;
  event.preventDefault();event.stopPropagation();
  targetPos=null;arrivalCallback=null;
  const character=roomPersonProfile(person.dataset.characterId);
  if(character)openCharacterProfile(character);
},true);
function renderCharacterRoster() {
  $("#characterRosterCount").textContent=`${clubCharacters.length} из 10`;
  $("#characterRoster").innerHTML=clubCharacters.map(character=>`
    <article class="character-roster-card">
      <button class="character-profile-open" data-character-id="${character.id}" aria-label="Открыть профиль: ${escapeHtml(character.name)}">
        <img src="${character.image}" alt="">
        <span class="character-roster-copy">
          <b>${escapeHtml(character.name)}</b>
          <span>${escapeHtml(character.role)}</span>
          <small>${escapeHtml(character.summary)}</small>
        </span>
      </button>
      <button class="character-start-game" data-character-id="${character.id}">Начать игру с ${escapeHtml(character.name)}</button>
    </article>
  `).join("");
  $$(".character-profile-open").forEach(button=>button.addEventListener("click",()=>{
    const character=clubCharacters.find(item=>item.id===button.dataset.characterId);
    if(character)openCharacterProfile(character);
  }));
  $$(".character-start-game").forEach(button=>button.addEventListener("click",()=>{
    const character=clubCharacters.find(item=>item.id===button.dataset.characterId);
    if(!character)return;
    setActiveOpponent(character.id);
    openTableGameMenu("05");
    toast(`Соперник выбран: ${character.name}`);
  }));
}
$("#closeCharacterProfile").addEventListener("click",()=>$("#characterProfileDialog").close());
$("#characterProfileDialog").addEventListener("cancel",event=>{
  event.preventDefault();
  $("#characterProfileDialog").close();
});
$("#trophyHistoryTrigger").addEventListener("click",event=>{
  event.stopPropagation();
  targetPos=null;arrivalCallback=null;
  if(!$("#trophyHistoryDialog").open)$("#trophyHistoryDialog").showModal();
});
$("#closeTrophyHistory").addEventListener("click",()=>$("#trophyHistoryDialog").close());
$("#trophyHistoryDialog").addEventListener("cancel",event=>{
  event.preventDefault();
  $("#trophyHistoryDialog").close();
});
const rulesTabs=$$("[data-rules-tab]");
const rulesPages=$$("[data-rules-page]");
function setRulesTab(tabName,moveFocus=false){
  rulesTabs.forEach(tab=>{
    const active=tab.dataset.rulesTab===tabName;
    tab.classList.toggle("active",active);
    tab.setAttribute("aria-selected",String(active));
    tab.tabIndex=active?0:-1;
    if(active&&moveFocus)tab.focus();
  });
  rulesPages.forEach(page=>{
    const active=page.dataset.rulesPage===tabName;
    page.classList.toggle("active",active);
    page.hidden=!active;
  });
  $(".rules-pages").scrollTop=0;
}
rulesTabs.forEach((tab,index)=>{
  tab.addEventListener("click",()=>setRulesTab(tab.dataset.rulesTab));
  tab.addEventListener("keydown",event=>{
    let next=index;
    if(event.key==="ArrowRight")next=(index+1)%rulesTabs.length;
    else if(event.key==="ArrowLeft")next=(index-1+rulesTabs.length)%rulesTabs.length;
    else if(event.key==="Home")next=0;
    else if(event.key==="End")next=rulesTabs.length-1;
    else return;
    event.preventDefault();
    setRulesTab(rulesTabs[next].dataset.rulesTab,true);
  });
});
$("#trophyRulesTrigger").addEventListener("click",event=>{
  event.stopPropagation();
  targetPos=null;arrivalCallback=null;
  setRulesTab("checkers");
  if(!$("#trophyRulesDialog").open)$("#trophyRulesDialog").showModal();
});
$("#closeTrophyRules").addEventListener("click",()=>$("#trophyRulesDialog").close());
$("#trophyRulesDialog").addEventListener("cancel",event=>{
  event.preventDefault();
  $("#trophyRulesDialog").close();
});
renderCharacterRoster();
window.setTimeout(()=>{
  if(!isSofiaActiveTime())return;
  const sofia=clubCharacters.find(character=>character.id==="sofia");
  appendCharacterMessage($("#messages"),sofia,sofia.globalMessages[0]);
},3200);
window.setInterval(()=>{
  if(document.visibilityState!=="visible"||!isSofiaActiveTime())return;
  const sofia=clubCharacters.find(character=>character.id==="sofia");
  const message=sofia.globalMessages[Math.floor(Math.random()*sofia.globalMessages.length)];
  appendCharacterMessage($("#messages"),sofia,message);
},45000);
window.setTimeout(()=>{
  if(!isInnokentiyActiveTime())return;
  const innokentiy=clubCharacters.find(character=>character.id==="innokentiy");
  appendCharacterMessage($("#messages"),innokentiy,innokentiy.globalMessages[0]);
},2400);
window.setInterval(()=>{
  if(document.visibilityState!=="visible"||!isInnokentiyActiveTime())return;
  const innokentiy=clubCharacters.find(character=>character.id==="innokentiy");
  const message=innokentiy.globalMessages[Math.floor(Math.random()*innokentiy.globalMessages.length)];
  appendCharacterMessage($("#messages"),innokentiy,message);
},55000);
window.setTimeout(()=>{
  const olesya=clubCharacters.find(character=>character.id==="olesya");
  appendCharacterMessage($("#messages"),olesya,olesya.globalMessages[0]);
},4200);
window.setInterval(()=>{
  if(document.visibilityState!=="visible")return;
  const olesya=clubCharacters.find(character=>character.id==="olesya");
  const message=olesya.globalMessages[Math.floor(Math.random()*olesya.globalMessages.length)];
  appendCharacterMessage($("#messages"),olesya,message);
},85000);

const tierLabels={A1:"А1",A2:"А2",B1:"Б1",B2:"Б2",V1:"В1",V2:"В2"};
const difficultyMeta={
  A1:{name:"Очень лёгкий",description:"Бот выбирает случайные допустимые ходы и часто пропускает выгодные возможности."},
  A2:{name:"Лёгкий",description:"Бот замечает очевидную выгоду, но почти не рассчитывает ответ соперника."},
  B1:{name:"Средний",description:"Бот оценивает текущую позицию, материал и ближайшие доступные ходы."},
  B2:{name:"Выше среднего",description:"Бот учитывает безопасность позиции и один возможный ответ соперника."},
  V1:{name:"Сложный",description:"Бот использует сложные комбинации, сильные розыгрыши и многоходовые планы."},
  V2:{name:"Продвинутый",description:"Бот глубоко сравнивает варианты и выбирает самые сильные тактические и позиционные продолжения."}
};
function tierForPlayer(index,players=getTournamentPlayers()) {
  if((players[index].battles||0)<10)return null;
  const ranked=[...players].map((player,i)=>({...player,index:i})).sort((a,b)=>b.rating-a.rating);
  const rank=ranked.findIndex(player=>player.index===index);
  const scale=["V2","V1","B2","B1","A2","A1"];
  return scale[Math.round(rank*(scale.length-1)/Math.max(1,players.length-1))];
}
function calculatePlayerTier(){return tierForPlayer(0)}
function updateDifficultyUI(){
  const mode=typeof arcadeMode!=="undefined"&&arcadeMode?arcadeMode:currentGameMode;
  const level=opponentLevelForMode(mode),locked=Boolean(activeOpponent());
  $$(".difficulty-options button").forEach(button=>{
    button.classList.toggle("selected",button.dataset.level===level);
    button.disabled=locked;
  });
  const description=`${locked?`${opponentName()} играет на фиксированном уровне ${tierLabels[level]}. `:""}${difficultyMeta[level].description}`;
  if($("#difficultyDescription"))$("#difficultyDescription").textContent=description;
  if($("#arcadeDifficultyDescription"))$("#arcadeDifficultyDescription").textContent=description;
}
$$(".difficulty-options button").forEach(button=>button.addEventListener("click",()=>{
  if(activeOpponent())return;
  profile.botLevel=button.dataset.level;saveProfile();updateDifficultyUI();
  toast(`Уровень бота: ${tierLabels[profile.botLevel]} · ${difficultyMeta[profile.botLevel].name}`);
}));

function openBulletin() {
  renderNotices();
  renderStandings();
  $("#bulletinDialog").showModal();
}
function renderNotices() {
  const colors = ["#f2d66e","#b9d7c5","#efb3b2","#d3c3e7","#f0eee2"];
  $("#stickyGrid").innerHTML = notices.map((note,index) => `
    <article class="sticky-note" style="--note-color:${note.color || colors[index%colors.length]};--note-rotate:${[-2,1,-1,2][index%4]}deg;--pin-color:${["#2d699c","#2d8655","#a52e35"][index%3]}">
      <p>${escapeHtml(note.text)}</p>
      <footer><b>${escapeHtml(note.author)}</b><time>${escapeHtml(note.date)}</time></footer>
    </article>
  `).join("");
}
function getTournamentPlayers() {
  return [
    {name:profile.name,rating:profile.rating,label:"Вы",battles:profile.games.length},
    {name:"Старый Мастер",rating:1120,label:"Бот",battles:46},
    {name:"Лена",rating:1085,label:"Игрок",battles:31},
    {name:"Север",rating:1048,label:"Игрок",battles:27},
    {name:"Виктор",rating:1021,label:"Игрок",battles:18},
    {name:"Макс",rating:995,label:"Игрок",battles:22}
  ];
}
function renderStandings() {
  const players = getTournamentPlayers();
  const stats = players.map((player,index) => {
    const played = tournament.results[index].filter((value,opponent) => opponent !== index && value !== null);
    return {
      ...player,index,games:played.length,wins:played.filter(v=>v===2).length,
      draws:played.filter(v=>v===1).length,losses:played.filter(v=>v===0).length,
      points:played.reduce((sum,value)=>sum+value,0)
    };
  });
  const ranked = [...stats].sort((a,b)=>b.points-a.points || b.wins-a.wins || b.rating-a.rating);
  const places = new Map(ranked.map((row,index)=>[row.index,index+1]));
  const matrixHead = players.map((_,index)=>`<th title="${escapeHtml(players[index].name)}">${index+1}</th>`).join("");
  const body = stats.map(row => {
    const matrix = players.map((_,opponent) => {
      if (opponent === row.index) return '<td class="diagonal">◆</td>';
      const value = tournament.results[row.index][opponent];
      const cls = value === 2 ? "win" : value === 1 ? "draw" : value === 0 ? "loss" : "pending";
      return `<td class="${cls}">${value === null ? "·" : value}</td>`;
    }).join("");
    const tier=tierForPlayer(row.index,players);
    return `<tr class="${row.index===0?"is-player":""}">
      <td>${row.index+1}</td>
      <td class="player-cell"><b>${escapeHtml(row.name)}</b><small>${row.label} · рейтинг ${row.rating} · ${tier?`уровень ${tierLabels[tier]}`:`уровень после 10 партий`}</small></td>
      ${matrix}
      <td>${row.games}</td><td>${row.wins}</td><td>${row.draws}</td><td>${row.losses}</td>
      <td><b>${row.points}</b></td><td class="place">${places.get(row.index)}</td><td><b>${tier?tierLabels[tier]:"—"}</b></td>
    </tr>`;
  }).join("");
  $("#standingsTable").innerHTML = `<thead><tr><th>№</th><th class="player-cell">Игрок</th>${matrixHead}<th>Игр</th><th>В</th><th>Н</th><th>П</th><th>Очки</th><th>Место</th><th>Уровень</th></tr></thead><tbody>${body}</tbody>`;
}
function recordTournamentResult(playerPoints) {
  const opponentPoints = playerPoints === 2 ? 0 : playerPoints === 0 ? 2 : 1;
  tournament.results[0][1] = playerPoints;
  tournament.results[1][0] = opponentPoints;
  localStorage.setItem("quietMoveTournament",JSON.stringify(tournament));
  renderStandings();
}
$("#closeBulletin").addEventListener("click",()=>$("#bulletinDialog").close());
$$(".bulletin-tabs button").forEach(button => button.addEventListener("click",()=>{
  $$(".bulletin-tabs button").forEach(item=>item.classList.toggle("active",item===button));
  $("#noticesPanel").classList.toggle("hidden",button.dataset.bulletinTab!=="notices");
  $("#standingsPanel").classList.toggle("hidden",button.dataset.bulletinTab!=="standings");
  if(button.dataset.bulletinTab==="standings") renderStandings();
}));
$("#noticeForm").addEventListener("submit",event=>{
  event.preventDefault();
  const input=$("#noticeInput"),text=input.value.trim();
  if(!text)return;
  const colors=["#f2d66e","#b9d7c5","#efb3b2","#d3c3e7","#f0eee2"];
  notices.push({text,author:profile.name,date:"сегодня",color:colors[notices.length%colors.length]});
  localStorage.setItem("quietMoveNotices",JSON.stringify(notices));
  input.value="";renderNotices();toast("Объявление прикреплено к доске");
});

function initialBoard() {
  return Array.from({ length: 8 }, (_, r) => Array.from({ length: 8 }, (_, c) => {
    if ((r + c) % 2 === 0) return null;
    if (r < 3) return { color: "black", king: false };
    if (r > 4) return { color: "white", king: false };
    return null;
  }));
}
function inside(r, c) { return r >= 0 && r < 8 && c >= 0 && c < 8; }
function capturesFrom(r, c, state = board) {
  const p = state[r][c]; if (!p) return [];
  const enemy = p.color === "white" ? "black" : "white", out = [];
  for (const [dr, dc] of [[-1,-1],[-1,1],[1,-1],[1,1]]) {
    if (!p.king) {
      const mr = r + dr, mc = c + dc, lr = r + dr * 2, lc = c + dc * 2;
      if (inside(lr,lc) && state[mr]?.[mc]?.color === enemy && !state[lr][lc]) out.push({ from:[r,c], to:[lr,lc], capture:[mr,mc] });
    } else {
      let rr = r + dr, cc = c + dc, found = null;
      while (inside(rr,cc)) {
        const q = state[rr][cc];
        if (q) {
          if (q.color === p.color || found) break;
          found = [rr,cc];
        } else if (found) out.push({ from:[r,c], to:[rr,cc], capture:found });
        rr += dr; cc += dc;
      }
    }
  }
  return out;
}
function simpleMovesFrom(r, c, state = board) {
  const p = state[r][c]; if (!p) return []; const out = [];
  const dirs = p.king ? [[-1,-1],[-1,1],[1,-1],[1,1]] : p.color === "white" ? [[-1,-1],[-1,1]] : [[1,-1],[1,1]];
  for (const [dr,dc] of dirs) {
    let rr=r+dr,cc=c+dc;
    while (inside(rr,cc) && !state[rr][cc]) {
      out.push({from:[r,c],to:[rr,cc],capture:null});
      if (!p.king) break; rr+=dr;cc+=dc;
    }
  } return out;
}
function allMoves(color, state = board) {
  const captures = [];
  for(let r=0;r<8;r++) for(let c=0;c<8;c++) if(state[r][c]?.color===color) captures.push(...capturesFrom(r,c,state));
  if(captures.length) return captures;
  const moves=[]; for(let r=0;r<8;r++) for(let c=0;c<8;c++) if(state[r][c]?.color===color) moves.push(...simpleMovesFrom(r,c,state));
  return moves;
}
function checkersDisplayColor(logicalColor) {
  return playerPieceColor === "white" ? logicalColor : logicalColor === "white" ? "black" : "white";
}
function updateCheckersCoordinates() {
  const files = playerPieceColor === "white" ? boardFiles : [...boardFiles].reverse();
  const ranks = playerPieceColor === "white" ? ["8","7","6","5","4","3","2","1"] : ["1","2","3","4","5","6","7","8"];
  $$(".board-files").forEach(axis => $$("span", axis).forEach((span,index) => span.textContent = files[index]));
  $$(".board-ranks").forEach(axis => $$("span", axis).forEach((span,index) => span.textContent = ranks[index]));
}
function renderBoard() {
  const legal = turn === "white" && !gameOver ? allMoves("white").filter(m => !chainPiece || m.from.join() === chainPiece.join()) : [];
  $("#board").innerHTML = "";
  for(let r=0;r<8;r++) for(let c=0;c<8;c++) {
    const cell=document.createElement("button"); cell.className=`cell ${(r+c)%2?"dark":"light"}`; cell.dataset.r=r;cell.dataset.c=c;
    const p=board[r][c]; if(p) cell.innerHTML=`<span class="piece ${checkersDisplayColor(p.color)}${p.king?" king":""}"></span>`;
    if(selected?.[0]===r&&selected?.[1]===c) cell.classList.add("selected");
    if(selected && legal.some(m=>m.from.join()===selected.join()&&m.to[0]===r&&m.to[1]===c)) cell.classList.add("legal");
    cell.addEventListener("click", handleCell); $("#board").appendChild(cell);
  }
  const counts = board.flat().reduce((a,p)=>{if(p)a[p.color]++;return a},{white:0,black:0});
  $("#playerCount").textContent=counts.white;$("#botCount").textContent=counts.black;
}
function snapshotMove(m) {
  const fromCell = $(`.cell[data-r="${m.from[0]}"][data-c="${m.from[1]}"]`);
  const moving = $(".piece", fromCell);
  const capturedCell = m.capture && $(`.cell[data-r="${m.capture[0]}"][data-c="${m.capture[1]}"]`);
  const captured = capturedCell && $(".piece", capturedCell);
  if (!moving) return null;
  return {
    moving: { node: moving.cloneNode(true), rect: moving.getBoundingClientRect() },
    captured: captured ? { node: captured.cloneNode(true), rect: captured.getBoundingClientRect() } : null
  };
}
function placeFloating(item, className) {
  const node = item.node, r = item.rect;
  node.classList.add(className);
  Object.assign(node.style, { left:`${r.left}px`, top:`${r.top}px`, width:`${r.width}px`, height:`${r.height}px` });
  document.body.appendChild(node);
  return node;
}
function playMoveAnimation(snapshot, to) {
  if (!snapshot) return;
  const destination = $(`.cell[data-r="${to[0]}"][data-c="${to[1]}"] .piece`);
  if (!destination) return;
  const end = destination.getBoundingClientRect();
  destination.classList.add("piece-arriving");
  const mover = placeFloating(snapshot.moving, "moving-piece");
  const dx = end.left - snapshot.moving.rect.left, dy = end.top - snapshot.moving.rect.top;
  const travel = mover.animate([
    { transform:"translate3d(0,0,0) rotate(0deg)", offset:0 },
    { transform:`translate3d(${dx*.5}px,${dy*.5-13}px,0) rotate(2deg)`, offset:.52 },
    { transform:`translate3d(${dx}px,${dy}px,0) rotate(0deg)`, offset:1 }
  ], { duration:310, easing:"cubic-bezier(.22,.8,.25,1)", fill:"forwards" });
  travel.onfinish = () => { mover.remove(); destination.classList.remove("piece-arriving"); };
  if (snapshot.captured) {
    const victim = placeFloating(snapshot.captured, "captured-piece");
    requestAnimationFrame(() => { victim.style.transform="scale(.35) rotate(16deg)"; victim.style.opacity="0"; });
    setTimeout(() => victim.remove(),260);
  }
}
function handleCell(e) {
  if(turn!=="white"||gameOver)return;
  const r=+e.currentTarget.dataset.r,c=+e.currentTarget.dataset.c, moves=allMoves("white").filter(m=>!chainPiece||m.from.join()===chainPiece.join());
  const chosen=selected&&moves.find(m=>m.from.join()===selected.join()&&m.to[0]===r&&m.to[1]===c);
  if(chosen){performMove(chosen);return}
  if(board[r][c]?.color==="white"&&moves.some(m=>m.from[0]===r&&m.from[1]===c)){selected=[r,c];beep(330,.04)}
  else selected=null;
  renderBoard();
}
const boardFiles = ["A","B","C","D","E","F","G","H"];
function cellName([r,c]) {
  const files = playerPieceColor === "white" ? boardFiles : [...boardFiles].reverse();
  return `${files[c]}${playerPieceColor === "white" ? 8-r : r+1}`;
}
function renderMoveHistory() {
  const list = $("#moveHistory");
  $("#moveCount").textContent = moveHistory.length;
  if (!moveHistory.length) {
    list.innerHTML = '<p class="empty-moves">Ходы появятся здесь</p>';
    return;
  }
  list.innerHTML = moveHistory.map((item,index) => `
    <div class="move-row">
      <span class="move-number">${index+1}</span>
      <div class="move-main"><b>${escapeHtml(item.player)}</b><span>${escapeHtml(item.notation)}${item.promoted?" ♛":""}</span></div>
      <time class="move-time">${item.time}<small>${item.duration} сек</small></time>
    </div>
  `).join("");
  list.scrollTop = list.scrollHeight;
}
function recordMove(m,color,continuation,promoted) {
  const now = new Date();
  const duration = Math.max(0,60-seconds);
  if (continuation && moveHistory.at(-1)?.color === color) {
    const current = moveHistory.at(-1);
    current.notation += `×${cellName(m.to)}`;
    current.time = now.toLocaleTimeString("ru-RU",{hour:"2-digit",minute:"2-digit",second:"2-digit"});
    current.duration = duration;
    current.promoted ||= promoted;
  } else {
    moveHistory.push({
      color,
      player: color === "white" ? profile.name : opponentName(),
      notation: `${cellName(m.from)}${m.capture?"×":"—"}${cellName(m.to)}`,
      time: now.toLocaleTimeString("ru-RU",{hour:"2-digit",minute:"2-digit",second:"2-digit"}),
      duration,
      promoted
    });
  }
  renderMoveHistory();
}
function performMove(m) {
  const animation = snapshotMove(m);
  const continuation = Boolean(chainPiece);
  const p=board[m.from[0]][m.from[1]]; board[m.from[0]][m.from[1]]=null;board[m.to[0]][m.to[1]]=p;
  const wasKing = p.king;
  if(m.capture){board[m.capture[0]][m.capture[1]]=null;beep(170,.11)} else beep(260,.07);
  if((p.color==="white"&&m.to[0]===0)||(p.color==="black"&&m.to[0]===7))p.king=true;
  recordMove(m,p.color,continuation,!wasKing&&p.king);
  const followUpCaptures=m.capture?capturesFrom(m.to[0],m.to[1]):[];
  let technique="";
  let reason="";
  if(!wasKing&&p.king){technique="проход в дамки";reason="дамка даст контроль над длинными диагоналями";}
  else if(followUpCaptures.length>1){technique="Вилка (Люлька)";reason="сразу несколько шашек оказываются под угрозой";}
  else if(continuation&&m.capture){technique="цепное взятие";reason="серия взятий усиливает материальное преимущество";}
  else if(currentGameMode==="giveaway"&&!m.capture){technique="подготовка жертвы";reason="так можно навязать сопернику обязательное взятие";}
  if(technique)announceTechnique(technique,p.color==="white"?"player":"opponent",reason);
  if(m.capture&&capturesFrom(m.to[0],m.to[1]).length){
    chainPiece=m.to;selected=m.to;renderBoard();playMoveAnimation(animation,m.to);
    $("#gameTip").textContent=p.color==="white"?"Продолжите взятие этой же шашкой.":`${opponentName()} продолжает взятие…`;
    if(p.color==="black")setTimeout(botMove,420);
    return
  }
  chainPiece=null;selected=null;turn=p.color==="white"?"black":"white";resetTimer();renderBoard();playMoveAnimation(animation,m.to);updateTurn();
  setTimeout(checkEnd,150);if(turn==="black"&&!gameOver)setTimeout(botMove,550);
}
function simulateMove(state,m) {
  const next=state.map(row=>row.map(piece=>piece?{...piece}:null));
  const piece=next[m.from[0]][m.from[1]];
  next[m.from[0]][m.from[1]]=null;next[m.to[0]][m.to[1]]=piece;
  if(m.capture)next[m.capture[0]][m.capture[1]]=null;
  if((piece.color==="white"&&m.to[0]===0)||(piece.color==="black"&&m.to[0]===7))piece.king=true;
  return next;
}
function sameCell(a,b) {
  return Boolean(a&&b&&a[0]===b[0]&&a[1]===b[1]);
}
function applyMoveSequence(state,sequence) {
  return sequence.reduce((position,move)=>simulateMove(position,move),state);
}
function captureSequencesStartingWith(state,move) {
  const next=simulateMove(state,move);
  if(!move.capture)return [[move]];
  const continuations=capturesFrom(move.to[0],move.to[1],next);
  if(!continuations.length)return [[move]];
  return continuations.flatMap(nextMove=>
    captureSequencesStartingWith(next,nextMove).map(tail=>[move,...tail])
  );
}
function turnSequences(color,state) {
  const moves=allMoves(color,state);
  if(!moves.length)return [];
  if(!moves[0].capture)return moves.map(move=>[move]);
  return moves.flatMap(move=>captureSequencesStartingWith(state,move));
}
function sequencePriority(state,sequence) {
  const captures=sequence.filter(move=>move.capture).length;
  const firstPiece=state[sequence[0].from[0]][sequence[0].from[1]];
  const final=sequence.at(-1).to;
  const promotes=firstPiece&&!firstPiece.king&&
    ((firstPiece.color==="black"&&final[0]===7)||(firstPiece.color==="white"&&final[0]===0));
  return captures*30+(promotes?22:0);
}
function orderedTurnSequences(color,state) {
  return turnSequences(color,state)
    .sort((a,b)=>sequencePriority(state,b)-sequencePriority(state,a))
    .slice(0,14);
}
function uniqueCaptureTargets(r,c,state) {
  return new Set(capturesFrom(r,c,state).map(move=>move.capture.join(",")));
}
function sequenceCapturesCell(sequence,cell) {
  return sequence.some(move=>sameCell(move.capture,cell));
}
function tacticalBotScore(before,sequence,after) {
  const last=sequence.at(-1);
  const movedCell=last.to;
  const movedPiece=after[movedCell[0]][movedCell[1]];
  if(!movedPiece||movedPiece.color!=="black")return 0;
  const whiteReplies=turnSequences("white",after);
  if(!whiteReplies.length)return 0;

  let score=0;

  // «Люлька»: two pieces are attacked and every defence still leaves one.
  const forkTargets=uniqueCaptureTargets(movedCell[0],movedCell[1],after);
  if(forkTargets.size>=2){
    const keepsOneTarget=whiteReplies.every(reply=>{
      const replyState=applyMoveSequence(after,reply);
      if(replyState[movedCell[0]][movedCell[1]]?.color!=="black")return false;
      return uniqueCaptureTargets(movedCell[0],movedCell[1],replyState).size>=1;
    });
    if(keepsOneTarget)score+=105+forkTargets.size*18;
  }

  // «Роздых»: every legal reply is forced to spend the turn taking the offer.
  const forcedSacrifice=whiteReplies.every(reply=>sequenceCapturesCell(reply,movedCell));
  if(forcedSacrifice){
    const createsFreeTempo=whiteReplies.every(reply=>{
      const replyState=applyMoveSequence(after,reply);
      const blackReplies=turnSequences("black",replyState);
      return blackReplies.some(line=>{
        const final=line.at(-1).to;
        const piece=replyState[line[0].from[0]][line[0].from[1]];
        const promotion=piece&&!piece.king&&final[0]===7;
        return line.some(move=>move.capture)||promotion;
      });
    });
    score+=createsFreeTempo?78:38;
  }

  // «Каблук»: the forced capturer is dragged onto a square with a guaranteed recapture.
  if(forcedSacrifice){
    const guaranteedRecapture=whiteReplies.every(reply=>{
      const replyState=applyMoveSequence(after,reply);
      const capturerCell=reply.at(-1).to;
      return turnSequences("black",replyState)
        .some(counter=>sequenceCapturesCell(counter,capturerCell));
    });
    if(guaranteedRecapture){
      const firstPiece=before[sequence[0].from[0]][sequence[0].from[1]];
      const movedBack=firstPiece?.king&&last.to[0]<sequence[0].from[0];
      score+=145+(movedBack?24:0);
    }
  }
  return score;
}
function boardHash(state) {
  return state.flat().map(piece=>piece
    ? `${piece.color==="black"?"b":"w"}${piece.king?"k":"m"}`
    : "__"
  ).join("");
}
function notationCell(square) {
  const file=square.toLowerCase().charCodeAt(0)-97;
  const rank=Number(square[1]);
  return [8-rank,file];
}
function openingMoveFromSpec(state,color,spec) {
  const [fromText,toText]=spec.split(/[-x:]/i);
  const from=notationCell(fromText),to=notationCell(toText);
  return allMoves(color,state).find(move=>sameCell(move.from,from)&&sameCell(move.to,to));
}
const openingDefinitions=[
  {
    name:"Городская партия",
    moves:["c3-d4","d6-c5","d2-c3","f6-g5","c3-b4"]
  },
  {
    name:"Отказанная городская партия",
    moves:["c3-d4","d6-c5","d2-c3","f6-g5","g3-h4"]
  },
  {
    name:"Старая партия",
    moves:["c3-d4","d6-c5","b2-c3","e7-d6"]
  },
  {
    name:"Кол",
    moves:["c3-d4","b6-a5","d4-c5","d6xb4","a3xc5","f6-g5","b2-c3","g7-f6","g3-f4","g5-h4","f4-g5","h6xf4","e3xg5"]
  },
  {
    name:"Гамбит Кукуева",
    gambit:true,
    moves:["c3-d4","f6-g5","d4-c5","b6xd4","e3xc5","d6xb4","a3xc5","g5-f4","b2-c3"]
  },
  {
    name:"Отказанная игра Каулена",
    moves:["g3-f4","d6-c5"]
  },
  {
    name:"Отказанная игра Бодянского",
    moves:["a3-b4","f6-e5"]
  },
  {
    name:"Обратная городская партия",
    moves:["c3-b4","f6-e5","e3-f4","g7-f6","b4-a5","f6-g5","b2-c3","g5xe3","d2xf4"]
  },
  {
    name:"Отказанный кол",
    moves:["c3-b4","f6-e5","g3-h4","e5-f4","e3xg5","h6xf4"]
  },
  {
    name:"Игра Когана",
    moves:["c3-d4","f6-g5","b2-c3","g5-h4","c3-b4","d6-e5","d4xf6","g7xe5"]
  }
];
let openingBookCache=null;
function getOpeningBook() {
  if(openingBookCache)return openingBookCache;
  const book=new Map();
  for(const opening of openingDefinitions){
    let state=initialBoard(),color="white";
    for(const spec of opening.moves){
      const move=openingMoveFromSpec(state,color,spec);
      if(!move)break;
      if(color==="black"){
        const key=boardHash(state);
        if(!book.has(key))book.set(key,[]);
        book.get(key).push({name:opening.name,gambit:Boolean(opening.gambit),move});
      }
      state=simulateMove(state,move);
      color=color==="white"?"black":"white";
    }
  }
  openingBookCache=book;
  return book;
}
function connectedPieces(color,state) {
  let links=0;
  for(let r=0;r<8;r++)for(let c=0;c<8;c++){
    if(state[r][c]?.color!==color)continue;
    for(const [dr,dc] of [[-1,-1],[-1,1],[1,-1],[1,1]]){
      if(state[r+dr]?.[c+dc]?.color===color)links++;
    }
  }
  return links/2;
}
function activeMovesForPiece(r,c,state) {
  return capturesFrom(r,c,state).length+simpleMovesFrom(r,c,state).length;
}
function flankState(color,state,left) {
  let pieces=0,mobility=0;
  for(let r=0;r<8;r++)for(let c=left?0:4;c<(left?4:8);c++){
    if(state[r][c]?.color!==color)continue;
    pieces++;mobility+=activeMovesForPiece(r,c,state);
  }
  return {pieces,mobility};
}
function vulnerablePieces(color,state) {
  const enemy=color==="black"?"white":"black";
  return new Set(allMoves(enemy,state)
    .filter(move=>move.capture&&state[move.capture[0]][move.capture[1]]?.color===color)
    .map(move=>move.capture.join(","))).size;
}
function positionalBotScore(state) {
  let score=0,blackCenter=0,whiteCenter=0,blackFlankPressure=0,whiteFlankPressure=0;
  for(let r=0;r<8;r++)for(let c=0;c<8;c++){
    const piece=state[r][c];if(!piece)continue;
    const central=r>=2&&r<=5&&c>=2&&c<=5;
    const pressure=r>=2&&r<=5&&(c<=1||c>=6);
    if(piece.color==="black"){
      if(central)blackCenter++;
      if(pressure)blackFlankPressure++;
      score+=activeMovesForPiece(r,c,state)*3;
      if(c===0||c===7)score-=piece.king?2:6;
    }else{
      if(central)whiteCenter++;
      if(pressure)whiteFlankPressure++;
      score-=activeMovesForPiece(r,c,state)*3;
      if(c===0||c===7)score+=piece.king?2:6;
    }
  }

  // Cohesive groups are harder to split and provide more exchange supports.
  score+=(connectedPieces("black",state)-connectedPieces("white",state))*5;

  // Surround an overextended centre from both wings instead of occupying it blindly.
  if(whiteCenter>=2&&blackFlankPressure>=2)score+=Math.min(whiteCenter,blackFlankPressure)*11;
  if(blackCenter>=2&&whiteFlankPressure>=2)score-=Math.min(blackCenter,whiteFlankPressure)*11;

  // A flank with several pieces and almost no legal development is effectively bound.
  for(const left of [true,false]){
    const whiteFlank=flankState("white",state,left);
    const blackFlank=flankState("black",state,left);
    if(whiteFlank.pieces>=2&&whiteFlank.mobility<=1)score+=28+whiteFlank.pieces*4;
    if(blackFlank.pieces>=2&&blackFlank.mobility<=1)score-=28+blackFlank.pieces*4;
  }

  // Weak pieces and the traditional last-rank guard matter beyond raw material.
  score+=(vulnerablePieces("white",state)-vulnerablePieces("black",state))*17;
  if(state[0][3]?.color==="black")score+=12;
  if(state[7][4]?.color==="white")score-=12;
  return score;
}
function combinedPatternScore(state,sequence) {
  const captures=sequence.filter(move=>move.capture);
  if(captures.length<2)return 0;
  let turns=0;
  const directions=captures.map(move=>[
    Math.sign(move.to[0]-move.from[0]),
    Math.sign(move.to[1]-move.from[1])
  ]);
  for(let i=1;i<directions.length;i++){
    if(directions[i][0]!==directions[i-1][0]||directions[i][1]!==directions[i-1][1])turns++;
  }
  const files=sequence.flatMap(move=>[move.from[1],move.to[1]]);
  const span=Math.max(...files)-Math.min(...files);
  const start=sequence[0].from,end=sequence.at(-1).to;
  const circlesBack=Math.abs(start[0]-end[0])<=1&&Math.abs(start[1]-end[1])<=1;
  const piece=state[start[0]][start[1]];
  const promotes=piece&&!piece.king&&piece.color==="black"&&end[0]===7;
  return captures.length*13+turns*9+(span>=4?18:0)+(circlesBack?22:0)+(promotes?26:0);
}
const petrovPermutations=[
  [0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]
];
function transformBoardCell([r,c],variant) {
  switch(variant){
    case 0:return [r,c];
    case 1:return [c,7-r];
    case 2:return [7-r,7-c];
    case 3:return [7-c,r];
    case 4:return [r,7-c];
    case 5:return [7-r,c];
    case 6:return [c,r];
    case 7:return [7-c,7-r];
    default:return [r,c];
  }
}
function buildPetrovTargets() {
  const bases=[
    [[5,4],[4,5],[5,2]],
    [[5,4],[4,5],[2,5]]
  ];
  const unique=new Map();
  for(const base of bases)for(let variant=0;variant<8;variant++){
    const target=base.map(cell=>transformBoardCell(cell,variant));
    const key=target.map(cell=>cell.join(",")).sort().join("|");
    unique.set(key,target);
  }
  return [...unique.values()];
}
const petrovTargets=buildPetrovTargets();
function kingStepDistance(a,b) {
  if(sameCell(a,b))return 0;
  if(Math.abs(a[0]-b[0])===Math.abs(a[1]-b[1]))return 1;
  return 2+Math.min(Math.abs(a[0]-b[0]),Math.abs(a[1]-b[1]))*.25;
}
function formationDistance(kings,target) {
  return Math.min(...petrovPermutations.map(permutation=>
    permutation.reduce((sum,targetIndex,kingIndex)=>
      sum+kingStepDistance(kings[kingIndex],target[targetIndex]),0)
  ));
}
function materialInventory(state) {
  const result={black:0,white:0,blackKings:0,whiteKings:0};
  for(const piece of state.flat()){
    if(!piece)continue;
    result[piece.color]++;
    if(piece.king)result[`${piece.color}Kings`]++;
  }
  return result;
}
function materialClass(state) {
  const inventory=materialInventory(state);
  const high=Math.max(inventory.black,inventory.white);
  const low=Math.min(inventory.black,inventory.white);
  return `${high}x${low}`;
}
function isEndgameBasePosition(state) {
  const inventory=materialInventory(state);
  const total=inventory.black+inventory.white;
  return total<=6&&["2x2","3x2","3x3","3x1"].includes(materialClass(state));
}
function petrovTriangleScore(state,strongColor) {
  const enemy=strongColor==="black"?"white":"black";
  const strongKings=[],enemyPieces=[];
  for(let r=0;r<8;r++)for(let c=0;c<8;c++){
    const piece=state[r][c];if(!piece)continue;
    if(piece.color===strongColor&&piece.king)strongKings.push([r,c]);
    if(piece.color===enemy)enemyPieces.push([r,c,piece]);
  }
  if(strongKings.length!==3||enemyPieces.length!==1||!enemyPieces[0][2].king)return 0;
  const enemyCell=enemyPieces[0];
  const strongOnRoad=strongKings.filter(([r,c])=>r+c===7).length;
  const enemyOnRoad=enemyCell[0]+enemyCell[1]===7;
  const bestFormation=Math.min(...petrovTargets.map(target=>formationDistance(strongKings,target)));
  const enemyMobility=activeMovesForPiece(enemyCell[0],enemyCell[1],state);
  let value=220-bestFormation*24-enemyMobility*11;
  if(strongOnRoad&& !enemyOnRoad)value+=190;
  if(enemyOnRoad&&!strongOnRoad)value-=150;
  if(bestFormation===0)value+=260;
  return strongColor==="black"?value:-value;
}
function endgameKnowledgeScore(state) {
  const inventory=materialInventory(state);
  let score=evaluateBotState(state);
  score+=petrovTriangleScore(state,"black");
  score+=petrovTriangleScore(state,"white");

  // Equal small-material endings are drawish unless mobility or promotion breaks symmetry.
  if(inventory.black===inventory.white&&inventory.black<=3){
    score*=.58;
  }

  // With three kings against one, ownership of the long a1-h8 diagonal is decisive;
  // an isolated king holding it is treated as a drawing fortress until calculation disproves it.
  if(inventory.black===3&&inventory.blackKings===3&&inventory.white===1&&inventory.whiteKings===1){
    const whiteCell=[];
    state.forEach((row,r)=>row.forEach((piece,c)=>{if(piece?.color==="white")whiteCell.push(r,c)}));
    const blackOwnsRoad=state.some((row,r)=>row.some((piece,c)=>piece?.color==="black"&&piece.king&&r+c===7));
    if(whiteCell[0]+whiteCell[1]===7&&!blackOwnsRoad)score=Math.min(score,35);
  }
  if(inventory.white===3&&inventory.whiteKings===3&&inventory.black===1&&inventory.blackKings===1){
    const blackCell=[];
    state.forEach((row,r)=>row.forEach((piece,c)=>{if(piece?.color==="black")blackCell.push(r,c)}));
    const whiteOwnsRoad=state.some((row,r)=>row.some((piece,c)=>piece?.color==="white"&&piece.king&&r+c===7));
    if(blackCell[0]+blackCell[1]===7&&!whiteOwnsRoad)score=Math.max(score,-35);
  }
  return score;
}
const endgameBaseCache=new Map();
function orderedEndgameSequences(color,state) {
  return turnSequences(color,state)
    .sort((a,b)=>sequencePriority(state,b)-sequencePriority(state,a));
}
function solveEndgame(state,depth,color,alpha,beta,path,context) {
  context.nodes++;
  if(context.nodes>context.maxNodes||depth<=0)return endgameKnowledgeScore(state);
  const positionKey=`${boardHash(state)}:${color}`;
  if(path.has(positionKey))return 0;
  const cacheKey=`${positionKey}:${depth}`;
  if(endgameBaseCache.has(cacheKey))return endgameBaseCache.get(cacheKey);
  const sequences=orderedEndgameSequences(color,state);
  if(!sequences.length)return color==="black"?-100000-depth:100000+depth;
  path.add(positionKey);
  let best=color==="black"?-Infinity:Infinity;
  if(color==="black"){
    for(const sequence of sequences){
      const value=solveEndgame(applyMoveSequence(state,sequence),depth-1,"white",alpha,beta,path,context);
      best=Math.max(best,value);alpha=Math.max(alpha,best);
      if(beta<=alpha||context.nodes>context.maxNodes)break;
    }
  }else{
    for(const sequence of sequences){
      const value=solveEndgame(applyMoveSequence(state,sequence),depth-1,"black",alpha,beta,path,context);
      best=Math.min(best,value);beta=Math.min(beta,best);
      if(beta<=alpha||context.nodes>context.maxNodes)break;
    }
  }
  path.delete(positionKey);
  if(context.nodes<=context.maxNodes){
    if(endgameBaseCache.size>80000)endgameBaseCache.clear();
    endgameBaseCache.set(cacheKey,best);
  }
  return best;
}
function chooseEndgameMove(moves,level) {
  const total=board.flat().filter(Boolean).length;
  const depth=level==="V2"
    ? total<=4?14:total===5?10:8
    : total<=4?10:total===5?8:6;
  const context={nodes:0,maxNodes:level==="V2"?48000:19000};
  const ranked=moves.flatMap(move=>captureSequencesStartingWith(board,move).map(sequence=>{
    const after=applyMoveSequence(board,sequence);
    const path=new Set([`${boardHash(board)}:black`]);
    const solved=solveEndgame(after,depth-1,"white",-Infinity,Infinity,path,context);
    const technique=petrovTriangleScore(after,"black")+combinedPatternScore(board,sequence);
    return {move,score:solved+technique*.35};
  })).sort((a,b)=>b.score-a.score);
  return ranked[0]?.move||moves[0];
}
function evaluateBotState(state) {
  let score=0;
  for(let r=0;r<8;r++)for(let c=0;c<8;c++){
    const piece=state[r][c];if(!piece)continue;
    const sign=piece.color==="black"?1:-1;
    const material=piece.king?310:100;
    const advancement=piece.king?0:(piece.color==="black"?r:7-r)*5;
    const center=(c>=2&&c<=5&&r>=2&&r<=5)?12:0;
    score+=sign*(material+advancement+center);
  }
  score+=(allMoves("black",state).length-allMoves("white",state).length)*3;
  score+=positionalBotScore(state);
  return currentGameMode==="giveaway"?-score:score;
}
function minimax(state,depth,color,alpha=-Infinity,beta=Infinity) {
  if(depth<=0)return evaluateBotState(state);
  const sequences=orderedTurnSequences(color,state);
  if(!sequences.length){
    if(currentGameMode==="giveaway")return color==="black"?10000+depth:-10000-depth;
    return color==="black"?-10000-depth:10000+depth;
  }
  if(color==="black"){
    let best=-Infinity;
    for(const sequence of sequences){
      best=Math.max(best,minimax(applyMoveSequence(state,sequence),depth-1,"white",alpha,beta));
      alpha=Math.max(alpha,best);if(beta<=alpha)break;
    }
    return best;
  }
  let best=Infinity;
  for(const sequence of sequences){
    best=Math.min(best,minimax(applyMoveSequence(state,sequence),depth-1,"black",alpha,beta));
    beta=Math.min(beta,best);if(beta<=alpha)break;
  }
  return best;
}
function chooseBotMove(moves) {
  const level=opponentLevelForMode(currentGameMode);
  if(level==="A1")return moves[Math.floor(Math.random()*moves.length)];
  if(level==="A2"){
    const ranked=moves.map(move=>({move,score:(move.capture?35:0)+(move.to[0]===7?18:0)+Math.random()*28})).sort((a,b)=>b.score-a.score);
    return ranked[0].move;
  }
  if(level==="B1"){
    return moves.map(move=>({move,score:evaluateBotState(simulateMove(board,move))+Math.random()*12}))
      .sort((a,b)=>b.score-a.score)[0].move;
  }
  const depth=level==="B2"?2:level==="V1"?3:4;
  if(currentGameMode==="checkers"&&(level==="V1"||level==="V2")&&isEndgameBasePosition(board)){
    activeOpeningName=null;
    return chooseEndgameMove(moves,level);
  }
  if(currentGameMode==="checkers"&&(level==="V1"||level==="V2")&&moveHistory.length<12){
    let entries=getOpeningBook().get(boardHash(board))||[];
    if(activeOpeningName){
      const continuation=entries.filter(entry=>entry.name===activeOpeningName);
      if(continuation.length)entries=continuation;
    }
    const legalEntries=entries.filter(entry=>moves.some(move=>
      sameCell(move.from,entry.move.from)&&sameCell(move.to,entry.move.to)
    ));
    if(legalEntries.length){
      const ranked=legalEntries.map(entry=>{
        const move=moves.find(candidate=>sameCell(candidate.from,entry.move.from)&&sameCell(candidate.to,entry.move.to));
        const bestLine=Math.max(...captureSequencesStartingWith(board,move).map(sequence=>{
          const after=applyMoveSequence(board,sequence);
          return minimax(after,depth-1,"white")+
            combinedPatternScore(board,sequence)+
            (entry.gambit?24:42);
        }));
        return {entry,move,score:bestLine+Math.random()*4};
      }).sort((a,b)=>b.score-a.score);
      activeOpeningName=ranked[0].entry.name;
      return ranked[0].move;
    }
  }
  const tacticsWeight=level==="V1"?.82:level==="V2"?1:0;
  return moves.flatMap(move=>captureSequencesStartingWith(board,move).map(sequence=>{
    const after=applyMoveSequence(board,sequence);
    return {
      move,
      score:minimax(after,depth-1,"white")+
        (currentGameMode==="checkers"?tacticalBotScore(board,sequence,after)*tacticsWeight:0)+
        (currentGameMode==="checkers"?combinedPatternScore(board,sequence)*tacticsWeight:0)
    };
  })).sort((a,b)=>b.score-a.score)[0].move;
}
function botMove() {
  if(turn!=="black"||gameOver)return;
  const moves=allMoves("black").filter(m=>!chainPiece||m.from.join()===chainPiece.join());
  if(!moves.length){finishGame(currentGameMode==="giveaway"?"loss":"win");return}
  const baseClass=currentGameMode==="checkers"&&isEndgameBasePosition(board)?materialClass(board):null;
  const move=chooseBotMove(moves);
  if(activeOpeningName&&activeOpeningName!==announcedOpeningName){
    announcedOpeningName=activeOpeningName;
    $("#gameMessages").insertAdjacentHTML("beforeend",`<p class="system">Дебют ${escapeHtml(opponentName())}: ${escapeHtml(activeOpeningName)}</p>`);
  }
  if(baseClass&&baseClass!==announcedEndgameClass){
    announcedEndgameClass=baseClass;
    const inventory=materialInventory(board);
    const petrov=baseClass==="3x1"&&
      ((inventory.blackKings===3&&inventory.whiteKings===1)||(inventory.whiteKings===3&&inventory.blackKings===1));
    $("#gameMessages").insertAdjacentHTML("beforeend",
      `<p class="system">Эндшпильная база: ${baseClass}${petrov?" · Треугольник Петрова":""}</p>`);
  }
  performMove(move);
}
function updateTurn() {
  $("#turnText").textContent=turn==="white"?"Ваш ход":`${opponentName()} думает`;
  $("#gameTip").textContent=turn==="white"
    ? currentGameMode==="giveaway"
      ? `Вы играете ${playerPieceColor==="white"?"белыми":"чёрными"}. Побеждает тот, кто первым избавится от шашек.`
      : `Вы играете ${playerPieceColor==="white"?"белыми":"чёрными"}. Взятие обязательно.`
    : `Ход ${playerPieceColor==="white"?"чёрных":"белых"} — ${opponentName()} думает…`;
}
function resetTimer(){seconds=60;updateTimer()}
function updateTimer(){
  $("#timer").textContent=`0:${String(seconds).padStart(2,"0")}`;
  $("#timerFill").style.transform=`scaleX(${seconds/60})`;
}
function showResultOverlay(win,delta) {
  const overlay=$("#resultOverlay");
  overlay.classList.remove("hidden","is-win","is-loss");
  overlay.classList.add(win?"is-win":"is-loss");
  $("#resultEyebrow").textContent=win?"Победа в партии":"Партия завершена";
  $("#resultTitle").textContent=win?"Вы победили!":"Вы проиграли";
  let message=win
    ?"Кубок этой партии ваш. Закрепите успех в новой игре!"
    :"Не расстраивайтесь — следующая партия уже может стать победной.";
  if(profile.games.length===10){
    const tier=calculatePlayerTier();
    message+=` Вы завершили 10 партий — вам присвоен уровень ${tierLabels[tier]}.`;
  }
  $("#resultMessage").textContent=message;
  $("#resultDelta").textContent=`${delta>0?"+":""}${delta}`;
  requestAnimationFrame(()=>$("#replayButton").focus());
}
function hideResultOverlay() {
  $("#resultOverlay").classList.add("hidden");
  $("#resultOverlay").classList.remove("is-win","is-loss");
}
function checkEnd(){
  const white=board.flat().filter(p=>p?.color==="white").length,black=board.flat().filter(p=>p?.color==="black").length;
  if(currentGameMode==="giveaway"){
    if(!white||!allMoves("white").length)finishGame("win");
    else if(!black||!allMoves("black").length)finishGame("loss");
  }else{
    if(!black||!allMoves("black").length)finishGame("win");
    else if(!white||!allMoves("white").length)finishGame("loss");
  }
}
function finishGame(result){
  if(gameOver)return;gameOver=true;clearInterval(timerId);
  const win=result==="win",delta=win?18:-12;profile.rating=Math.max(0,profile.rating+delta);
  profile.games.push({result:win?"Победа":"Поражение",opponent:opponentName(),date:new Date().toLocaleDateString("ru-RU"),delta});
  recordTournamentResult(win?2:0);
  saveProfile();applyProfile();$("#turnText").textContent=win?"Победа!":"Партия окончена";
  $("#gameTip").textContent=win?`Рейтинг +${delta}. Отличная партия.`:`Рейтинг ${delta}. Попробуйте ещё раз.`;
  beep(win?540:120,.35);
  showResultOverlay(win,delta);
}
function startGame(tableNo,mode="checkers"){
  currentTableNo=String(tableNo);currentGameMode=mode;hideResultOverlay();setActiveOpponent(activeOpponentId);updateDifficultyUI();cancelCoinToss();
  resetYuliaConversation("game");
  resetInnokentiyConversation("game");
  resetOlesyaConversation("game");
  board=initialBoard();turn="white";selected=null;chainPiece=null;gameOver=true;seconds=60;moveHistory=[];activeOpeningName=null;announcedOpeningName=null;announcedEndgameClass=null;
  $("#checkersGameTitle").textContent=mode==="giveaway"?"Поддавки":"Русские шашки";
  $("#gameTableNumber").textContent=String(tableNo).padStart(2,"0");
  $("#gameMessages").innerHTML='<p class="system">Сначала разыграем цвет фигур и первый ход.</p>';
  renderBoard();renderMoveHistory();updateTimer();
  $(".game-shell").classList.add("game-pending-toss");
  if(!$("#gameDialog").open)$("#gameDialog").showModal();
  clearInterval(timerId);
  runCoinToss(mode==="giveaway"?"Поддавки":"Русские шашки",({color})=>{
    playerPieceColor=color;turn=color==="white"?"white":"black";gameOver=false;
    updateCheckersCoordinates();renderBoard();updateTurn();resetTimer();
    $(".game-shell").classList.remove("game-pending-toss");
    startMatchConversation(
      $("#gameMessages"),
      mode,
      color==="white"
        ?"Решка: вы играете белыми и ходите первой."
        :`Орёл: вы играете чёрными. Первый ход делает ${opponentName()} белыми.`
    );
    timerId=setInterval(()=>{
      if(gameOver)return;seconds--;updateTimer();
      if(seconds<=0){if(turn==="white")finishGame("loss");else{turn="white";resetTimer();updateTurn();renderBoard()}}
    },1000);
    if(turn==="black")setTimeout(botMove,520);
  });
}
function exitGameToClub(){
  clearInterval(timerId);hideResultOverlay();cancelCoinToss();$(".game-shell").classList.remove("game-pending-toss");
  if($("#gameDialog").open)$("#gameDialog").close();
  leaveSeat();toast("Вы вернулись в клуб");
}
$("#leaveGame").addEventListener("click",exitGameToClub);
$("#resultExitButton").addEventListener("click",exitGameToClub);
$("#replayButton").addEventListener("click",()=>startGame(currentTableNo,currentGameMode));
$("#soundButton").addEventListener("click",()=>{soundOn=!soundOn;$("#soundButton").textContent=`Звук: ${soundOn?"вкл.":"выкл."}`;if(soundOn)beep(400)});

applyProfile(); detectTable();
window.setInterval(renderPlayerProfile,60000);
if (!localStorage.getItem("quietMoveWelcomed")) {
  localStorage.setItem("quietMoveWelcomed","1"); setTimeout(()=>$("#customizer").showModal(),350);
}
