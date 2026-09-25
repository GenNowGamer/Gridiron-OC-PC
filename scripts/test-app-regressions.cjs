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
  assert.equal(a.run('state.pendingOutcome'), null);
  assert.equal(a.run('Object.keys(state.userLearning.global.plays)[0]'), audible);
  assert.equal(a.run('state.presentedRecommendations.length'), 3);
});
