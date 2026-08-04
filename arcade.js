const arcadeEl=id=>document.getElementById(id);
const arcadeNames={corners:"Уголки",chess:"Шахматы",domino:"Домино «Козёл»",fives:"Домино «Пятёрочки»"};
let arcadeTableNo="01",arcadeMode=null,arcadeOver=false,arcadeTimer=null,arcadeRestartAction=null;
let arcadeTimeline=[],arcadeTimelineIndex=-1,arcadeHistoryReview=false,arcadeAnalysisMode=false;
let arcadeResultRecorded=false;
let computerGameMenu=false;
let arcadeAnimating=false,pendingArcadeMove=null,arcadeAnimationRun=0;

function captureArcadeMover(selector){
  const node=document.querySelector(selector);
  if(!node)return null;
  return{node:node.cloneNode(true),rect:node.getBoundingClientRect()};
}
function queueArcadeMove(snapshot,destinationSelector){
  if(!snapshot)return;
  pendingArcadeMove={...snapshot,destinationSelector};
}
function clearArcadeMoveAnimation(){
  arcadeAnimationRun++;arcadeAnimating=false;pendingArcadeMove=null;
  document.querySelectorAll(".arcade-moving-piece").forEach(node=>node.remove());
  document.querySelectorAll(".arcade-piece-arriving").forEach(node=>node.classList.remove("arcade-piece-arriving"));
}
function playPendingArcadeMove(){
  const pending=pendingArcadeMove;pendingArcadeMove=null;
  if(!pending)return;
  const destination=document.querySelector(pending.destinationSelector);
  if(!destination)return;
  const run=++arcadeAnimationRun,end=destination.getBoundingClientRect(),mover=pending.node;
  arcadeAnimating=true;destination.classList.add("arcade-piece-arriving");
  mover.classList.add("arcade-moving-piece");
  Object.assign(mover.style,{left:`${pending.rect.left}px`,top:`${pending.rect.top}px`,width:`${pending.rect.width}px`,height:`${pending.rect.height}px`});
  document.body.appendChild(mover);
  const dx=end.left-pending.rect.left,dy=end.top-pending.rect.top;
  const travel=mover.animate([
    {transform:"translate3d(0,0,0) scale(1)",offset:0},
    {transform:`translate3d(${dx*.5}px,${dy*.5-10}px,0) scale(1.035)`,offset:.5},
    {transform:`translate3d(${dx}px,${dy}px,0) scale(1)`,offset:1}
  ],{duration:window.matchMedia("(prefers-reduced-motion: reduce)").matches?1:680,easing:"cubic-bezier(.22,.72,.2,1)",fill:"forwards"});
  const finish=()=>{
    mover.remove();destination.classList.remove("arcade-piece-arriving");
    if(run===arcadeAnimationRun)arcadeAnimating=false;
  };
  travel.onfinish=finish;travel.oncancel=finish;
}

function cloneArcadeState(value){
  return typeof structuredClone==="function"?structuredClone(value):JSON.parse(JSON.stringify(value));
}
function updateArcadeHistoryControls(){
  const back=arcadeEl("arcadeHistoryBack"),forward=arcadeEl("arcadeHistoryForward");
  if(!back||!forward)return;
  const last=Math.max(0,arcadeTimeline.length-1),position=Math.max(0,arcadeTimelineIndex);
  back.disabled=arcadeTimelineIndex<=0||arcadeOver;
  forward.disabled=arcadeTimelineIndex<0||arcadeTimelineIndex>=arcadeTimeline.length-1||arcadeOver;
  arcadeEl("arcadeHistoryPosition").textContent=`Ход ${position} из ${last}`;
  const hint=arcadeEl("arcadeHistoryHint");
  hint.classList.toggle("is-reviewing",arcadeHistoryReview);
  hint.textContent=arcadeHistoryReview
    ?"Просмотр позиции: часы и бот на паузе. Сделайте свой ход, чтобы создать новое продолжение."
    :"Можно вернуться к позиции и выбрать другое продолжение.";
}
function clearArcadeTimeline(){
  arcadeTimeline=[];arcadeTimelineIndex=-1;arcadeHistoryReview=false;arcadeAnalysisMode=false;updateArcadeHistoryControls();
}
function captureArcadePosition(){
  if(arcadeMode==="corners")return{
    mode:"corners",board:cloneArcadeState(cornerBoard),turn:cornerTurn,
    selected:cloneArcadeState(cornerSelected),chain:cloneArcadeState(cornerChain),last:cloneArcadeState(cornerLast)
  };
  if(arcadeMode==="chess")return{
    mode:"chess",board:cloneArcadeState(chessBoard),turn:chessTurn,
    selected:cloneArcadeState(chessSelected),lastMove:cloneArcadeState(chessLastMove),
    history:cloneArcadeState(chessHistory),halfmove:chessHalfmove,
    playerColor:chessPlayerColor,botColor:chessBotColor
  };
  if(["domino","fives"].includes(arcadeMode))return{mode:arcadeMode,domino:cloneArcadeState(domino)};
  return null;
}
function pushArcadePosition(){
  const snapshot=captureArcadePosition();if(!snapshot)return;
  if(arcadeTimelineIndex<arcadeTimeline.length-1)arcadeTimeline=arcadeTimeline.slice(0,arcadeTimelineIndex+1);
  arcadeTimeline.push(snapshot);arcadeTimelineIndex=arcadeTimeline.length-1;arcadeHistoryReview=false;
  updateArcadeHistoryControls();
}
function resetArcadeTimeline(){
  arcadeTimeline=[];arcadeTimelineIndex=-1;arcadeHistoryReview=false;arcadeAnalysisMode=false;pushArcadePosition();
}
function restoreArcadePosition(snapshot){
  clearTimeout(arcadeTimer);arcadeTimer=null;clearArcadeMoveAnimation();hideArcadeResult();arcadeOver=false;setArcadeActions([]);
  if(snapshot.mode==="corners"){
    cornerBoard=cloneArcadeState(snapshot.board);cornerTurn=snapshot.turn;
    cornerSelected=cloneArcadeState(snapshot.selected);cornerChain=cloneArcadeState(snapshot.chain);cornerLast=cloneArcadeState(snapshot.last);
    renderCorners();
  }else if(snapshot.mode==="chess"){
    chessBoard=cloneArcadeState(snapshot.board);chessTurn=snapshot.turn;
    chessSelected=cloneArcadeState(snapshot.selected);chessLastMove=cloneArcadeState(snapshot.lastMove);
    chessHistory=cloneArcadeState(snapshot.history);chessHalfmove=snapshot.halfmove;
    chessPlayerColor=snapshot.playerColor;chessBotColor=snapshot.botColor;renderChess();
  }else{
    domino=cloneArcadeState(snapshot.domino);renderDomino();
  }
}
function resumeArcadeFromLatest(){
  arcadeHistoryReview=false;updateArcadeHistoryControls();
  if(arcadeOver)return;
  if(arcadeMode==="corners"&&cornerTurn==="bot"&&!onlineHumanMatch("corners"))arcadeTimer=setTimeout(cornerBotMove,380);
  else if(arcadeMode==="chess"&&chessTurn===chessBotColor&&!onlineHumanMatch("chess"))arcadeTimer=setTimeout(chessBotMove,420);
  else if(["domino","fives"].includes(arcadeMode)&&domino.turn==="bot"&&!onlineHumanMatch(arcadeMode))arcadeTimer=setTimeout(dominoBot,430);
}
function stepArcadeHistory(direction){
  const next=arcadeTimelineIndex+direction;
  if(next<0||next>=arcadeTimeline.length||arcadeOver)return;
  arcadeTimelineIndex=next;arcadeHistoryReview=arcadeAnalysisMode||next<arcadeTimeline.length-1;
  restoreArcadePosition(arcadeTimeline[next]);
  if(!arcadeHistoryReview)resumeArcadeFromLatest();else updateArcadeHistoryControls();
}
function beginArcadeHistoryBranch(){
  if(!arcadeHistoryReview)return;
  clearTimeout(arcadeTimer);arcadeTimer=null;
  arcadeTimeline=arcadeTimeline.slice(0,arcadeTimelineIndex+1);
  arcadeHistoryReview=false;arcadeAnalysisMode=false;arcadeOver=false;hideArcadeResult();updateArcadeHistoryControls();
}

