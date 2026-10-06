'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const Selection = require('../shared/selectionEngine');
const Core = require('../shared/recommendationCore');

// Evaluate the shipped renderer, suppressing only boot and browser side effects.
// No copies of its parsing, scoring, or game-state functions live in this harness.
function app() {
  const context = vm.createContext({
    console, setTimeout, clearTimeout, Uint8Array, ArrayBuffer,
    document: { getElementById: () => null },
    window: { desktopApi: {}, dispatchEvent() {} },
    localStorage: { setItem() {}, getItem() { return null; } },
    GridironRecommendationCore: Core,
    GridironSelectionEngine: Selection,
    GridironDefenseRecommendationCore: require('../shared/defenseRecommendationCore'),
    GridironCoordinatorReport: require('../shared/coordinatorReport'),
    GridironPenaltyCatalog: require('../shared/penaltyCatalog'),
  });
  const source = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  assert.match(source, /init\(\);\s*$/);
  vm.runInContext(source.replace(/init\(\);\s*$/, ''), context);
  vm.runInContext(`render=()=>{}; recordTraceEvent=()=>{}; recordTraceBlock=()=>{};
    closeOverlay=()=>{}; openSettings=()=>{}; setStatus=()=>{};
    closeAudiblePicker=()=>{}; closePenaltyPicker=()=>{};
    notifyOcrExactCallStateChanged=()=>{};`, context);
  context.run = code => vm.runInContext(code, context);
  return context;
}

test('selection preserves capped football/learning score, applying repetition separately', () => {
  const combined = Core.combineRecommendationScore({ situation: 100, identity: 100, platform: 100, learning: 100 });
  const play = { id: 'p1', formation: 'Gun', set: 'Trips', type: 'PASS' };
  const result = Selection.selectRecommendationSlate({
    scored: [{ play, score: combined.score, parts: combined.parts,
      compositeParts: { base: 100, defense: 100, team: 100, success: 100 } }],
    scoreKey: 'score', preserveInputScore: true, limit: 1,
  });
  assert.equal(result.slate[0].score, combined.score);
});

test('whole-game appearance counts survive rolling history and drive resets', () => {
  const a = app();
  a.run(`state.normalizedPlays=[];
    const p=normalizeImportedPlay({team:'CHI',formation:'Gun',set:'Trips',play_name:'Mesh',type:'PASS'});
    let clock=1000; Date.now=()=>++clock;
    for(let i=0;i<210;i++){
      const play=i<2?p:{...p,id:'other-'+i};
      recordRecommendationExposure([{play}], 's', 'b');
    }
    resetDriveState();`);
  const count = a.run(`SelectionEngine.buildSelectionMemory({
    recommendationExposureHistory:state.recommendationExposureHistory,
    sessionPlayShowCounts:state.sessionPlayShowCounts
  }).playShowCounts[p.id]`);
  assert.equal(count, 2);
  a.run('backToTeamSelect()');
  assert.equal(a.run('Object.keys(state.sessionPlayShowCounts).length'), 0);
});

for (const penalty of ['offensive_holding', 'false_start']) {
  test(`terminal results honor ${penalty} learning gates`, () => {
    const a = app();
    a.run(`state.normalizedPlays=[normalizeImportedPlay({team:'CHI',formation:'Gun',set:'Trips',play_name:'Mesh',type:'PASS'})];
      state.hasActiveSituation=true; startCoordinatorSession('normal');
      computeRecommendations(); onGetPlays();
      confirmRecommendedPlay(state.presentedRecommendations[0].play.id);
      applyPenalty('${penalty}');
      applyDriveResultAndReset('interception');`);
    assert.equal(a.run('Object.keys(state.userLearning.global.plays).length'), 0);
    assert.equal(a.run('state.gameOutcomeMemory.length'), 0);
    assert.equal(a.run('state.recentGameCalls.length'), penalty === 'false_start' ? 0 : 1);
  });
}

