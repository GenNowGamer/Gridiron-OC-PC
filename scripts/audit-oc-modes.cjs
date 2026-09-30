const fs = require('fs');
const path = require('path');
const { app } = require('./test-app-regressions.cjs');

const a = app();
a.catalog = JSON.parse(fs.readFileSync(path.join(__dirname, '../plays.json'), 'utf8'));

// Initialize plays & team
a.run(`
  state.normalizedPlays = catalog.map(normalizeImportedPlay);
  state.selectedTeam = 'CHI';
  state.selectedOpponent = 'GB';
  state.gameStarted = true;
  state.hasActiveSituation = true;
`);

const MODES = [
  { id: 'two_minute', label: '2 Minute Drill', defaultSpot: { down: 2, yards: 8, goalToGo: false, fieldPosition: { side: 'OPP', yardLine: 40 }, quarter: 4, userScore: 20, oppScore: 24 } },
  { id: 'kill_clock', label: 'Kill Clock', defaultSpot: { down: 2, yards: 4, goalToGo: false, fieldPosition: { side: 'OWN', yardLine: 45 }, quarter: 4, userScore: 24, oppScore: 20 } },
  { id: 'comeback', label: 'Comeback', defaultSpot: { down: 2, yards: 10, goalToGo: false, fieldPosition: { side: 'OWN', yardLine: 30 }, quarter: 4, userScore: 14, oppScore: 28 } },
  { id: 'blitz_beater', label: 'Blitz Beater', defaultSpot: { down: 3, yards: 6, goalToGo: false, fieldPosition: { side: 'OPP', yardLine: 48 }, lastDefenseShown: 'Blitz' } },
  { id: 'redzone', label: 'Redzone', defaultSpot: { down: 2, yards: 5, goalToGo: false, fieldPosition: { side: 'OPP', yardLine: 12 } } },
];