function openTableGameMenu(tableNo,computerMode=false){
  computerGameMenu=computerMode;
  window.computerOpponentMode=computerMode;
  arcadeTableNo=String(tableNo);
  arcadeEl("menuTableNumber").textContent=computerMode?"ПК":arcadeTableNo.padStart(2,"0");
  arcadeEl("interaction").textContent=computerMode?"Выберите игру против компьютера":"Выберите игру";
  setActiveOpponent(null);
  if(!arcadeEl("gameMenuDialog").open)arcadeEl("gameMenuDialog").showModal();
}
function openComputerGameMenu(){
  if(arcadeEl("gameDialog")?.open||arcadeEl("arcadeDialog")?.open)return;
  window.clubOnline?.cancelSearch();
  window.clubOnline?.leaveTable();
  window.setOnlineOpponent?.(null);
  leaveSeat();
  openTableGameMenu("ПК",true);
}
function closeMenuToClub(){
  arcadeEl("gameMenuDialog").close();
  window.clubOnline?.leaveTable();
  computerGameMenu=false;
  window.computerOpponentMode=false;
  setActiveOpponent(null);
  leaveSeat();
  arcadeEl("interaction").textContent="Подойдите к свободному столу";
}
function hideArcadeResult(){
  const overlay=arcadeEl("arcadeResultOverlay");
  overlay.classList.add("hidden");
  overlay.classList.remove("is-win","is-loss","is-draw");
  arcadeRestartAction=null;
}
function cleanupArcade(){clearTimeout(arcadeTimer);arcadeTimer=null;arcadeOver=true;pendingArcadeOnlineActions.length=0;clearArcadeMoveAnimation();hideArcadeResult();closeWinStreakPopup();cancelLossRescue();clearArcadeTimeline();cancelCoinToss();document.querySelector(".arcade-shell")?.classList.remove("arcade-pending-toss");arcadeEl("arcadeMarketSlot").classList.add("hidden");arcadeEl("arcadeMarketSlot").innerHTML=""}
function openArcade(mode){
  arcadeMode=mode;currentGameMode=mode;arcadeOver=false;clearArcadeMoveAnimation();hideArcadeResult();clearArcadeTimeline();
  if(!onlineHumanMatch(mode))window.clubOnline?.cancelSearch();
  if(!computerGameMenu)window.clubOnline?.joinTable(arcadeTableNo,mode);
  arcadeEl("arcadePlayerLabel").textContent="Вы";
  arcadeEl("arcadeBotLabel").textContent=opponentName();
  arcadeEl("arcadePlayerScore").classList.remove("fives-score");
  arcadeEl("arcadeBotScore").classList.remove("fives-score");
  updateDifficultyUI();
  arcadeEl("arcadeMarketSlot").classList.toggle("hidden",!["domino","fives"].includes(mode));
  arcadeEl("gameMenuDialog").close();
  arcadeEl("arcadeTableNumber").textContent=arcadeTableNo.padStart(2,"0");
  arcadeEl("arcadeTitle").textContent=arcadeNames[mode];
  arcadeEl("arcadeDialog").showModal();
  if(mode==="corners")startCorners();
  else if(mode==="chess")startChess();
  else startDomino(mode==="fives");
}
window.launchOnlineMatch=match=>{
  if(!match)return;
  computerGameMenu=false;
  window.computerOpponentMode=false;
  arcadeTableNo=String(match.tableNumber);
  currentTableNo=String(match.tableNumber);
  currentGameMode=match.game;
  if(["checkers","giveaway"].includes(match.game))startGame(match.tableNumber,match.game);
  else openArcade(match.game);
};
function backToGameMenu(){
  cleanupArcade();arcadeEl("arcadeDialog").close();openTableGameMenu(arcadeTableNo,computerGameMenu);
}
function exitArcade(){
  cleanupArcade();arcadeEl("arcadeDialog").close();leaveSeat();
  window.clubOnline?.leaveTable();
  computerGameMenu=false;
  window.computerOpponentMode=false;
  setActiveOpponent(null);
  arcadeEl("interaction").textContent="Подойдите к свободному столу";
}
function setArcadeRules(title,text){arcadeEl("arcadeRulesTitle").textContent=title;arcadeEl("arcadeRules").textContent=text}
function setArcadeActions(buttons){
  arcadeEl("arcadeActions").innerHTML="";
  buttons.forEach(({label,action,primary=false,disabled=false})=>{
    const button=document.createElement("button");button.textContent=label;button.disabled=disabled;
    if(primary)button.classList.add("primary");button.addEventListener("click",action);
    arcadeEl("arcadeActions").appendChild(button);
  });
}
function finishArcade(win,message,restart,skipLossRescue=false){
  if(win===false&&!skipLossRescue&&!arcadeResultRecorded){
    arcadeOver=true;clearTimeout(arcadeTimer);arcadeTimer=null;
    updateArcadeHistoryControls();
    showLossRescueOffer({
      gameLabel:arcadeNames[arcadeMode],
      onDecline:()=>{arcadeOver=false;finishArcade(false,message,restart,true)},
      onComplete:restart
    });
    return;
  }
  arcadeOver=true;clearTimeout(arcadeTimer);
  arcadeAnalysisMode=false;
  updateArcadeHistoryControls();
  if(!arcadeResultRecorded){
    arcadeResultRecorded=true;
    recordWinStreak(win===null?"draw":win?"win":"loss",arcadeNames[arcadeMode]);
  }
  arcadeEl("arcadeStatus").textContent=win===null?"Ничья":win?"Вы победили!":`${opponentName()} победил`;
  arcadeEl("arcadeInfo").innerHTML=`<b>${message}</b>`;
  setArcadeActions([
    {label:"Сыграть ещё раз",action:restart,primary:true},
    {label:"Выбрать другую игру",action:backToGameMenu}
  ]);
  const overlay=arcadeEl("arcadeResultOverlay");
  arcadeRestartAction=restart;
  arcadeEl("arcadeResultEyebrow").textContent=win===null
    ?`${arcadeNames[arcadeMode]} · ничья`
    :`${arcadeNames[arcadeMode]} · ${win?"победа":"поражение"}`;
  arcadeEl("arcadeResultTitle").textContent=win===null?"Ничья":win?"Вы победили!":"Вы проиграли";
  arcadeEl("arcadeResultMessage").textContent=message;
  arcadeEl("arcadeAnalyzeButton").disabled=arcadeTimeline.length<2;
  overlay.classList.remove("hidden","is-win","is-loss","is-draw");
  overlay.classList.add(win===null?"is-draw":win?"is-win":"is-loss");
  requestAnimationFrame(()=>arcadeEl("arcadeReplayButton").focus());
}
arcadeEl("closeGameMenu").addEventListener("click",closeMenuToClub);
arcadeEl("gameMenuDialog").addEventListener("cancel",event=>{event.preventDefault();closeMenuToClub()});
arcadeEl("arcadeDialog").addEventListener("cancel",event=>{event.preventDefault();backToGameMenu()});
arcadeEl("arcadeBackToMenu").addEventListener("click",backToGameMenu);
arcadeEl("arcadeExit").addEventListener("click",exitArcade);
arcadeEl("arcadeReplayButton").addEventListener("click",()=>{
  const restart=arcadeRestartAction||startChess;hideArcadeResult();restart();
});
arcadeEl("arcadeAnalyzeButton").addEventListener("click",()=>{
  if(arcadeTimeline.length<2)return;
  clearTimeout(arcadeTimer);arcadeTimer=null;
  arcadeOver=false;arcadeAnalysisMode=true;arcadeHistoryReview=true;
  restoreArcadePosition(arcadeTimeline[arcadeTimelineIndex]);
  arcadeAnalysisMode=true;arcadeHistoryReview=true;updateArcadeHistoryControls();
  arcadeEl("arcadeStatus").textContent="Анализ партии";
  const hint=arcadeEl("arcadeHistoryHint");
  hint.textContent="Первый результат сохранён. Вернитесь назад и выберите другое продолжение.";
});
arcadeEl("arcadeResultMenuButton").addEventListener("click",backToGameMenu);
arcadeEl("arcadeHistoryBack").addEventListener("click",()=>stepArcadeHistory(-1));
arcadeEl("arcadeHistoryForward").addEventListener("click",()=>stepArcadeHistory(1));
postChat(arcadeEl("arcadeChatForm"),arcadeEl("arcadeChatInput"),arcadeEl("arcadeChatMessages"),true);
arcadeEl("computerGameButton")?.addEventListener("click",openComputerGameMenu);
document.querySelectorAll("[data-club-game]").forEach(button=>button.addEventListener("click",()=>{
  const mode=button.dataset.clubGame;
  if(mode==="checkers"||mode==="giveaway"){
    if(!computerGameMenu)window.clubOnline?.joinTable(arcadeTableNo,mode);
    arcadeEl("gameMenuDialog").close();startGame(arcadeTableNo,mode);
  }else openArcade(mode);
}));