test('unpenalized terminal outcome still trains learning', () => {
  const a = app();
  a.run(`state.normalizedPlays=[normalizeImportedPlay({team:'CHI',formation:'Gun',set:'Trips',play_name:'Mesh',type:'PASS'})];
    state.hasActiveSituation=true; startCoordinatorSession('normal');
    computeRecommendations(); onGetPlays(); confirmRecommendedPlay(state.presentedRecommendations[0].play.id);
    applyDriveResultAndReset('interception');`);
  assert.equal(a.run('Object.keys(state.userLearning.global.plays).length'), 1);
  assert.equal(a.run('state.gameOutcomeMemory.length'), 1);
});

test('production scoring retains historical variety and learning exactly once', () => {
  const a = app();
  a.run(`state.normalizedPlays=[normalizeImportedPlay({team:'CHI',formation:'Gun',set:'Trips',play_name:'Mesh',type:'PASS'})];
    Math.random=()=>0.5;
    historicalVarietyAdjustment=()=>-12;
    personalLearningAdjustment=()=>8;
    computeRecommendations();`);
  assert.equal(a.run('state.recommendations[0].parts.learning'), 8);
  assert.ok(a.run('state.recommendations[0].parts.variety < 0'));
  assert.equal(a.run('state.recommendations[0].score'),
    a.run('Object.values(state.recommendations[0].parts).reduce((sum,n)=>sum+n,0)'));
});

test('session-capped plays stay excluded when recent history is empty', () => {
  const result = Selection.selectRecommendationSlate({
    scored: [{ play: { id: 'capped', formation: 'Gun', set: 'Trips', type: 'PASS' }, score: 50 }],
    scoreKey: 'score', preserveInputScore: true, sessionPlayShowCounts: { capped: 2 },
  });
  assert.equal(result.slate.length, 0);
});

test('Exact Call sheets remain remembered beyond 40 sheets and clear for a new game', () => {
  const a = app();
  a.run(`for(let i=0;i<65;i++)presentOcrExactPlays([{play:{id:'defense-'+i}}]);
    resetDriveState();`);
  assert.equal(a.run('getOcrExactVarietyMemory().exposureSheets.length'), 65);
  a.run('confirmNewGame("normal")');
  assert.equal(a.run('getOcrExactVarietyMemory().exposureSheets.length'), 0);
});

test('renderer drive and end-game actions reset OCR attribution', () => {
  const a = app();
  a.run(`const resetReasons=[];window.desktopApi.ocrResetSession=async args=>resetReasons.push(args.reason);
    resetDriveState(); onPressEndGame();`);
  assert.ok(a.run('resetReasons.includes("drive_reset")'));
  assert.ok(a.run('resetReasons.includes("end_game")'));
});

test('production spoken parser retains field position and goal-to-go', () => {
  const a = app();
  assert.equal(a.run(`parseSituation('First intent on the opponents 21',state).yards`), 10);
  assert.equal(a.run(`parseSituation('1st and goal on the 4',state).goalToGo`), true);
  assert.equal(a.run(`parseSituation('3rd down at 7 on the opponents 39',state).fieldPosition.yardLine`), 39);
});

module.exports = { app };

test('all 32 teams retain valid three-play sheets across six modes and field situations', () => {
  const a = app();
  a.catalog = JSON.parse(fs.readFileSync(path.join(root, 'plays.json'), 'utf8'));
  const result = a.run(`(() => {
    state.normalizedPlays=catalog.map(normalizeImportedPlay);
    const modes=['normal','two_minute','kill_clock','comeback','blitz_beater','redzone'];
    const spots=[ [1,10,false,'OWN',25], [3,7,false,'OWN',40], [2,3,false,'OPP',20],
      [4,12,false,'OWN',10], [1,10,false,'OPP',15], [2,3,true,'OPP',3] ];
    let checked=0;
    for(const team of NFL_TEAMS){for(let i=0;i<spots.length;i++){
      state.selectedTeam=team.code; state.playcallingMode=modes[i];
      [state.down,state.yards,state.goalToGo]=spots[i];
      state.fieldPosition={side:spots[i][3],yardLine:spots[i][4]};
      state.hasActiveSituation=true; computeRecommendations();
      if(state.recommendations.length!==3)throw Error(team.code+' '+modes[i]+' missing sheet');
      if(new Set(state.recommendations.map(x=>x.play.id)).size!==3)throw Error('duplicate play');
      for(const item of state.recommendations){
        if(item.play.team!==team.code||!Number.isFinite(item.score)||isHailMaryPlay(item.play))throw Error('invalid recommendation');
        if(!Number.isFinite(item._compositeParts.foundation))throw Error('missing capped foundation');
        for(const [key,value] of Object.entries(item.parts)){
          if(Math.abs(value)>RecommendationCore.CONSTRAINED_RANKING_DEFAULTS.partCaps[key]+1e-8)throw Error('cap exceeded: '+key);
        }
      }
      checked++;
    }} return checked;
  })()`);
  assert.equal(result, 192);
});

