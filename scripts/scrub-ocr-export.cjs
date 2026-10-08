const fs = require('fs');
const path = require('path');
const hud = require('../ocr/shared/hudTextNormalize');

const srcPath = 'C:/Users/rmace/AppData/Roaming/gridiron-play-advisor-pc/trace-logs/gridiron-ocr-export-2026-10-08T13-35-10-101Z.json';
const dstPath = 'C:/Users/rmace/AppData/Roaming/gridiron-play-advisor-pc/trace-logs/gridiron-ocr-export-2026-10-08T13-35-10-101Z.cleaned.json';

console.log('Loading export file from:', srcPath);
const data = JSON.parse(fs.readFileSync(srcPath, 'utf8'));

// Build lookup maps
const snaps = new Map();
const latestCorrections = new Map();

for (const event of data.events || []) {
  if (event.type === 'snap') {
    const id = event.payload?.learningEvent?.id || event.payload?.captureId;
    if (id) snaps.set(id, event);
  } else if (event.type === 'snap_correction') {
    const id = event.payload?.learningEvent?.id || event.payload?.captureId;
    if (id) latestCorrections.set(id, event);
  }
}

console.log(`Found ${snaps.size} snaps and ${latestCorrections.size} unique corrected capture targets.`);

let repairedDecisions = 0;
let repairedDownDistance = 0;
let repairedPreviousPlays = 0;
let repairedPersonnel = 0;
let updatedSnaps = 0;

for (const dec of data.decisions || []) {
  let modified = false;
  const fields = dec.fields || {};

  // Check down_distance
  if (fields.down_distance && (!fields.down_distance.accepted || !fields.down_distance.value) && fields.down_distance.rawText) {
    const parsed = hud.parseDownDistanceText(fields.down_distance.rawText);
    if (parsed.ok) {
      fields.down_distance.value = parsed.label;
      fields.down_distance.accepted = true;
      if (fields.down_distance.acceptanceReasons) {
        fields.down_distance.acceptanceReasons = [...fields.down_distance.acceptanceReasons.filter(r => !r.includes('below_threshold')), 'scrubbed_hud_accept'];
      }
      repairedDownDistance++;
      modified = true;
    }
  }

  // Check previous plays
  for (const pName of ['previous_offense_play', 'previous_defense_play']) {
    const pf = fields[pName];
    if (pf && !pf.accepted && pf.rawText) {
      const repaired = hud.repairPreviousPlayOcrText(pf.rawText);
      if (repaired && repaired !== hud.sanitizeHudText(pf.rawText).toUpperCase().replace(/\s+/g, ' ').trim()) {
        if (!pf.value || typeof pf.value === 'string') {
          pf.value = repaired;
        }
        repairedPreviousPlays++;
        modified = true;
      }
    }
  }

  // Check offense_formation_personnel
  const off = fields.offense_formation_personnel;
  if (off && (!off.accepted || !off.value) && off.rawText) {
    const repPersonnel = hud.repairPersonnelOcrConfusions(off.rawText);
    const parsedPersonnel = hud.parseFormationPersonnelText(off.rawText);
    if (hud.hasValidPersonnelCounts(parsedPersonnel) && (parsedPersonnel.formation || parsedPersonnel.set)) {
      if (!off.accepted && (!off.value || typeof off.value === 'string' || !off.value.formation)) {
        off.value = parsedPersonnel;
        off.accepted = true;
        repairedPersonnel++;
        modified = true;
      }
    }
  }

  if (modified) repairedDecisions++;
}

console.log(`Decisions scrub summary:
- Repaired decisions total: ${repairedDecisions}
- Repaired down_distance fields: ${repairedDownDistance}
- Repaired previous plays: ${repairedPreviousPlays}
- Repaired personnel: ${repairedPersonnel}`);

// Ensure manual corrections take full effect in corresponding snaps
for (const [snapId, corr] of latestCorrections.entries()) {
  const snap = snaps.get(snapId);
  if (snap && corr.payload?.learningEvent) {
    const cLe = corr.payload.learningEvent;
    const sLe = snap.payload.learningEvent;
    
    // Apply manual overrides to base snap event
    if (cLe.offense) sLe.offense = JSON.parse(JSON.stringify(cLe.offense));
    if (cLe.outcome) sLe.outcome = JSON.parse(JSON.stringify(cLe.outcome));
    if (cLe.verification) sLe.verification = JSON.parse(JSON.stringify(cLe.verification));
    updatedSnaps++;
  }
}

console.log(`Synchronized manual correction overrides to ${updatedSnaps} original snap events.`);

// Write the clean scrubbed file
fs.writeFileSync(dstPath, JSON.stringify(data, null, 2), 'utf8');
console.log('Successfully saved cleaned export to:', dstPath);
