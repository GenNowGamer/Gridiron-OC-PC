const fs = require('fs');
const path = require('path');

const SelectionEngine = require('../shared/selectionEngine.js');
global.SelectionEngine = SelectionEngine;
const DefenseRecommendationCore = require('../shared/defenseRecommendationCore.js');

const defensivePlays = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../defensive_plays.json'), 'utf8')
);

const chiPlays = defensivePlays.filter(p => p.team === 'CHI');
const scrimmagePlays = chiPlays.filter(p => !DefenseRecommendationCore.defensivePlayTraitsOf(p).isSpecialTeams);
console.log(`Total CHI Scrimmage Plays: ${scrimmagePlays.length}`);

const downs = [1, 2, 3, 4];
const distances = [1, 2, 4, 7, 10, 15, 20];
const fieldPositions = [
  { side: 'OWN', yardLine: 5 },
  { side: 'OWN', yardLine: 25 },
  { side: 'MIDFIELD', yardLine: 50 },
  { side: 'OPP', yardLine: 35 },
  { side: 'OPP', yardLine: 12 },
  { side: 'OPP', yardLine: 3 }
];
const offensiveShowings = [
  null,
  { formation: 'SHOTGUN', set: 'TREY OPEN' },
  { formation: 'SINGLEBACK', set: 'DOUBLES' },
  { formation: 'I FORM', set: 'PRO' },
  { formation: 'SHOTGUN', set: 'BUNCH' },
  { formation: 'EMPTY', set: 'SPREAD' },
  { formation: 'GOAL LINE', set: 'HEAVY' }
];

function runSimulation(numGames = 20, snapsPerGame = 48) {
  const surfacedPlays = new Set();
  const playShowFrequencies = {};
  const packageShowFrequencies = {};

  for (let g = 0; g < numGames; g++) {
    const dcSessionPlayShowCounts = {};
    const dcSessionPackageShowCounts = {};
    const recentPlayIds = [];
    const recentPackageKeys = [];
    const exposurePackageKeys = [];

    for (let s = 0; s < snapsPerGame; s++) {
      const down = downs[s % downs.length];
      const yards = distances[(s * 3) % distances.length];
      const fieldPosition = fieldPositions[(s + g) % fieldPositions.length];
      const goalToGo = fieldPosition.side === 'OPP' && fieldPosition.yardLine <= 10;
      const offenseShowing = offensiveShowings[(s + g * 2) % offensiveShowings.length];

      const res = DefenseRecommendationCore.computeDefensivePackageRecommendations({
        plays: chiPlays,
        down,
        yards,
        goalToGo,
        fieldPosition,
        offenseShowing,
        opponent: 'GB',
        recentPlayIds,
        recentPackageKeys,
        exposurePackageKeys,
        sessionPlayShowCounts: dcSessionPlayShowCounts,
        sessionPackageShowCounts: dcSessionPackageShowCounts
      });

      const top = res.recommendations || [];
      top.forEach(pkg => {
        if (pkg.packageKey) {
          packageShowFrequencies[pkg.packageKey] = (packageShowFrequencies[pkg.packageKey] || 0) + 1;
          dcSessionPackageShowCounts[pkg.packageKey] = (dcSessionPackageShowCounts[pkg.packageKey] || 0) + 1;
          exposurePackageKeys.push(pkg.packageKey);
        }
        const exId = pkg.examplePlayId || (pkg.examplePlay && pkg.examplePlay.id);
        const exName = pkg.examplePlayName || (pkg.examplePlay && pkg.examplePlay.play_name);
        if (exId) {
          surfacedPlays.add(exId);
          playShowFrequencies[exName] = (playShowFrequencies[exName] || 0) + 1;
          dcSessionPlayShowCounts[exId] = (dcSessionPlayShowCounts[exId] || 0) + 1;
        }
      });

      if (top[0]) {
        recentPackageKeys.push(top[0].packageKey);
        if (recentPackageKeys.length > 12) recentPackageKeys.shift();
        const calledPlayId = top[0].examplePlayId || (top[0].examplePlay && top[0].examplePlay.id);
        if (calledPlayId) {
          recentPlayIds.push(calledPlayId);
          if (recentPlayIds.length > 12) recentPlayIds.shift();
        }
      }
    }
  }

  return {
    totalSnaps: numGames * snapsPerGame,
    distinctPlaysSurfaced: surfacedPlays.size,
    playSurfaceRate: ((surfacedPlays.size / scrimmagePlays.length) * 100).toFixed(1) + '%',
    topPlays: Object.entries(playShowFrequencies)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10),
    topPackages: Object.entries(packageShowFrequencies)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
  };
}

const audit = runSimulation();
console.log('--- POST-PATCH DC VARIETY AUDIT ---');
console.log(JSON.stringify(audit, null, 2));