test('audible and next spoken snap retain learning and confirmation flow', async () => {
  const a = app();
  a.catalog = JSON.parse(fs.readFileSync(path.join(root, 'plays.json'), 'utf8'));
  a.run(`state.normalizedPlays=catalog.map(normalizeImportedPlay); state.hasActiveSituation=true;
    state.fieldPosition={side:'OWN',yardLine:25}; startCoordinatorSession('normal');
    computeRecommendations(); onGetPlays(); confirmRecommendedPlay(state.presentedRecommendations[0].play.id);
    const selected=state.confirmedBasePlay;
    const alternate=state.normalizedPlays.find(p=>p.team===selected.team&&p.formation===selected.formation&&p.set===selected.set&&p.id!==selected.id);
    if(!alternate)throw Error('no audible fixture'); applyAudiblePlay(alternate.id);`);
  const audible = a.run('state.pendingOutcome.playId');
  await a.run(`processTranscript('2nd and 5 on my own 30')`);
  // The prior snap (audible) was settled and learned
  assert.equal(a.run('Object.keys(state.userLearning.global.plays)[0]'), audible);
  // Auto Playcaller auto-confirms the top play for the new 2nd & 5 spot
  assert.ok(a.run('state.pendingOutcome'));
  assert.equal(a.run('state.pendingOutcome.down'), 2);
  assert.equal(a.run('state.presentedRecommendations.length'), 3);
});

test('fresh start initializes coordinatorRole to OC even if persisted prefs had DC', () => {
  const a = app();
  a.run(`applyPersistedPreferences({ coordinatorRole: 'dc', selectedTeam: 'CHI' });`);
  assert.equal(a.run('state.coordinatorRole'), 'oc');
});

test('matchup setup modal updates team, opponent and presentation style', () => {
  const a = app();
  a.run(`
    setMatchupPresentationStyle('Thursday Night Football');
    state.selectedTeam = 'KC';
    state.selectedOpponent = 'BUF';
  `);
  assert.equal(a.run('state.matchupPresentationStyle'), 'Thursday Night Football');
  assert.equal(a.run('state.selectedTeam'), 'KC');
  assert.equal(a.run('state.selectedOpponent'), 'BUF');
});

test('auto playcaller defaults to enabled and confirms best play upon OCR capture', () => {
  const a = app();
  a.catalog = JSON.parse(fs.readFileSync(path.join(root, 'plays.json'), 'utf8'));
  a.run(`
    state.normalizedPlays = catalog.map(normalizeImportedPlay);
    state.selectedTeam = 'CHI';
    startCoordinatorSession('normal');
    applyOcrCaptureSituation({ down: 3, yards: 4, goalToGo: false, fieldPosition: { side: 'OPP', yardLine: 35 } });
  `);
  assert.equal(a.run('state.autoPlaycallerEnabled'), true);
  assert.ok(a.run('state.confirmedRecommendationId'));
  assert.ok(a.run('state.confirmedBasePlay'));
  assert.equal(a.run('state.pendingOutcome.down'), 3);
});