/* ---------- Corners ---------- */
let cornerBoard,cornerTurn,cornerSelected,cornerChain,cornerLast;
const cornerDirs=[-1,0,1].flatMap(dr=>[-1,0,1].map(dc=>[dr,dc])).filter(([dr,dc])=>dr||dc);
function startCorners(){
  arcadeResultRecorded=false;closeWinStreakPopup();
  cornerBoard=Array.from({length:8},()=>Array(8).fill(null));
  for(let r=0;r<3;r++)for(let c=0;c<3;c++)cornerBoard[r][c]="bot";
  for(let r=5;r<8;r++)for(let c=5;c<8;c++)cornerBoard[r][c]="player";
  const match=onlineHumanMatch("corners");
  cornerTurn=match&&match.players[0].id!==match.me.id?"bot":"player";cornerSelected=null;cornerChain=null;cornerLast=null;arcadeOver=false;
  arcadeEl("arcadePlayerScore").textContent="9";arcadeEl("arcadeBotScore").textContent="9";
  setArcadeRules("Как играть","Переведите все девять фишек в противоположный угол. Можно ходить на соседнюю клетку или перепрыгивать через любую фишку. После прыжка разрешена цепочка прыжков.");
  arcadeEl("arcadeInfo").textContent="Ваша цель — верхний левый угол.";
  startMatchConversation(arcadeEl("arcadeChatMessages"),"corners");
  setArcadeActions([]);renderCorners();resetArcadeTimeline();flushPendingArcadeOnlineActions();
}
function cornerMoves(r,c,jumpsOnly=false,state=cornerBoard){
  const out=[];
  for(const [dr,dc] of cornerDirs){
    const nr=r+dr,nc=c+dc;
    if(!jumpsOnly&&inside(nr,nc)&&!state[nr][nc])out.push({to:[nr,nc],jump:false});
    const jr=r+dr*2,jc=c+dc*2;
    if(inside(jr,jc)&&state[nr]?.[nc]&&!state[jr][jc])out.push({to:[jr,jc],jump:true});
  }
  return out;
}
function renderCorners(){
  const root=arcadeEl("arcadeBoard");root.className="arcade-board grid-board";root.innerHTML="";
  const legal=cornerSelected?cornerMoves(...cornerSelected,Boolean(cornerChain)):[];
  for(let r=0;r<8;r++)for(let c=0;c<8;c++){
    const cell=document.createElement("button");cell.className=`arcade-cell ${(r+c)%2?"dark":"light"}`;
    cell.dataset.r=String(r);cell.dataset.c=String(c);
    if(sameCell([r,c],cornerSelected))cell.classList.add("selected");
    if(sameCell([r,c],cornerLast))cell.classList.add("last");
    if(legal.some(move=>sameCell(move.to,[r,c])))cell.classList.add("legal");
    if(cornerBoard[r][c])cell.innerHTML=`<i class="corner-piece ${cornerBoard[r][c]}"></i>`;
    cell.addEventListener("click",()=>cornerClick(r,c));root.appendChild(cell);
  }
  arcadeEl("arcadeStatus").textContent=cornerTurn==="player"?"Ваш ход":`${opponentName()} думает…`;
  playPendingArcadeMove();
}
function cornerClick(r,c){
  if(arcadeOver||cornerTurn!=="player"||arcadeAnimating)return;
  if(cornerSelected){
    const move=cornerMoves(...cornerSelected,Boolean(cornerChain)).find(item=>sameCell(item.to,[r,c]));
    if(move){beginArcadeHistoryBranch();cornerApply(cornerSelected,move.to);cornerLast=move.to;
      if(move.jump)announceTechnique(cornerChain?"цепочка прыжков":"прыжок через фишку","player","так фишка быстрее проходит к противоположному углу");
      if(move.jump&&cornerMoves(r,c,true).length){cornerSelected=[r,c];cornerChain=true;renderCorners();setArcadeActions([{label:"Завершить цепочку",action:endCornerTurn,primary:true}]);return}
      endCornerTurn();return;
    }
  }
  if(cornerBoard[r][c]==="player"){cornerSelected=[r,c];cornerChain=null;setArcadeActions([])}
  else cornerSelected=null;
  renderCorners();
}
function cornerApply(from,to,state=cornerBoard){
  if(state===cornerBoard){
    const destinationSelector=`.grid-board .arcade-cell[data-r="${to[0]}"][data-c="${to[1]}"] .corner-piece`;
    if(!pendingArcadeMove){
      queueArcadeMove(
        captureArcadeMover(`.grid-board .arcade-cell[data-r="${from[0]}"][data-c="${from[1]}"] .corner-piece`),
        destinationSelector
      );
    }else pendingArcadeMove.destinationSelector=destinationSelector;
  }
  state[to[0]][to[1]]=state[from[0]][from[1]];state[from[0]][from[1]]=null
}
function cornerPositionScore(state){
  let botDistance=0,playerDistance=0;
  for(let r=0;r<8;r++)for(let c=0;c<8;c++){
    if(state[r][c]==="bot")botDistance+=14-r-c;
    else if(state[r][c]==="player")playerDistance+=r+c;
  }
  return playerDistance-botDistance;
}
function cornerAdvancedScore(candidate,level){
  const after=cornerBoard.map(row=>[...row]);cornerApply(candidate.from,candidate.to,after);
  let score=candidate.score+cornerPositionScore(after)*2;
  if(!["B2","V1","V2"].includes(level))return score;
  const replies=[];
  for(let r=0;r<8;r++)for(let c=0;c<8;c++)if(after[r][c]==="player"){
    for(const reply of cornerMoves(r,c,false,after)){
      const replyState=after.map(row=>[...row]);cornerApply([r,c],reply.to,replyState);
      if(level!=="V2"){replies.push(cornerPositionScore(replyState));continue}
      let bestNext=-Infinity;
      for(let br=0;br<8;br++)for(let bc=0;bc<8;bc++)if(replyState[br][bc]==="bot"){
        for(const next of cornerMoves(br,bc,false,replyState)){
          const nextState=replyState.map(row=>[...row]);cornerApply([br,bc],next.to,nextState);
          bestNext=Math.max(bestNext,cornerPositionScore(nextState)+(next.jump?8:0));
        }
      }
      replies.push(Number.isFinite(bestNext)?bestNext:cornerPositionScore(replyState));
    }
  }
  return score+(replies.length?Math.min(...replies)*3:500);
}
function cornerWon(color,state=cornerBoard){
  const start=color==="player"?0:5;
  for(let r=start;r<start+3;r++)for(let c=start;c<start+3;c++)if(state[r][c]!==color)return false;
  return true;
}
function endCornerTurn(){
  setArcadeActions([]);cornerSelected=null;cornerChain=null;
  if(onlineHumanMatch("corners"))sendOnlineGameAction({kind:"corners_state",board:cloneArcadeState(cornerBoard)});
  if(cornerWon("player")){renderCorners();pushArcadePosition();finishArcade(true,"Все ваши фишки заняли лагерь соперника.",startCorners);return}
  cornerTurn="bot";renderCorners();pushArcadePosition();
  if(!onlineHumanMatch("corners"))arcadeTimer=setTimeout(cornerBotMove,380);
}
function cornerBotMove(){
  if(arcadeOver)return;
  if(arcadeAnimating){arcadeTimer=setTimeout(cornerBotMove,120);return}
  const level=opponentLevelForMode("corners");
  const candidates=[];
  for(let r=0;r<8;r++)for(let c=0;c<8;c++)if(cornerBoard[r][c]==="bot"){
    for(const move of cornerMoves(r,c)) {
      const progress=(move.to[0]+move.to[1])-(r+c);
      candidates.push({from:[r,c],...move,score:progress*8+(move.jump?18:0)+Math.random()*(level==="A2"?18:5)});
    }
  }
  let move;
  if(level==="A1")move=candidates[Math.floor(Math.random()*candidates.length)];
  else if(level==="A2"){candidates.sort((a,b)=>b.score-a.score);move=candidates[Math.floor(Math.random()*Math.max(1,Math.ceil(candidates.length*.55)))]}
  else{candidates.forEach(candidate=>candidate.advanced=cornerAdvancedScore(candidate,level));candidates.sort((a,b)=>b.advanced-a.advanced);move=candidates[0]}
  if(!move){finishArcade(true,"У соперника нет допустимых ходов.",startCorners);return}
  cornerApply(move.from,move.to);cornerLast=move.to;
  if(move.jump)announceTechnique("цепочка прыжков","opponent","так я быстрее освобожу путь к вашему углу");
  if(move.jump){
    const maxSteps={A1:0,A2:1,B1:2,B2:4,V1:12,V2:12}[level];
    let at=move.to,next,steps=0;const visited=new Set([move.from.join(","),at.join(",")]);
    while(steps++<maxSteps&&(next=cornerMoves(at[0],at[1],true).filter(item=>!visited.has(item.to.join(","))).sort((a,b)=>(b.to[0]+b.to[1])-(a.to[0]+a.to[1]))[0])){
      cornerApply(at,next.to);at=next.to;cornerLast=at;
      visited.add(at.join(","));
      if(!["V1","V2"].includes(level)&&Math.random()<.32)break;
    }
  }
  if(cornerWon("bot")){renderCorners();pushArcadePosition();finishArcade(false,`${opponentName()} первым занял ваш угол.`,startCorners);return}
  cornerTurn="player";renderCorners();pushArcadePosition();
}