function runModeAudit(modeConfig, numGames = 20, snapsPerGame = 48) {
  const modeId = modeConfig.id;
  
  // First, find how many plays in the CHI playbook actually fit this mode
  const eligibleFittingPlays = a.run(`
    (() => {
      const plays = state.normalizedPlays.filter(p => p.team === 'CHI' && !isHailMaryPlay(p));
      const fitting = plays.filter(p => {
        const traits = playTraitsOf(p);
        const ctx = {
          playcallingMode: '${modeId}',
          down: ${modeConfig.defaultSpot.down},
          yards: ${modeConfig.defaultSpot.yards},
          goalToGo: ${modeConfig.defaultSpot.goalToGo || false},
          fieldPosition: ${JSON.stringify(modeConfig.defaultSpot.fieldPosition || { side: 'OWN', yardLine: 25 })},
          coordinatorPlan: { fieldPositionBucket: '${modeId === 'redzone' ? 'red_zone' : 'midfield'}' }
        };
        const adj = playcallingModeAdjustment(p, ctx, traits);
        return adj > 0.5;
      });
      return {
        totalChi: plays.length,
        fittingCount: fitting.length,
        fittingIds: fitting.map(p => p.id)
      };
    })()
  `);

  // Run multi-game simulation
  const simResults = a.run(`
    (() => {
      const mode = '${modeId}';
      state.playcallingMode = mode;
      const surfacedPlays = new Set();
      const playShowFrequencies = {};
      const familyShowFrequencies = {};
      const slotDistribution = { slot1: {}, slot2: {}, slot3: {} };

      const downs = [1, 2, 3, 4];
      const distances = [2, 4, 7, 10, 15];
      const fieldPositions = ${modeId === 'redzone' ? JSON.stringify([
        { side: 'OPP', yardLine: 18 },
        { side: 'OPP', yardLine: 12 },
        { side: 'OPP', yardLine: 7 },
        { side: 'OPP', yardLine: 4 },
        { side: 'OPP', yardLine: 2 }
      ]) : JSON.stringify([
        { side: 'OWN', yardLine: 20 },
        { side: 'OWN', yardLine: 35 },
        { side: 'MIDFIELD', yardLine: 50 },
        { side: 'OPP', yardLine: 35 },
        { side: 'OPP', yardLine: 20 }
      ])};

      for (let g = 0; g < ${numGames}; g++) {
        // Reset session state like a fresh game
        state.sessionPlayShowCounts = {};
        state.recentPlays = [];
        state.recentCalls = [];
        state.recentGameCalls = [];
        state.recommendationExposureHistory = [];
        state.driveRecommendationExposure = [];
        state.typeHist = [];
        state.lastCalls = [];
        state.scriptStep = 0;
        state.scriptIndex = 0;

        for (let s = 0; s < ${snapsPerGame}; s++) {
          state.down = downs[s % downs.length];
          state.yards = distances[(s * 2) % distances.length];
          state.fieldPosition = fieldPositions[(s + g) % fieldPositions.length];
          state.goalToGo = state.fieldPosition.side === 'OPP' && state.fieldPosition.yardLine <= 5;
          state.quarter = ${modeConfig.defaultSpot.quarter || 2};
          state.userScore = ${modeConfig.defaultSpot.userScore || 14};
          state.oppScore = ${modeConfig.defaultSpot.oppScore || 14};
          state.lastDefenseShown = '${modeConfig.defaultSpot.lastDefenseShown || 'Unknown'}';

          computeRecommendations();
          const recs = (state.recommendations || []).slice(0, 3);
          
          recs.forEach((item, idx) => {
            const play = item.play;
            if (!play) return;
            surfacedPlays.add(play.id);
            playShowFrequencies[play.play_name] = (playShowFrequencies[play.play_name] || 0) + 1;
            const fam = familyOf(play);
            familyShowFrequencies[fam] = (familyShowFrequencies[fam] || 0) + 1;
            
            const slotKey = 'slot' + (idx + 1);
            slotDistribution[slotKey][play.play_name] = (slotDistribution[slotKey][play.play_name] || 0) + 1;
          });

          // Simulate user confirming slot 1 or 2
          if (recs[0] && recs[0].play) {
            confirmRecommendedPlay(recs[0].play.id);
            onGetPlays();
          }
        }
      }

      return {
        distinctPlaysSurfaced: surfacedPlays.size,
        surfacedPlayIds: Array.from(surfacedPlays),
        topPlays: Object.entries(playShowFrequencies).sort((a,b)=>b[1]-a[1]).slice(0, 10),
        topFamilies: Object.entries(familyShowFrequencies).sort((a,b)=>b[1]-a[1]).slice(0, 8),
      };
    })()
  `);

  const fittingSet = new Set(eligibleFittingPlays.fittingIds);
  let surfacedFittingCount = 0;
  for (const id of simResults.surfacedPlayIds) {
    if (fittingSet.has(id)) surfacedFittingCount++;
  }

  return {
    mode: modeId,
    label: modeConfig.label,
    totalPlaybookPlays: eligibleFittingPlays.totalChi,
    fittingPlaysInPlaybook: eligibleFittingPlays.fittingCount,
    distinctPlaysSurfaced: simResults.distinctPlaysSurfaced,
    distinctFittingPlaysSurfaced: surfacedFittingCount,
    fittingPlaySurfaceRate: eligibleFittingPlays.fittingCount > 0 ? ((surfacedFittingCount / eligibleFittingPlays.fittingCount) * 100).toFixed(1) + '%' : 'N/A',
    overallPlaybookSurfaceRate: ((simResults.distinctPlaysSurfaced / eligibleFittingPlays.totalChi) * 100).toFixed(1) + '%',
    topPlays: simResults.topPlays,
    topFamilies: simResults.topFamilies
  };
}

console.log('====================================================');
console.log('   OC PLAYCALLING MODES VARIETY & UTILIZATION AUDIT  ');
console.log('====================================================\n');

for (const m of MODES) {
  const result = runModeAudit(m);
  console.log(`MODE: ${result.label.toUpperCase()} (${result.mode})`);
  console.log(`  - Total CHI Playbook Plays: ${result.totalPlaybookPlays}`);
  console.log(`  - Plays that Fit ${result.label}: ${result.fittingPlaysInPlaybook}`);
  console.log(`  - Distinct Plays Surfaced: ${result.distinctPlaysSurfaced} (${result.overallPlaybookSurfaceRate} of full playbook)`);
  console.log(`  - Fitting Plays Surfaced: ${result.distinctFittingPlaysSurfaced} / ${result.fittingPlaysInPlaybook} (${result.fittingPlaySurfaceRate})`);
  console.log(`  - Top Surfaced Plays:`);
  result.topPlays.slice(0, 5).forEach(([name, count]) => {
    console.log(`      * ${name}: ${count} times`);
  });
  console.log(`  - Top Surfaced Concept Families:`);
  result.topFamilies.slice(0, 5).forEach(([fam, count]) => {
    console.log(`      * ${fam}: ${count} times`);
  });
  console.log('----------------------------------------------------\n');
}