test('sequential OCR captures settle pending snap, log previous defense, and feed opponent scouting report', () => {
  const a = app();
  a.catalog = JSON.parse(fs.readFileSync(path.join(root, 'plays.json'), 'utf8'));
  a.run(`
    state.normalizedPlays = catalog.map(normalizeImportedPlay);
    state.selectedTeam = 'CHI';
    state.selectedOpponent = 'DAL';
    state.autoPlaycallerEnabled = true;
    startCoordinatorSession('normal');
    applyOcrCaptureSituation({ down: 1, yards: 10, goalToGo: false, fieldPosition: { side: 'OWN', yardLine: 25 } });
    const firstConfirmed = state.confirmedRecommendationId;
    applyOcrCaptureSituation({ down: 2, yards: 4, goalToGo: false, fieldPosition: { side: 'OWN', yardLine: 31 }, previousDefensePlayName: 'COVER 3' });
    onPressEndGame();
  `);
  assert.equal(a.run('state.gameScoutingLog.length'), 1);
  assert.equal(a.run('state.gameScoutingLog[0].defense'), 'Cover 3');
  assert.equal(a.run('state.gameScoutingLog[0].opponent'), 'DAL');
  assert.equal(a.run('state.coordinatorReport.scouting.empty'), false);
  assert.equal(a.run('state.coordinatorReport.scouting.items.length > 0'), true);
  assert.ok(a.run('state.sessionReport.confirms[0].outcome'));
});
test('pick 6 from OC keeps user on OC after resolving PAT attempt', () => {
  const a = app();
  a.run(`
    state.coordinatorRole = COORDINATOR_ROLE_OC;
    state.gameStarted = true;
    applyDriveResultAndReset('pick_6');
    resolvePatAttempt(1);
  `);
  assert.equal(a.run('state.coordinatorRole'), 'oc');
  assert.equal(a.run('state.oppScore'), 7);
});

test('scoop and score from OC keeps user on OC after resolving PAT attempt', () => {
  const a = app();
  a.run(`
    state.coordinatorRole = COORDINATOR_ROLE_OC;
    state.gameStarted = true;
    applyDriveResultAndReset('scoop_and_score');
    resolvePatAttempt(0);
  `);
  assert.equal(a.run('state.coordinatorRole'), 'oc');
  assert.equal(a.run('state.oppScore'), 6);
});

test('halftime adjustment confirmation advances to Q3 and clears recommendations without auto-generating new ones', () => {
  const a = app();
  a.run(`
    state.gameStarted = true;
    state.quarter = 2;
    state.coordinatorRole = COORDINATOR_ROLE_OC;
    state.hasActiveSituation = true;
    state.presentedRecommendations = [{ play: { id: 'p1' } }, { play: { id: 'p2' } }, { play: { id: 'p3' } }];
    confirmHalftimeStyle('aggressive');
  `);
  assert.equal(a.run('state.quarter'), 3);
  assert.equal(a.run('state.gameCoordinatorProfile'), 'aggressive');
  assert.equal(a.run('state.hasActiveSituation'), false);
  assert.equal(a.run('state.presentedRecommendations.length'), 0);
  assert.equal(a.run('state.presentedDcRecommendations.length'), 0);
});

test('DC evaluateAutoPlaycall prioritizes goal line heavy front inside 3-yard line', () => {
  const a = app();
  a.run(`
    state.down = 1;
    state.yards = 2;
    state.goalToGo = true;
    state.fieldPosition = { side: 'OPP', yardLine: 2 };
    const candidates = [
      { play: { id: 'nick-1', formation: 'Nickel', play_name: 'Over Storm Brave' }, _score: 16.0 },
      { play: { id: 'gl-1', formation: 'Goal Line', play_name: 'GL Man' }, _score: 14.5 },
      { play: { id: 'base-1', formation: '4-3', play_name: 'Cover 4' }, _score: 11.0 }
    ];
    var decision = evaluateAutoPlaycall(candidates, {}, 'dc');
  `);
  const winnerId = a.run('decision.winner.play.id');
  const reason = a.run('decision.reason');
  assert.equal(winnerId, 'gl-1');
  assert.equal(reason, 'Goal line heavy front package');
});

test('DC evaluateAutoPlaycall rotates to Dime/Dollar/3-3-5 on passing money downs', () => {
  const a = app();
  a.run(`
    state.down = 3;
    state.yards = 8;
    state.goalToGo = false;
    const candidates = [
      { play: { id: 'nick-1', formation: 'Nickel', play_name: 'Cover 3 Match' }, _score: 18.0 },
      { play: { id: 'dime-1', formation: 'Dime', play_name: 'Mug Tex 3' }, _score: 17.0 },
      { play: { id: 'base-1', formation: '4-3', play_name: 'Cover 2' }, _score: 12.0 }
    ];
    var decision = evaluateAutoPlaycall(candidates, {}, 'dc');
  `);
  const winnerId = a.run('decision.winner.play.id');
  assert.equal(winnerId, 'dime-1');
  assert.match(a.run('decision.reason'), /Money down pass defense/);
});