/* ---------- Chess ---------- */
let chessBoard,chessTurn,chessSelected,chessLastMove,chessHistory,chessHalfmove,chessPlayerColor="white",chessBotColor="black";
const pendingArcadeOnlineActions=[];
const chessSymbols={white:{k:"♔",q:"♕",r:"♖",b:"♗",n:"♘",p:"♙"},black:{k:"♚",q:"♛",r:"♜",b:"♝",n:"♞",p:"♟"}};
function startChess(){
  arcadeResultRecorded=false;closeWinStreakPopup();
  hideArcadeResult();cancelCoinToss();clearTimeout(arcadeTimer);arcadeOver=true;
  document.querySelector(".arcade-shell")?.classList.add("arcade-pending-toss");
  arcadeEl("arcadeInfo").textContent="Сначала разыграем цвет фигур и первый ход.";
  startMatchConversation(arcadeEl("arcadeChatMessages"),"chess","Сначала разыграем цвет фигур.");
  setArcadeActions([]);
  const match=onlineHumanMatch("chess");
  runCoinToss("Шахматы",({color})=>initializeChess(color),"color",match?match.coinResult:null,match?{color:match.me.color}:null);
}
function initializeChess(color){
  chessPlayerColor=color;chessBotColor=color==="white"?"black":"white";
  const back=["r","n","b","q","k","b","n","r"];
  chessBoard=Array.from({length:8},()=>Array(8).fill(null));
  for(let c=0;c<8;c++){chessBoard[0][c]={type:back[c],color:"black",moved:false};chessBoard[1][c]={type:"p",color:"black",moved:false};chessBoard[6][c]={type:"p",color:"white",moved:false};chessBoard[7][c]={type:back[c],color:"white",moved:false}}
  chessTurn="white";chessSelected=null;chessLastMove=null;chessHalfmove=0;chessHistory=[];arcadeOver=false;
  chessHistory.push(chessHash(chessBoard,chessTurn));
  arcadeEl("arcadePlayerScore").textContent="16";arcadeEl("arcadeBotScore").textContent="16";
  setArcadeRules("Полные шахматы","Мат королю завершает игру. Доступны рокировка, взятие на проходе и автоматическое превращение пешки в ферзя. Пат считается ничьёй.");
  arcadeEl("arcadeInfo").textContent=color==="white"?"Решка: вы играете белыми и ходите первой.":`Орёл: вы играете чёрными. ${opponentName()} начинает белыми.`;
  document.querySelector(".arcade-shell")?.classList.remove("arcade-pending-toss");
  setArcadeActions([]);renderChess();resetArcadeTimeline();
  flushPendingArcadeOnlineActions();
  if(chessTurn===chessBotColor&&!onlineHumanMatch("chess"))arcadeTimer=setTimeout(chessBotMove,520);
}
function cloneChess(state){return state.map(row=>row.map(piece=>piece?{...piece}:null))}
function chessHash(state,color){
  const pieces=state.flat().map(piece=>piece
    ? `${piece.color[0]}${piece.type}${["k","r","p"].includes(piece.type)&&piece.moved?1:0}`
    : "___"
  ).join("");
  const enPassant=chessLastMove?.double?chessLastMove.to.join(","):"-";
  return `${pieces}:${color}:${enPassant}`;
}
function chessInside(r,c){return r>=0&&r<8&&c>=0&&c<8}
function chessPseudo(r,c,state=chessBoard,attacksOnly=false){
  const piece=state[r][c];if(!piece)return[];const out=[],enemy=piece.color==="white"?"black":"white";
  const add=(nr,nc,extra={})=>{if(!chessInside(nr,nc))return false;const target=state[nr][nc];if(!target){out.push({from:[r,c],to:[nr,nc],...extra});return true}if(target.color===enemy)out.push({from:[r,c],to:[nr,nc],capture:true,...extra});return false};
  if(piece.type==="p"){
    const d=piece.color==="white"?-1:1;
    if(attacksOnly){for(const dc of[-1,1])if(chessInside(r+d,c+dc))out.push({from:[r,c],to:[r+d,c+dc]});return out}
    if(chessInside(r+d,c)&&!state[r+d][c]){add(r+d,c,{promotion:r+d===0||r+d===7});if(!piece.moved&&!state[r+d*2][c])add(r+d*2,c,{double:true})}
    for(const dc of[-1,1]){
      if(state[r+d]?.[c+dc]?.color===enemy)add(r+d,c+dc,{capture:true,promotion:r+d===0||r+d===7});
      if(chessLastMove?.double&&chessLastMove.piece==="p"&&chessLastMove.color===enemy&&sameCell(chessLastMove.to,[r,c+dc]))out.push({from:[r,c],to:[r+d,c+dc],enPassant:[r,c+dc]});
    }return out;
  }
  if(piece.type==="n"){for(const [dr,dc] of[[2,1],[2,-1],[-2,1],[-2,-1],[1,2],[1,-2],[-1,2],[-1,-2]])add(r+dr,c+dc);return out}
  if(piece.type==="k"){
    for(const [dr,dc] of cornerDirs)add(r+dr,c+dc);
    if(!attacksOnly&&!piece.moved&&!chessInCheck(piece.color,state)){
      for(const side of[-1,1]){const rookC=side<0?0:7,rook=state[r][rookC],through=side<0?[c-1,c-2,c-3]:[c+1,c+2];
        if(rook?.type==="r"&&rook.color===piece.color&&!rook.moved&&through.every(col=>!state[r][col])&&!chessSquareAttacked(r,c+side,enemy,state)&&!chessSquareAttacked(r,c+side*2,enemy,state))out.push({from:[r,c],to:[r,c+side*2],castle:side});
      }
    }return out;
  }
  const dirs=piece.type==="b"?[[-1,-1],[-1,1],[1,-1],[1,1]]:piece.type==="r"?[[-1,0],[1,0],[0,-1],[0,1]]:[[-1,-1],[-1,1],[1,-1],[1,1],[-1,0],[1,0],[0,-1],[0,1]];
  for(const[dr,dc]of dirs){let nr=r+dr,nc=c+dc;while(chessInside(nr,nc)){if(!add(nr,nc))break;nr+=dr;nc+=dc}}return out;
}
function chessSquareAttacked(r,c,byColor,state){
  for(let rr=0;rr<8;rr++)for(let cc=0;cc<8;cc++)if(state[rr][cc]?.color===byColor&&chessPseudo(rr,cc,state,true).some(move=>sameCell(move.to,[r,c])))return true;
  return false;
}
function chessInCheck(color,state){
  let king=null;for(let r=0;r<8;r++)for(let c=0;c<8;c++)if(state[r][c]?.color===color&&state[r][c].type==="k")king=[r,c];
  return !king||chessSquareAttacked(king[0],king[1],color==="white"?"black":"white",state);
}
function chessApply(move,state=chessBoard){
  const next=cloneChess(state),piece=next[move.from[0]][move.from[1]];next[move.from[0]][move.from[1]]=null;
  if(move.enPassant)next[move.enPassant[0]][move.enPassant[1]]=null;
  next[move.to[0]][move.to[1]]=piece;piece.moved=true;if(move.promotion)piece.type=move.promoteTo||"q";
  if(move.castle){const rookFrom=move.castle<0?0:7,rookTo=move.to[1]-move.castle;next[move.to[0]][rookTo]=next[move.to[0]][rookFrom];next[move.to[0]][rookFrom]=null;next[move.to[0]][rookTo].moved=true}
  return next;
}
function chessLegal(color,state=chessBoard){
  const out=[];for(let r=0;r<8;r++)for(let c=0;c<8;c++)if(state[r][c]?.color===color)for(const move of chessPseudo(r,c,state))if(!chessInCheck(color,chessApply(move,state)))out.push(move);return out;
}
function renderChess(){
  const root=arcadeEl("arcadeBoard");root.className="arcade-board chess-board-frame";root.innerHTML="";
  const makeAxis=(className,values)=>{
    const axis=document.createElement("div");axis.className=`chess-axis ${className}`;
    values.forEach(value=>{const label=document.createElement("span");label.textContent=value;axis.appendChild(label)});
    return axis;
  };
  const files=chessPlayerColor==="white"?["A","B","C","D","E","F","G","H"]:["H","G","F","E","D","C","B","A"];
  const ranks=chessPlayerColor==="white"?["8","7","6","5","4","3","2","1"]:["1","2","3","4","5","6","7","8"];
  const grid=document.createElement("div");grid.className="chess-grid";
  const legal=chessSelected?chessLegal(chessPlayerColor).filter(move=>sameCell(move.from,chessSelected)):[];
  for(let vr=0;vr<8;vr++)for(let vc=0;vc<8;vc++){
    const r=chessPlayerColor==="white"?vr:7-vr,c=chessPlayerColor==="white"?vc:7-vc;
    const cell=document.createElement("button");cell.className=`arcade-cell ${(r+c)%2?"dark":"light"}`;
    cell.dataset.r=String(r);cell.dataset.c=String(c);
    if(sameCell([r,c],chessSelected))cell.classList.add("selected");if(chessLastMove&&(sameCell([r,c],chessLastMove.from)||sameCell([r,c],chessLastMove.to)))cell.classList.add("last");
    if(legal.some(move=>sameCell(move.to,[r,c])))cell.classList.add("legal");
    const piece=chessBoard[r][c];if(piece)cell.innerHTML=`<span class="chess-piece ${piece.color}">${chessSymbols[piece.color][piece.type]}</span>`;
    cell.setAttribute("aria-label",`${files[vc]}${ranks[vr]}${piece?`, ${piece.color==="white"?"белая":"чёрная"} фигура`:""}`);
    cell.addEventListener("click",()=>chessClick(r,c));grid.appendChild(cell);
  }
  root.append(
    makeAxis("chess-files-top",files),
    makeAxis("chess-ranks-left",ranks),
    grid,
    makeAxis("chess-ranks-right",ranks),
    makeAxis("chess-files-bottom",files)
  );
  const counts=chessBoard.flat().reduce((a,p)=>{if(p)a[p.color]++;return a},{white:0,black:0});arcadeEl("arcadePlayerScore").textContent=counts[chessPlayerColor];arcadeEl("arcadeBotScore").textContent=counts[chessBotColor];
  arcadeEl("arcadeStatus").textContent=chessTurn===chessPlayerColor?(chessInCheck(chessPlayerColor,chessBoard)?"Шах! Ваш ход":"Ваш ход"):`${opponentName()} думает…`;
  playPendingArcadeMove();
}
function chessClick(r,c){
  if(arcadeOver||chessTurn!==chessPlayerColor||arcadeAnimating)return;const legal=chessLegal(chessPlayerColor);
  if(chessSelected){const move=legal.find(item=>sameCell(item.from,chessSelected)&&sameCell(item.to,[r,c]));if(move){
    if(move.promotion){
      arcadeEl("arcadeStatus").textContent="Выберите фигуру для превращения";
      setArcadeActions([["q","Ферзь"],["r","Ладья"],["b","Слон"],["n","Конь"]].map(([type,label])=>({
        label,primary:type==="q",action:()=>{setArcadeActions([]);playChessMove({...move,promoteTo:type})}
      })));return;
    }
    playChessMove(move);return;
  }}
  chessSelected=chessBoard[r][c]?.color===chessPlayerColor?[r,c]:null;renderChess();
}
function playChessMove(move,source="local"){
  beginArcadeHistoryBranch();
  const piece=chessBoard[move.from[0]][move.from[1]],isCapture=Boolean(chessBoard[move.to[0]][move.to[1]]||move.enPassant);
  queueArcadeMove(
    captureArcadeMover(`.chess-grid .arcade-cell[data-r="${move.from[0]}"][data-c="${move.from[1]}"] .chess-piece`),
    `.chess-grid .arcade-cell[data-r="${move.to[0]}"][data-c="${move.to[1]}"] .chess-piece`
  );
  if(source==="local"&&piece.color===chessPlayerColor&&onlineHumanMatch("chess")){
    sendOnlineGameAction({kind:"chess_move",move:cloneArcadeState(move)});
  }
  chessBoard=chessApply(move);chessLastMove={...move,piece:piece.type,color:piece.color};chessSelected=null;chessTurn=piece.color==="white"?"black":"white";
  const attackedPieces=chessPseudo(move.to[0],move.to[1],chessBoard,true)
    .filter(candidate=>chessBoard[candidate.to[0]]?.[candidate.to[1]]?.color===chessTurn).length;
  let technique="",reason="";
  if(move.castle){technique="рокировка";reason="король получает укрытие, а ладья быстрее входит в игру";}
  else if(move.promotion){technique="превращение пешки";reason="новый ферзь резко усиливает атаку";}
  else if(attackedPieces>=2){technique="Вилка";reason="одна фигура одновременно атакует две цели";}
  else if(chessInCheck(chessTurn,chessBoard)){technique="шах";reason="королю приходится немедленно отвечать на угрозу";}
  else if(move.enPassant){technique="взятие на проходе";reason="используется особое право немедленного взятия пешки";}
  if(technique)announceTechnique(technique,piece.color===chessPlayerColor?"player":"opponent",reason);
  chessHalfmove=piece.type==="p"||isCapture?0:chessHalfmove+1;chessHistory.push(chessHash(chessBoard,chessTurn));renderChess();pushArcadePosition();
  if(chessEnd())return;if(chessTurn===chessBotColor&&!onlineHumanMatch("chess"))arcadeTimer=setTimeout(chessBotMove,420);
}
function chessValue(state){const values={p:100,n:320,b:330,r:500,q:900,k:20000};return state.flat().reduce((sum,p)=>sum+(p?(p.color===chessBotColor?1:-1)*values[p.type]:0),0)}
function chessBotMove(){
  if(arcadeOver||chessTurn!==chessBotColor)return;
  if(arcadeAnimating){arcadeTimer=setTimeout(chessBotMove,120);return}
  const moves=chessLegal(chessBotColor),level=opponentLevelForMode("chess");let best=null,bestScore=-Infinity;
  if(level==="A1")best=moves[Math.floor(Math.random()*moves.length)];
  for(const move of level==="A1"?[]:moves){
    const movingPiece=chessBoard[move.from[0]][move.from[1]],captured=chessBoard[move.to[0]][move.to[1]],after=chessApply(move,chessBoard),savedLast=chessLastMove;
    const tactical=(captured?{p:100,n:320,b:330,r:500,q:900,k:0}[captured.type]:0)+(move.promotion?760:0)+(move.castle?45:0)+(chessInCheck(chessPlayerColor,after)?35:0);
    let score=level==="A2"?tactical+Math.random()*120:chessValue(after)+tactical*.18+Math.random()*(level==="B1"?18:4);
    if(["B2","V1","V2"].includes(level)){
      chessLastMove={...move,piece:movingPiece.type,color:chessBotColor};
      const responseLimit=level==="B2"?8:level==="V1"?18:16;
      const responses=chessLegal(chessPlayerColor,after).slice(0,responseLimit);
      if(!responses.length)score=chessInCheck(chessPlayerColor,after)?99999:0;
      else if(level!=="V2")score=Math.min(...responses.map(reply=>chessValue(chessApply(reply,after))))+tactical*.2;
      else{
        const replyScores=responses.map(reply=>{
          const replyPiece=after[reply.from[0]][reply.from[1]],replyAfter=chessApply(reply,after);
          chessLastMove={...reply,piece:replyPiece.type,color:chessPlayerColor};
          const continuations=chessLegal(chessBotColor,replyAfter).slice(0,18);
          if(!continuations.length)return chessInCheck(chessBotColor,replyAfter)?-99999:0;
          return Math.max(...continuations.map(next=>chessValue(chessApply(next,replyAfter))));
        });
        score=Math.min(...replyScores)+tactical*.25;
      }
    }
    chessLastMove=savedLast;
    if(score>bestScore){bestScore=score;best=move}
  }
  if(best)playChessMove(best);else chessEnd();
}
function applyOnlineChessAction(action){
  if(!action||action.kind!=="chess_move"||!onlineHumanMatch("chess"))return;
  if(arcadeMode!=="chess"||arcadeOver){
    pendingArcadeOnlineActions.push({game:"chess",action});
    return;
  }
  const incoming=action.move;
  const move=chessLegal(chessBotColor).find(candidate=>
    sameCell(candidate.from,incoming?.from)&&sameCell(candidate.to,incoming?.to)
  );
  if(move)playChessMove({...move,promoteTo:incoming.promoteTo},"remote");
}
function applyOnlineCornersAction(action){
  if(!action||action.kind!=="corners_state"||!onlineHumanMatch("corners"))return;
  if(arcadeMode!=="corners"||arcadeOver){
    pendingArcadeOnlineActions.push({game:"corners",action});
    return;
  }
  const source=action.board;
  if(!Array.isArray(source)||source.length!==8)return;
  const nextBoard=Array.from({length:8},(_,r)=>Array.from({length:8},(_,c)=>{
    const value=source[7-r]?.[7-c];
    return value==="player"?"bot":value==="bot"?"player":null;
  }));
  const movedFrom=[],movedTo=[];
  for(let r=0;r<8;r++)for(let c=0;c<8;c++){
    if(cornerBoard[r][c]==="bot"&&nextBoard[r][c]!=="bot")movedFrom.push([r,c]);
    if(cornerBoard[r][c]!=="bot"&&nextBoard[r][c]==="bot")movedTo.push([r,c]);
  }
  const remoteFrom=movedFrom[0],remoteTo=movedTo.at(-1);
  if(remoteFrom&&remoteTo)queueArcadeMove(
    captureArcadeMover(`.grid-board .arcade-cell[data-r="${remoteFrom[0]}"][data-c="${remoteFrom[1]}"] .corner-piece`),
    `.grid-board .arcade-cell[data-r="${remoteTo[0]}"][data-c="${remoteTo[1]}"] .corner-piece`
  );
  cornerBoard=nextBoard;
  cornerSelected=null;cornerChain=null;cornerLast=remoteTo||null;
  if(cornerWon("bot")){
    renderCorners();pushArcadePosition();
    finishArcade(false,`${opponentName()} первым занял ваш угол.`,startCorners);
    return;
  }
  cornerTurn="player";renderCorners();pushArcadePosition();
}
function applyOnlineDominoAction(game,action){
  if(!action||action.kind!=="domino_state"||!onlineHumanMatch(game))return;
  if(arcadeMode!==game||arcadeOver){
    pendingArcadeOnlineActions.push({game,action});
    return;
  }
  const placedTiles=state=>[
    ...(state?.chain||[]),
    ...(state?.home?.top||[]),
    ...(state?.home?.bottom||[])
  ];
  const oldIds=new Set(placedTiles(domino).map(tile=>Number(tile?._dominoId)).filter(Boolean));
  const nextDomino=restoreOnlineDominoSnapshot(action.state||{});
  const addedTile=placedTiles(nextDomino).find(tile=>tile?._dominoId&&!oldIds.has(Number(tile._dominoId)));
  if(addedTile)queueArcadeMove(
    captureArcadeMover(".domino-bot-rack .domino-tile"),
    `.domino-chain .domino-tile[data-domino-id="${addedTile._dominoId}"]`
  );
  domino=nextDomino;
  renderDomino();pushArcadePosition();
  if(domino.bot.length===0){
    dominoRoundEnd("bot");
    return;
  }
  if(domino.fives&&domino.score.bot>=100){
    finishFivesMatch("bot",`${opponentName()} первым набрал 100 очков.`);
  }
}
function receiveOnlineArcadeAction(game,action){
  if(game==="chess")applyOnlineChessAction(action);
  else if(game==="corners")applyOnlineCornersAction(action);
  else if(["domino","fives"].includes(game))applyOnlineDominoAction(game,action);
}
function flushPendingArcadeOnlineActions(){
  const queued=pendingArcadeOnlineActions.splice(0);
  queued.forEach(item=>receiveOnlineArcadeAction(item.game,item.action));
}
window.receiveOnlineArcadeAction=receiveOnlineArcadeAction;
function chessEnd(){
  const currentHash=chessHash(chessBoard,chessTurn);
  if(chessHistory.filter(item=>item===currentHash).length>=3){
    finishArcade(null,"Ничья зафиксирована, потому что одна и та же позиция возникла на доске три раза.",startChess);
    return true;
  }
  if(chessHalfmove>=100){
    finishArcade(null,"Ничья по правилу пятидесяти ходов: за 50 ходов каждой стороны не было ни взятия, ни движения пешки.",startChess);
    return true;
  }
  const pieces=chessBoard.flat().filter(Boolean),nonKings=pieces.filter(piece=>piece.type!=="k");
  if(!nonKings.length||(
    nonKings.length===1&&["b","n"].includes(nonKings[0].type)
  )){
    finishArcade(null,"Ничья из-за недостатка материала: оставшихся фигур недостаточно, чтобы поставить мат.",startChess);
    return true;
  }
  if(nonKings.length===2&&nonKings.every(piece=>piece.type==="b")){
    const bishopColors=[];for(let r=0;r<8;r++)for(let c=0;c<8;c++)if(chessBoard[r][c]?.type==="b")bishopColors.push((r+c)%2);
    if(bishopColors[0]===bishopColors[1]){
      finishArcade(null,"Ничья из-за недостатка материала: слоны ходят по полям одного цвета, поэтому мат поставить невозможно.",startChess);
      return true;
    }
  }
  const moves=chessLegal(chessTurn);if(moves.length)return false;
  const checked=chessInCheck(chessTurn,chessBoard);
  if(!checked){
    const sideWithoutMoves=chessTurn===chessPlayerColor?"у вас":"у Старого Мастера";
    finishArcade(null,`Ничья из-за пата: ${sideWithoutMoves} нет допустимых ходов, но король не находится под шахом.`,startChess);
  }else{
    const playerWon=chessTurn===chessBotColor;
    finishArcade(
      playerWon,
      playerWon
        ?"Вы победили матом: король Старого Мастера находится под шахом и не имеет ни одного допустимого спасения."
        :"Вы проиграли матом: ваш король находится под шахом и не имеет ни одного допустимого спасения.",
      startChess
    );
  }
  return true;
}