test('DC evaluateAutoPlaycall rotates defensive front when candidate 1 repeats last called formation', () => {
  const a = app();
  a.run(`
    state.down = 1;
    state.yards = 10;
    state.goalToGo = false;
    state.dcRecentPlays = ['chi|nickel|over|cov3'];
    state.normalizedDefensivePlays = [
      { id: 'chi|nickel|over|cov3', formation: 'Nickel', play_name: 'Cover 3' }
    ];
    const candidates = [
      { play: { id: 'chi|nickel|wide|cov4', formation: 'Nickel', play_name: 'Cover 4 Palms' }, _score: 15.0 },
      { play: { id: 'chi|3-3-5|penny|cov9', formation: '3-3-5', play_name: 'Cover 9' }, _score: 13.5 },
      { play: { id: 'chi|4-3|over|cov3', formation: '4-3', play_name: 'Cover 3' }, _score: 10.0 }
    ];
    var decision = evaluateAutoPlaycall(candidates, {}, 'dc');
  `);
  const winnerId = a.run('decision.winner.play.id');
  assert.equal(winnerId, 'chi|3-3-5|penny|cov9');
  assert.match(a.run('decision.reason'), /Defensive front rotation/);
});

test('Opening Script places scripted play in Slot #1 and situational plays in Slots #2 & #3', () => {
  const a = app();
  a.run(`
    state.normalizedPlays = [
      normalizeImportedPlay({ team: 'CHI', formation: 'Gun', set: 'Trips', play_name: 'PA Crossers', type: 'PA' }),
      normalizeImportedPlay({ team: 'CHI', formation: 'Singleback', set: 'Ace', play_name: 'HB Dive', type: 'RUN' }),
      normalizeImportedPlay({ team: 'CHI', formation: 'Gun', set: 'Bunch', play_name: 'Mesh', type: 'PASS' })
    ];
    state.customScriptPlays = [state.normalizedPlays[1].id]; // HB Dive playId
    state.customScriptActive = true;
    state.customScriptIndex = 0;
    state.down = 1;
    state.yards = 10;
    computeRecommendations();
  `);
  assert.equal(a.run('state.recommendations.length'), 3);
  assert.equal(a.run('state.recommendations[0].play.play_name'), 'HB Dive');
  assert.equal(a.run('state.recommendations[0].scriptMatch'), true);
  assert.equal(a.run('state.recommendations[0].scriptTag'), 'Script #1');
  assert.notEqual(a.run('state.recommendations[1].play.play_name'), 'HB Dive');
  assert.notEqual(a.run('state.recommendations[2].play.play_name'), 'HB Dive');
});

test('Confirming scripted play advances customScriptIndex, but alternate does not', () => {
  const a = app();
  a.run(`
    state.normalizedPlays = [
      normalizeImportedPlay({ team: 'CHI', formation: 'Gun', set: 'Trips', play_name: 'PA Crossers', type: 'PA' }),
      normalizeImportedPlay({ team: 'CHI', formation: 'Singleback', set: 'Ace', play_name: 'HB Dive', type: 'RUN' })
    ];
    state.customScriptPlays = [state.normalizedPlays[1].id, state.normalizedPlays[0].id];
    state.customScriptActive = true;
    state.customScriptIndex = 0;
    
    // Simulate confirming Slot #1 via state.confirmedPlayUsage
    state.confirmedPlayUsage = { play: state.normalizedPlays[1], scriptMatch: true };
    commitConfirmedPlayUsage();
  `);
  assert.equal(a.run('state.customScriptIndex'), 1);

  // Simulate an audible or alternate pick (scriptMatch is falsy)
  a.run(`
    state.confirmedPlayUsage = { play: state.normalizedPlays[0], scriptMatch: false };
    commitConfirmedPlayUsage();
  `);
  assert.equal(a.run('state.customScriptIndex'), 1);
});

test('OC evaluateAutoPlaycall confirms Slot #1 on normal downs, yields to Slot #2 on 3rd & 10+ run mismatch', () => {
  const a = app();
  a.run(`
    state.normalizedPlays = [
      normalizeImportedPlay({ team: 'CHI', formation: 'Singleback', set: 'Ace', play_name: 'HB Dive', type: 'RUN' }),
      normalizeImportedPlay({ team: 'CHI', formation: 'Gun', set: 'Bunch', play_name: 'Mesh', type: 'PASS' }),
      normalizeImportedPlay({ team: 'CHI', formation: 'Gun', set: 'Trips', play_name: 'Drive', type: 'PASS' })
    ];
    state.customScriptPlays = [state.normalizedPlays[0].id];
    state.customScriptActive = true;
    state.customScriptIndex = 0;

    const candidates = [
      { play: { id: 'run-1', play_name: 'HB Dive', type: 'RUN' }, scriptMatch: true, scriptTag: 'Script #1', score: 999 },
      { play: { id: 'pass-1', play_name: 'Mesh', type: 'PASS' }, score: 85 },
      { play: { id: 'pass-2', play_name: 'Drive', type: 'PASS' }, score: 80 }
    ];
    state.down = 1;
    state.yards = 10;
    var normDecision = evaluateAutoPlaycall(candidates, {}, 'oc');

    state.down = 3;
    state.yards = 11;
    var moneyDecision = evaluateAutoPlaycall(candidates, {}, 'oc');
  `);
  assert.equal(a.run('normDecision.winner.play.id'), 'run-1');
  assert.match(a.run('normDecision.reason'), /Opening script/);

  assert.equal(a.run('moneyDecision.winner.play.id'), 'pass-1');
  assert.match(a.run('moneyDecision.reason'), /Script paused|passing money down/);
});

test('Zero persistence: resetting or changing teams clears custom script', () => {
  const a = app();
  a.run(`
    state.customScriptPlays = [{ id: 'p1', play_name: 'Test Play' }];
    state.customScriptActive = true;
    state.customScriptIndex = 4;
    backToTeamSelect();
  `);
  assert.equal(a.run('state.customScriptPlays.length'), 0);
  assert.equal(a.run('state.customScriptActive'), false);
  assert.equal(a.run('state.customScriptIndex'), 0);
});