/* ---------- Domino and All Fives ---------- */
let domino;
function dominoSet(){const tiles=[];for(let a=0;a<=6;a++)for(let b=a;b<=6;b++)tiles.push([a,b]);return tiles}
function onlineSeededRandom(match){
  let state=Number(BigInt(match.seed||"1")%2147483647n)||1;
  return()=>{state=state*16807%2147483647;return(state-1)/2147483646};
}
function shuffle(items,random=Math.random){const out=[...items];for(let i=out.length-1;i;i--){const j=Math.floor(random()*(i+1));[out[i],out[j]]=[out[j],out[i]]}return out}
function roundToFive(points){return Math.round(points/5)*5}
function awardFives(who,points){
  if(!points||points%5)return;
  domino.score[who]+=points;
  domino.fiveCounts[who]+=points/5;
  domino.lastScore={who,points};
}
function fivesScoreText(who){return `${domino.score[who]} очк. · ${domino.fiveCounts[who]}×5`}
function finishFivesMatch(winner,reason){
  renderDomino();
  finishArcade(
    winner==="player",
    `${reason} Итоговый счёт: ${domino.score.player}:${domino.score.bot}.`,
    ()=>startDomino(true)
  );
}
function startDomino(fives=false,keepScore=false,forcedStarter=null){
  if(!keepScore){arcadeResultRecorded=false;closeWinStreakPopup()}
  const score=keepScore&&domino?domino.score:{player:0,bot:0};
  const fiveCounts=keepScore&&domino?domino.fiveCounts:{player:0,bot:0};
  const eggs=keepScore&&domino&&!fives?domino.eggs:0;
  const match=onlineHumanMatch(fives?"fives":"domino");
  const pile=shuffle(dominoSet(),match?onlineSeededRandom(match):Math.random);
  const firstHand=pile.splice(0,7),secondHand=pile.splice(0,7);
  const firstPlayerIsLocal=!match||match.players[0].id===match.me.id;
  domino={fives,player:firstPlayerIsLocal?firstHand:secondHand,bot:firstPlayerIsLocal?secondHand:firstHand,stock:pile,chain:[],turn:fives?"waiting":"player",passes:0,score,fiveCounts,eggs,pending:null,lastScore:null,revealHands:false,home:null,tileSeq:0};
  if(!keepScore)startMatchConversation(arcadeEl("arcadeChatMessages"),fives?"fives":"domino",fives?"Сначала разыграем право первого хода.":"Партия начинается.");
  arcadeOver=fives;
  setArcadeRules(
    fives?"Правила «Пятёрочек»":"Домино «Козёл»",
    fives
      ?"Цель — первым набрать 100 очков. Первый ход определяется жеребьёвкой, начать можно любой костью. Первый выставленный дубль становится «домом» и открывает четыре линии: влево, вправо, вверх и вниз. После каждого хода складываются все открытые концы; сумма, кратная пяти, сразу приносит очки. Если хода нет, берите кости из базара."
      :"Ставьте кости с одинаковыми значениями к краям цепочки. Проигравший кон записывает точки, только если остаток не меньше 13. Недобор или равная «рыба» создают «яйцо»: следующий записываемый штраф умножается. Цель — не набрать 101 очко. Одинокий 0:0 даёт 25, одинокий 6:6 — 50, а оставшиеся вдвоём 0:0 и 6:6 — 75."
  );
  if(fives){
    hideArcadeResult();cancelCoinToss();clearTimeout(arcadeTimer);
    document.querySelector(".arcade-shell")?.classList.add("arcade-pending-toss");
    setArcadeActions([]);renderDomino();
    runCoinToss("Домино «Пятёрочки»",({starter})=>{
      domino.turn=starter;arcadeOver=false;
      document.querySelector(".arcade-shell")?.classList.remove("arcade-pending-toss");
      renderDomino();resetArcadeTimeline();
      flushPendingArcadeOnlineActions();
      if(domino.turn==="bot"&&!match)arcadeTimer=setTimeout(dominoBot,430);
    },"firstMove",match?match.coinResult:null,match?{starter:match.starterId===match.me.id?"player":"bot"}:null);
    return;
  }
  const starts=[],eligible=forcedStarter?[forcedStarter]:["player","bot"];
  for(const who of eligible)domino[who].forEach((tile,index)=>{if(tile[0]===tile[1])starts.push({who,index,value:tile[0]*10+tile[1]})});
  if(!starts.length)for(const who of eligible)domino[who].forEach((tile,index)=>starts.push({who,index,value:tile[0]+tile[1]}));
  starts.sort((a,b)=>b.value-a.value);const opener=starts[0],openingTile=domino[opener.who].splice(opener.index,1)[0];
  domino.chain.push(openingTile);
  domino.turn=opener.who==="player"?"bot":"player";
  arcadeOver=false;
  setArcadeActions([]);renderDomino();resetArcadeTimeline();flushPendingArcadeOnlineActions();if(domino.turn==="bot"&&!match)arcadeTimer=setTimeout(dominoBot,430);
}
function dominoSides(tile){
  if(!domino.chain.length)return["right"];const left=domino.chain[0][0],right=domino.chain.at(-1)[1],sides=[],homePriority=[];
  if(domino.fives&&domino.home){
    for(const side of["top","bottom"]){
      const branch=domino.home[side];
      if(!branch.length&&(tile[0]===domino.home.value||tile[1]===domino.home.value))homePriority.push(side);
    }
  }
  if(tile[0]===left||tile[1]===left)sides.push("left");
  if(tile[0]===right||tile[1]===right)sides.push("right");
  if(domino.fives&&domino.home){
    for(const side of["top","bottom"]){
      const branch=domino.home[side],edge=branch.length?branch.at(-1)[1]:domino.home.value;
      if(branch.length&&(tile[0]===edge||tile[1]===edge))sides.push(side);
    }
  }
  return[...homePriority,...sides];
}
function isDirectHomeSide(side){return Boolean(domino.fives&&domino.home&&["top","bottom"].includes(side)&&!domino.home[side].length)}
function dominoTileNode(tile,classes=""){
  const pipMap={0:[],1:[5],2:[1,9],3:[1,5,9],4:[1,3,7,9],5:[1,3,5,7,9],6:[1,3,4,6,7,9]};
  const half=value=>`<span class="domino-half" data-value="${value}">${Array.from({length:9},(_,index)=>`<i class="${pipMap[value].includes(index+1)?"pip-on":""}"></i>`).join("")}</span>`;
  const el=document.createElement("button");el.type="button";el.className=`domino-tile ${classes}`;el.innerHTML=half(tile[0])+half(tile[1]);
  if(tile._dominoId)el.dataset.dominoId=String(tile._dominoId);
  el.setAttribute("aria-label",classes.includes("hidden-tile")?"Закрытая кость":`Кость ${tile[0]}–${tile[1]}`);
  if(classes.includes("chain-tile")||classes.includes("hidden-tile"))el.tabIndex=-1;
  return el;
}
function dominoRectangularPath(size){
  const path=[];let top=0,left=0,bottom=size-1,right=size-1;
  while(top<=bottom&&left<=right){
    for(let column=left;column<=right;column++)path.push([top,column]);
    top++;
    for(let row=top;row<=bottom;row++)path.push([row,right]);
    right--;
    if(top<=bottom){for(let column=right;column>=left;column--)path.push([bottom,column]);bottom--}
    if(left<=right){for(let row=bottom;row>=top;row--)path.push([row,left]);left++}
  }
  return path;
}
function dominoCrossArmPath(size,side){
  const center=Math.floor(size/2),path=[];
  if(side==="right"){
    for(let row=center,step=0;row>=0;row--,step++){
      const columns=Array.from({length:size-center-1},(_,index)=>center+1+index);
      if(step%2)columns.reverse();
      columns.forEach(column=>path.push([row,column]));
    }
  }else if(side==="top"){
    for(let column=center,step=0;column>=0;column--,step++){
      const rows=Array.from({length:center},(_,index)=>center-1-index);
      if(step%2)rows.reverse();
      rows.forEach(row=>path.push([row,column]));
    }
  }else if(side==="left"){
    for(let row=center,step=0;row<size;row++,step++){
      const columns=Array.from({length:center},(_,index)=>center-1-index);
      if(step%2)columns.reverse();
      columns.forEach(column=>path.push([row,column]));
    }
  }else{
    for(let column=center,step=0;column<size;column++,step++){
      const rows=Array.from({length:size-center-1},(_,index)=>center+1+index);
      if(step%2)rows.reverse();
      rows.forEach(row=>path.push([row,column]));
    }
  }
  return path;
}
function appendCrossDomino(root,tile,row,column,previous,extraClass=""){
  const dr=row-previous[0],dc=column-previous[1],pathIsVertical=dr!==0,isDouble=tile[0]===tile[1];
  const standsVertical=isDouble?!pathIsVertical:pathIsVertical;
  const reverse=dc<0||dr<0,displayTile=reverse?[tile[1],tile[0]]:tile;
  const node=dominoTileNode(displayTile,`chain-tile${isDouble?" domino-double":""}${standsVertical?" chain-vertical":""}${extraClass?" "+extraClass:""}`);
  node.style.gridRow=String(row+1);node.style.gridColumn=String(column+1);root.appendChild(node);
}
function renderDominoHomeCross(chain){
  const homeIndex=domino.chain.findIndex(tile=>tile._dominoId===domino.home.tileId);
  const arms={
    left:domino.chain.slice(0,homeIndex).reverse(),
    right:domino.chain.slice(homeIndex+1),
    top:domino.home.top,
    bottom:domino.home.bottom
  };
  const longestArm=Math.max(...Object.values(arms).map(arm=>arm.length)),size=longestArm<=12?7:longestArm<=20?9:11,center=Math.floor(size/2);
  chain.classList.add("home-layout");chain.style.setProperty("--domino-grid-size",String(size));
  const homeTile=domino.chain[homeIndex],homeNode=dominoTileNode(homeTile,"chain-tile domino-double chain-vertical domino-home");
  homeNode.style.gridRow=String(center+1);homeNode.style.gridColumn=String(center+1);chain.appendChild(homeNode);
  for(const side of["left","right","top","bottom"]){
    const path=dominoCrossArmPath(size,side);
    arms[side].forEach((tile,index)=>{
      const [row,column]=path[index],previous=index?path[index-1]:[center,center];
      appendCrossDomino(chain,tile,row,column,previous,`home-arm home-arm-${side}`);
    });
  }
}
function renderDomino(){
  const root=arcadeEl("arcadeBoard");root.className="arcade-board domino-table";root.innerHTML="";
  const playerZone=document.createElement("section");playerZone.className="domino-player-zone";
  const handLabel=document.createElement("div");handLabel.className="domino-label";handLabel.innerHTML=`Ваши кости <b>${domino.player.length}</b>`;
  const hand=document.createElement("div");hand.className="domino-hand domino-player-hand";
  domino.player.forEach((tile,index)=>{
    const sides=dominoSides(tile),playable=sides.length,homePriority=sides.some(isDirectHomeSide);
    const el=dominoTileNode(tile,`${playable?"playable":""}${homePriority?" home-priority":""}`.trim());
    el.dataset.handIndex=String(index);
    if(homePriority)el.title="Эту кость можно приоритетно поставить в «Дом»";
    el.disabled=domino.turn!=="player"||!playable;el.addEventListener("click",()=>dominoChoose(index));hand.appendChild(el);
  });
  playerZone.append(handLabel,hand);

  const playZone=document.createElement("section");playZone.className="domino-play-zone";
  const botLabel=document.createElement("div");botLabel.className="domino-label";botLabel.innerHTML=`${escapeHtml(opponentName())} <b>${domino.bot.length}</b>`;
  const botRack=document.createElement("div");botRack.className="domino-bot-rack";
  if(domino.revealHands){
    domino.bot.forEach(tile=>{const revealed=dominoTileNode(tile,"revealed-tile");revealed.disabled=true;botRack.appendChild(revealed)});
  }else{
    Array.from({length:Math.min(4,domino.bot.length)},()=>botRack.appendChild(dominoTileNode([0,0],"hidden-tile")));
  }
  const chain=document.createElement("div");chain.className="domino-chain";
  if(domino.fives&&domino.home)renderDominoHomeCross(chain);
  else{
    const gridSize=window.matchMedia("(max-width:520px)").matches?6:7;
    const path=dominoRectangularPath(gridSize);
    chain.style.setProperty("--domino-grid-size",String(gridSize));
    domino.chain.forEach((tile,index)=>{
      const [row,column]=path[index];
      const previous=path[Math.max(0,index-1)],next=path[Math.min(path.length-1,index+1)];
      const dr=index<path.length-1?next[0]-row:row-previous[0],dc=index<path.length-1?next[1]-column:column-previous[1];
      const pathIsVertical=dr!==0,isDouble=tile[0]===tile[1],standsVertical=isDouble?!pathIsVertical:pathIsVertical;
      const reverse=dc<0||dr<0,displayTile=reverse?[tile[1],tile[0]]:tile;
      const node=dominoTileNode(displayTile,`chain-tile${isDouble?" domino-double":""}${standsVertical?" chain-vertical":""}`);
      node.style.gridRow=String(row+1);node.style.gridColumn=String(column+1);chain.appendChild(node);
    });
  }
  playZone.append(botLabel,botRack,chain);

  const marketZone=document.createElement("section");marketZone.className="domino-market-zone";
  const canDraw=domino.turn==="player"&&domino.stock.length&&!domino.player.some(tile=>dominoSides(tile).length);
  const marketButton=document.createElement("button");marketButton.type="button";marketButton.className="domino-market-button";marketButton.disabled=!canDraw;
  marketButton.innerHTML=`<i aria-hidden="true"></i><b>БАЗАР</b><span>${domino.stock.length} костей</span>`;
  marketButton.addEventListener("click",dominoDraw);
  const marketHint=document.createElement("p");marketHint.textContent=canDraw?"Нажмите, чтобы взять одну кость":domino.stock.length?"Доступен, когда нет хода":"Базар пуст";
  marketZone.append(marketButton,marketHint);
  root.append(playerZone,playZone);
  const marketSlot=arcadeEl("arcadeMarketSlot");marketSlot.innerHTML="";marketSlot.classList.remove("hidden");marketSlot.appendChild(marketZone);
  arcadeEl("arcadePlayerLabel").textContent=domino.fives?"Вы · счёт":"Вы · штраф";
  arcadeEl("arcadeBotLabel").textContent=domino.fives?`${opponentName()} · счёт`:`${opponentName()} · штраф`;
  arcadeEl("arcadePlayerScore").classList.add("fives-score");
  arcadeEl("arcadeBotScore").classList.add("fives-score");
  arcadeEl("arcadePlayerScore").textContent=domino.fives?fivesScoreText("player"):`${domino.score.player} очк.`;
  arcadeEl("arcadeBotScore").textContent=domino.fives?fivesScoreText("bot"):`${domino.score.bot} очк.`;
  arcadeEl("arcadeStatus").textContent=domino.turn==="waiting"?"Жеребьёвка первого хода":domino.turn==="player"?"Ваш ход":`${opponentName()} думает…`;
  const lastScore=domino.fives&&domino.lastScore
    ?`<span>Последнее начисление: <b>${domino.lastScore.who==="player"?"вы":escapeHtml(opponentName())} +${domino.lastScore.points}</b></span>`
    :"";
  const hasHomeMove=domino.fives&&domino.turn==="player"&&domino.player.some(tile=>dominoSides(tile).some(isDirectHomeSide));
  arcadeEl("arcadeInfo").innerHTML=`<span>Базар: <b>${domino.stock.length}</b></span><span>Открытые края: <b>${dominoOpenEndsText()}</b></span>${domino.fives?`<span>Пятёрки: <b>${domino.fiveCounts.player} : ${domino.fiveCounts.bot}</b></span><span>До победы: <b>${Math.max(0,100-domino.score.player)} : ${Math.max(0,100-domino.score.bot)}</b></span>${domino.home?`<span>Дом: <b>${domino.home.value}:${domino.home.value} · четыре линии</b></span>`:"<span>Дом: <b>первый дубль ещё не выставлен</b></span>"}${hasHomeMove?"<span class=\"home-move-hint\">★ Есть приоритетный ход прямо в «Дом»</span>":""}${lastScore}`:`<span>Кости на руках: <b>${domino.player.length} : ${domino.bot.length}</b></span><span>До 101: <b>${Math.max(0,101-domino.score.player)} : ${Math.max(0,101-domino.score.bot)}</b></span><span>«Яйца»: <b>${domino.eggs||0}</b>${domino.eggs?` · следующий штраф ×${domino.eggs+1}`:""}</span>`}`;
  if(domino.turn==="player"&&!domino.player.some(tile=>dominoSides(tile).length)&&!domino.stock.length)setArcadeActions([{label:"Пас",action:()=>dominoPass("player"),primary:true}]);else if(!domino.pending)setArcadeActions([]);
  playPendingArcadeMove();
}
function dominoChoose(index){
  if(arcadeOver||domino.turn!=="player"||arcadeAnimating)return;const sides=dominoSides(domino.player[index]);if(!sides.length)return;
  if(sides.length>1&&domino.chain.length){
    const sideLabels={left:"Поставить слева",right:"Поставить справа",top:"★ В «Дом» — сверху",bottom:"★ В «Дом» — снизу"};
    domino.pending=index;setArcadeActions(sides.map(side=>({label:sideLabels[side],action:()=>dominoPlay("player",index,side),primary:isDirectHomeSide(side)})));return
  }
  dominoPlay("player",index,sides[0]);
}
function orientDomino(tile,side){
  if(!domino.chain.length)return[tile[0],tile[1]];
  const branch=domino.home&&["top","bottom"].includes(side)?domino.home[side]:null;
  const edge=side==="left"?domino.chain[0][0]:side==="right"?domino.chain.at(-1)[1]:branch.length?branch.at(-1)[1]:domino.home.value;
  if(branch)return tile[0]===edge?[tile[0],tile[1]]:[tile[1],tile[0]];
  if(side==="right")return tile[0]===edge?[tile[0],tile[1]]:[tile[1],tile[0]];
  return tile[1]===edge?[tile[0],tile[1]]:[tile[1],tile[0]];
}
function dominoEndsScoreFor(chain){
  if(!chain.length)return 0;
  if(chain.length===1)return chain[0][0]+chain[0][1];
  const first=chain[0],last=chain.at(-1);
  return first[0]*(first[0]===first[1]?2:1)+last[1]*(last[0]===last[1]?2:1);
}
function dominoEndsScore(){
  if(!domino.home)return dominoEndsScoreFor(domino.chain);
  const isHome=tile=>tile?._dominoId===domino.home.tileId;
  if(domino.chain.length===1&&!domino.home.top.length&&!domino.home.bottom.length)return domino.home.value*2;
  const first=domino.chain[0],last=domino.chain.at(-1);
  let total=first[0]*(first[0]===first[1]&&!isHome(first)?2:1)+last[1]*(last[0]===last[1]&&!isHome(last)?2:1);
  for(const side of["top","bottom"]){
    const branch=domino.home[side];
    if(!branch.length)total+=domino.home.value;
    else{
      const end=branch.at(-1);
      total+=end[1]*(end[0]===end[1]?2:1);
    }
  }
  return total;
}
function dominoOpenEndsText(){
  if(!domino.chain.length)return"—";
  if(!domino.home)return`${domino.chain[0][0]} и ${domino.chain.at(-1)[1]}`;
  if(domino.chain.length===1&&!domino.home.top.length&&!domino.home.bottom.length)return`${domino.home.value} + ${domino.home.value}`;
  const ends=[domino.chain[0][0],domino.chain.at(-1)[1]];
  for(const side of["top","bottom"]){
    const branch=domino.home[side];
    ends.push(branch.length?branch.at(-1)[1]:domino.home.value);
  }
  return ends.join(" + ");
}
function encodeOnlineDominoTile(tile){return[tile[0],tile[1],Number(tile._dominoId)||0]}
function decodeOnlineDominoTile(tile){
  const decoded=[Number(tile?.[0])||0,Number(tile?.[1])||0];
  if(Number(tile?.[2]))decoded._dominoId=Number(tile[2]);
  return decoded;
}
function onlineDominoSnapshot(turnOverride=null){
  const snapshot={...domino,turn:turnOverride||domino.turn,pending:null};
  for(const key of["player","bot","stock","chain"])snapshot[key]=domino[key].map(encodeOnlineDominoTile);
  snapshot.score={...domino.score};snapshot.fiveCounts={...domino.fiveCounts};
  snapshot.lastScore=domino.lastScore?{...domino.lastScore}:null;
  snapshot.home=domino.home?{
    ...domino.home,
    top:domino.home.top.map(encodeOnlineDominoTile),
    bottom:domino.home.bottom.map(encodeOnlineDominoTile)
  }:null;
  return snapshot;
}
function restoreOnlineDominoSnapshot(source){
  const restored={...source,pending:null};
  for(const key of["player","bot","stock","chain"])restored[key]=(source[key]||[]).map(decodeOnlineDominoTile);
  restored.home=source.home?{
    ...source.home,
    top:(source.home.top||[]).map(decodeOnlineDominoTile),
    bottom:(source.home.bottom||[]).map(decodeOnlineDominoTile)
  }:null;
  [restored.player,restored.bot]=[restored.bot,restored.player];
  restored.score={player:Number(source.score?.bot)||0,bot:Number(source.score?.player)||0};
  restored.fiveCounts={player:Number(source.fiveCounts?.bot)||0,bot:Number(source.fiveCounts?.player)||0};
  restored.turn=source.turn==="player"?"bot":source.turn==="bot"?"player":source.turn;
  if(restored.lastScore)restored.lastScore.who=restored.lastScore.who==="player"?"bot":"player";
  return restored;
}
function sendOnlineDominoState(turnOverride=null){
  if(onlineHumanMatch(arcadeMode))sendOnlineGameAction({kind:"domino_state",state:onlineDominoSnapshot(turnOverride)});
}
function dominoPlay(who,index,side){
  beginArcadeHistoryBranch();
  const movingSnapshot=captureArcadeMover(who==="player"
    ?`.domino-player-hand .domino-tile[data-hand-index="${index}"]`
    :".domino-bot-rack .domino-tile");
  const hand=domino[who],tile=hand.splice(index,1)[0],placed=orientDomino(tile,side);
  placed._dominoId=++domino.tileSeq;
  queueArcadeMove(movingSnapshot,`.domino-chain .domino-tile[data-domino-id="${placed._dominoId}"]`);
  if(side==="left")domino.chain.unshift(placed);
  else if(side==="right")domino.chain.push(placed);
  else domino.home[side].push(placed);
  const createsHome=domino.fives&&!domino.home&&tile[0]===tile[1];
  if(createsHome)domino.home={value:tile[0],tileId:placed._dominoId,top:[],bottom:[]};
  domino.pending=null;domino.passes=0;
  let technique=createsHome?"дом — первый дубль":tile[0]===tile[1]?"дубль":"";
  let reason=createsHome?"теперь от этого дубля можно строить четыре независимые линии":technique?"дубль открывает дополнительные направления цепочки":"";
  if(domino.fives){
    const total=dominoEndsScore();
    if(total&&total%5===0){
      awardFives(who,total);
      technique=`комбинация «Все пятёрки»: ${total}`;
      reason=`сумма открытых концов равна ${total} и делится на пять`;
    }
    if(technique)announceTechnique(technique,who==="player"?"player":"opponent",reason);
    if(domino.score[who]>=100){
      if(who==="player")sendOnlineDominoState("bot");
      pushArcadePosition();
      finishFivesMatch(who,who==="player"?"Вы первыми набрали 100 очков.":`${opponentName()} первым набрал 100 очков.`);
      return;
    }
  }else if(technique)announceTechnique(technique,who==="player"?"player":"opponent",reason);
  if(!hand.length){if(who==="player")sendOnlineDominoState("bot");pushArcadePosition();dominoRoundEnd(who);return}
  domino.turn=who==="player"?"bot":"player";
  if(who==="player")sendOnlineDominoState();
  renderDomino();pushArcadePosition();if(domino.turn==="bot"&&!onlineHumanMatch(arcadeMode))arcadeTimer=setTimeout(dominoBot,430);
}
function dominoDraw(){
  if(arcadeOver||domino.turn!=="player"||arcadeAnimating||!domino.stock.length||domino.player.some(tile=>dominoSides(tile).length))return;
  beginArcadeHistoryBranch();domino.player.push(domino.stock.pop());domino.pending=null;sendOnlineDominoState();renderDomino();pushArcadePosition();
}
function dominoPass(who){
  beginArcadeHistoryBranch();domino.passes++;if(domino.passes>=2){const pp=domino.player.flat().reduce((a,b)=>a+b,0),bp=domino.bot.flat().reduce((a,b)=>a+b,0);if(who==="player")sendOnlineDominoState("bot");pushArcadePosition();dominoRoundEnd(pp===bp?null:pp<bp?"player":"bot");return}
  domino.turn=who==="player"?"bot":"player";if(who==="player")sendOnlineDominoState();renderDomino();pushArcadePosition();if(domino.turn==="bot"&&!onlineHumanMatch(arcadeMode))arcadeTimer=setTimeout(dominoBot,350);
}
function dominoProjectedEnds(tile,side,placed){
  const endpoint=piece=>piece[1]*(piece[0]===piece[1]?2:1);
  if(!domino.fives)return dominoEndsScoreFor(side==="left"?[placed,...domino.chain]:[...domino.chain,placed]);
  if(!domino.home&&tile[0]===tile[1]){
    const test=side==="left"?[placed,...domino.chain]:[...domino.chain,placed];
    return test.length===1?tile[0]*2:dominoEndsScoreFor(test)+tile[0];
  }
  if(!domino.home)return dominoEndsScoreFor(side==="left"?[placed,...domino.chain]:[...domino.chain,placed]);
  const inactive=domino.chain.length===1&&!domino.home.top.length&&!domino.home.bottom.length;
  if(inactive)return domino.home.value*3+endpoint(placed);
  let current=dominoEndsScore(),oldContribution;
  if(side==="left"){
    const first=domino.chain[0],isHome=first._dominoId===domino.home.tileId;
    oldContribution=first[0]*(first[0]===first[1]&&!isHome?2:1);
    return current-oldContribution+placed[0]*(placed[0]===placed[1]?2:1);
  }
  if(side==="right"){
    const last=domino.chain.at(-1),isHome=last._dominoId===domino.home.tileId;
    oldContribution=last[1]*(last[0]===last[1]&&!isHome?2:1);
    return current-oldContribution+endpoint(placed);
  }
  const branch=domino.home[side];
  oldContribution=branch.length?endpoint(branch.at(-1)):domino.home.value;
  return current-oldContribution+endpoint(placed);
}
function dominoBot(){
  if(arcadeOver)return;if(arcadeAnimating){arcadeTimer=setTimeout(dominoBot,120);return}while(domino.stock.length&&!domino.bot.some(tile=>dominoSides(tile).length))domino.bot.push(domino.stock.pop());
  const level=opponentLevelForMode(arcadeMode);
  const choices=[];domino.bot.forEach((tile,index)=>dominoSides(tile).forEach(side=>{const placed=orientDomino(tile,side),old=domino.chain;
    const test=side==="left"?[placed,...old]:side==="right"?[...old,placed]:old,first=test[0],last=test.at(-1),ends=dominoProjectedEnds(tile,side,placed);
    const remaining=domino.bot.filter((_,tileIndex)=>tileIndex!==index);
    const future=remaining.filter(next=>next.includes(first[0])||next.includes(last[1])).length;
    const opponentReplies=domino.player.filter(next=>next.includes(first[0])||next.includes(last[1])).length;
    let score=tile[0]+tile[1]+(domino.fives&&ends%5===0?ends*3:0)+(tile[0]===tile[1]?3:0)+(isDirectHomeSide(side)?24:0);
    if(["B2","V1","V2"].includes(level))score+=future*(level==="B2"?2:5);
    if(["V1","V2"].includes(level))score+=(remaining.length===0?500:0)+(domino.fives&&ends%5===0?ends*2:0);
    if(level==="V2")score-=opponentReplies*5;
    choices.push({index,side,score})}));
  if(!choices.length){dominoPass("bot");return}
  let choice;
  if(level==="A1")choice=choices[Math.floor(Math.random()*choices.length)];
  else if(level==="A2"){choices.sort((a,b)=>b.score-a.score);choice=choices[Math.floor(Math.random()*Math.max(1,Math.ceil(choices.length*.5)))]}
  else{choices.sort((a,b)=>b.score-a.score);choice=choices[0]}
  dominoPlay("bot",choice.index,choice.side);
}
function goatPenalty(hand){
  const isTile=(tile,a,b)=>tile[0]===a&&tile[1]===b;
  if(hand.length===1&&isTile(hand[0],0,0))return 25;
  if(hand.length===1&&isTile(hand[0],6,6))return 50;
  if(hand.length===2&&hand.some(tile=>isTile(tile,0,0))&&hand.some(tile=>isTile(tile,6,6)))return 75;
  return hand.flat().reduce((sum,value)=>sum+value,0);
}
function dominoRoundEnd(winner){
  if(domino.fives){
    const playerPips=domino.player.flat().reduce((a,b)=>a+b,0);
    const botPips=domino.bot.flat().reduce((a,b)=>a+b,0);
    const blocked=domino.player.length>0&&domino.bot.length>0;
    let summary;
    if(winner){
      const rawBonus=blocked?Math.abs(playerPips-botPips):(winner==="player"?botPips:playerPips);
      const bonus=roundToFive(rawBonus);
      awardFives(winner,bonus);
      summary=blocked
        ?`«Рыба»: ${winner==="player"?"у вас":"у Старого Мастера"} меньше точек в руке. Разница ${rawBonus}, после округления начислено ${bonus}.`
        :`${winner==="player"?"Вы":opponentName()} закончили кости. Остаток соперника ${rawBonus}, после округления начислено ${bonus}.`;
    }else{
      summary=`«Рыба»: у обоих игроков по ${playerPips} точек. Раунд завершён без начисления.`;
    }
    domino.revealHands=true;
    renderDomino();
    if(winner&&domino.score[winner]>=100){
      finishFivesMatch(winner,`${summary} ${winner==="player"?"Вы первыми достигли 100 очков.":`${opponentName()} первым достиг 100 очков.`}`);
      return;
    }
    arcadeOver=true;
    updateArcadeHistoryControls();
    arcadeEl("arcadeStatus").textContent=winner?`Раунд выиграл ${winner==="player"?"игрок":opponentName()}`:"Раунд завершён вничью";
    arcadeEl("arcadeInfo").insertAdjacentHTML("beforeend",`<span class="round-summary"><b>${summary}</b></span>`);
    setArcadeActions([{label:"Следующий раунд",action:()=>startDomino(true,true),primary:true},{label:"Выбрать игру",action:backToGameMenu}]);
    return;
  }
  const loser=winner==="player"?"bot":winner==="bot"?"player":null;
  const blocked=domino.player.length>0&&domino.bot.length>0;
  const basePenalty=loser?goatPenalty(domino[loser]):0;
  const receivesEgg=winner===null||(loser&&basePenalty<13);
  let multiplier=1,penalty=0;
  if(receivesEgg)domino.eggs=(domino.eggs||0)+1;
  else if(loser){
    multiplier=(domino.eggs||0)+1;
    penalty=basePenalty*multiplier;
    domino.score[loser]+=penalty;
    domino.eggs=0;
  }
  domino.revealHands=true;
  renderDomino();
  const bayanEggLoss=loser&&basePenalty===50&&multiplier>1&&penalty>=100;
  if(loser&&penalty&&(domino.score[loser]>=101||bayanEggLoss)){
    const playerWon=loser==="bot";
    const special=basePenalty===75?" На руках остались «голый» и «баян».":basePenalty===50?" На руке остался одинокий «баян» 6:6.":basePenalty===25?" На руке остался одинокий «голый» 0:0.":"";
    const eggText=multiplier>1?` Накопленные «яйца» умножили штраф ${basePenalty} × ${multiplier} = ${penalty}.`:"";
    finishArcade(playerWon,`${loser==="player"?"Вы":opponentName()} получили ${penalty} штрафных очков; общий счёт — ${domino.score[loser]}. Матч проигран.${special}${eggText}`,()=>startDomino(false));
    return;
  }
  arcadeOver=true;
  updateArcadeHistoryControls();
  if(winner===null){
    arcadeEl("arcadeStatus").textContent="Равная «рыба» — яйца";
    arcadeEl("arcadeInfo").insertAdjacentHTML("beforeend",`<span class="round-summary"><b>Суммы равны: записан 0 — «яйцо» №${domino.eggs}. Следующий штраф будет ×${domino.eggs+1}.</b></span>`);
  }else if(receivesEgg){
    arcadeEl("arcadeStatus").textContent=`Недобор ${basePenalty} — яйца`;
    arcadeEl("arcadeInfo").insertAdjacentHTML("beforeend",`<span class="round-summary"><b>${loser==="player"?"Вы":escapeHtml(opponentName())} проиграли кон, но набрали меньше 13 (${basePenalty}). Записан 0 — «яйцо» №${domino.eggs}; следующий штраф ×${domino.eggs+1}.</b></span>`);
  }else{
    const special=basePenalty===75?"«голый» + «баян»":basePenalty===50?"одинокий «баян»":basePenalty===25?"одинокий «голый»":"остаток костей";
    const calculation=multiplier>1?`${basePenalty} × ${multiplier} = ${penalty}`:String(penalty);
    arcadeEl("arcadeStatus").textContent=blocked?`«Рыба»: меньше очков у ${winner==="player"?"игрока":opponentName()}`:`Кон выиграл ${winner==="player"?"игрок":opponentName()}`;
    arcadeEl("arcadeInfo").insertAdjacentHTML("beforeend",`<span class="round-summary"><b>${loser==="player"?"Вы":escapeHtml(opponentName())}: ${special}, +${calculation} штрафных очков.${multiplier>1?" «Яйца» погашены.":""}</b></span>`);
  }
  setArcadeActions([
    {label:"Следующий кон",action:()=>startDomino(false,true,winner),primary:true},
    {label:"Выбрать игру",action:backToGameMenu}
  ]);
}