test('autoFillScript generates a 15-play sequence using NFL setup-to-payoff architecture', () => {
  const a = app();
  // Provide a mini-playbook with inside runs, PA shots, screens, quick game, perimeter runs
  a.run(`
    state.selectedTeam = 'KC';
    state.normalizedPlays = [
      normalizeImportedPlay({ team: 'KC', formation: 'Singleback', set: 'Ace', play_name: 'Inside Zone', family: 'Inside Zone', type: 'RUN' }),
      normalizeImportedPlay({ team: 'KC', formation: 'Singleback', set: 'Ace', play_name: 'PA Zone Shot', family: 'Play Action', type: 'PA' }),
      normalizeImportedPlay({ team: 'KC', formation: 'Singleback', set: 'Wing', play_name: 'HB Duo', family: 'Duo', type: 'RUN' }),
      normalizeImportedPlay({ team: 'KC', formation: 'Singleback', set: 'Wing', play_name: 'PA Duo Deep', family: 'Play Action', type: 'PA' }),
      normalizeImportedPlay({ team: 'KC', formation: 'Gun', set: 'Spread', play_name: 'Quick Slants', family: 'Quick Game', type: 'PASS' }),
      normalizeImportedPlay({ team: 'KC', formation: 'Gun', set: 'Bunch', play_name: 'Wide Zone', family: 'Outside Zone', type: 'RUN' }),
      normalizeImportedPlay({ team: 'KC', formation: 'Gun', set: 'Bunch', play_name: 'HB Screen', family: 'Screen', type: 'PASS' }),
      normalizeImportedPlay({ team: 'KC', formation: 'Gun', set: 'Empty', play_name: 'Mesh Rail', family: 'Mesh', type: 'PASS' }),
      normalizeImportedPlay({ team: 'KC', formation: 'Gun', set: 'Trips', play_name: 'Counter Tre', family: 'Counter', type: 'RUN' }),
      normalizeImportedPlay({ team: 'KC', formation: 'Singleback', set: 'Heavy', play_name: 'Power O', family: 'Power', type: 'RUN' }),
      normalizeImportedPlay({ team: 'KC', formation: 'Singleback', set: 'Heavy', play_name: 'PA Power Pass', family: 'Play Action', type: 'PA' }),
      normalizeImportedPlay({ team: 'KC', formation: 'Gun', set: 'Spread', play_name: 'Four Verticals', family: 'Four Verticals', type: 'PASS' }),
      normalizeImportedPlay({ team: 'KC', formation: 'Gun', set: 'Bunch', play_name: 'Stick Spacing', family: 'Stick', type: 'PASS' }),
      normalizeImportedPlay({ team: 'KC', formation: 'Gun', set: 'Trips', play_name: 'Levels Concept', family: 'Levels', type: 'PASS' }),
      normalizeImportedPlay({ team: 'KC', formation: 'Gun', set: 'Spread', play_name: 'Drive Concept', family: 'Drive', type: 'PASS' }),
      normalizeImportedPlay({ team: 'KC', formation: 'Singleback', set: 'Ace', play_name: 'HB Stretch', family: 'Stretch', type: 'RUN' }),
      normalizeImportedPlay({ team: 'KC', formation: 'Gun', set: 'Bunch', play_name: 'Bootleg Cross', family: 'Boot', type: 'PA' }),
      normalizeImportedPlay({ team: 'KC', formation: 'Singleback', set: 'Ace', play_name: 'Redzone Fade', family: 'Fade', type: 'PASS' })
    ];
    state.recentRunScripts = [];
    autoFillScript();
  `);
  assert.equal(a.run('state.customScriptPlays.length'), 15);
  assert.equal(a.run('state.customScriptActive'), true);

  // Slot 1 should be a run (interior base)
  const slot1 = a.run('state.normalizedPlays.find(p => p.id === state.customScriptPlays[0])');
  assert.equal(slot1.type, 'RUN');

  // Slot 5 should be a PA payoff
  const slot5 = a.run('state.normalizedPlays.find(p => p.id === state.customScriptPlays[4])');
  assert.equal(slot5.type, 'PA');
});

test('Two-game cooldown: excludes plays from the last 2 executed scripts, respects preview re-clicks', () => {
  const a = app();
  a.run(`
    state.selectedTeam = 'SF';
    // Create 18 distinct plays
    state.normalizedPlays = [];
    for (let i = 0; i < 20; i++) {
      state.normalizedPlays.push(normalizeImportedPlay({
        team: 'SF',
        formation: 'Gun',
        set: 'Set' + i,
        play_name: 'Play ' + i,
        family: i % 2 === 0 ? 'Inside Zone' : 'Quick Game',
        type: i % 2 === 0 ? 'RUN' : 'PASS'
      }));
    }

    // 1. Preview autofill does not log into recentRunScripts
    state.recentRunScripts = [];
    state.customScriptLoggedToHistory = false;
    autoFillScript();
  `);
  assert.equal(a.run('state.recentRunScripts.length'), 0);

  // 2. Simulate live play confirmation while script is active
  a.run(`
    state.confirmedPlayUsage = {
      play: state.normalizedPlays.find(p => p.id === state.customScriptPlays[0]),
      scriptMatch: true
    };
    commitConfirmedPlayUsage();
  `);
  assert.equal(a.run('state.recentRunScripts.length'), 1);
  const script1Ids = a.run('state.recentRunScripts[0]');
  assert.equal(script1Ids.length, 15);

  // 3. Confirming another play in the same game does NOT duplicate the script in history
  a.run(`
    state.confirmedPlayUsage = {
      play: state.normalizedPlays.find(p => p.id === state.customScriptPlays[1]),
      scriptMatch: true
    };
    commitConfirmedPlayUsage();
  `);
  assert.equal(a.run('state.recentRunScripts.length'), 1);

  // 4. Starting a new game resets the flag so a new script can be logged
  a.run(`
    confirmNewGame('normal');
  `);
  assert.equal(a.run('state.customScriptLoggedToHistory'), false);
  // recentRunScripts persists across games
  assert.equal(a.run('state.recentRunScripts.length'), 1);
});



