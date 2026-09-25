'use strict';
// Isolated Electron smoke: real main/preload/renderer, hidden window, disposable profile.
// Run with the Electron executable; optional --bundle=<absolute app.asar path>.
const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const bundle = process.argv.find(arg => arg.startsWith('--bundle='));
const root = bundle ? bundle.slice('--bundle='.length) : path.resolve(__dirname, '..');
const profile = path.resolve(__dirname, '..', '.cache', `desktop-smoke-${Date.now()}`);
fs.mkdirSync(profile, { recursive: true });
app.setPath('userData', profile);
app.disableHardwareAcceleration();
let done = false;
function finish(code, value) {
  if (done) return;
  done = true;
  fs.writeFileSync(path.join(profile, 'result.json'), JSON.stringify(value, null, 2));
  console.log(JSON.stringify(value));
  app.exit(code);
}
const timeout = setTimeout(() => finish(1, { error: 'Desktop smoke timed out' }), 60000);
app.on('web-contents-created', (_event, contents) => {
  contents.on('render-process-gone', (_e, details) => finish(1, { error: 'renderer exited', details }));
  contents.on('did-finish-load', async () => {
    try {
      const result = await contents.executeJavaScript(`(async () => {
        const until=Date.now()+20000;
        while((!state.normalizedPlays.length || !state.normalizedDefensivePlays.length) && Date.now()<until)await new Promise(r=>setTimeout(r,50));
        if(!state.normalizedPlays.length || !state.normalizedDefensivePlays.length)throw Error('Catalogs did not load');
        confirmNewGame('normal');
        await processTranscript('1st and 10 on my own 25');
        if(state.presentedRecommendations.length!==3)throw Error('OC sheet missing');
        confirmRecommendedPlay(state.presentedRecommendations[0].play.id);
        applyPenalty('offensive_holding');
        applyDriveResultAndReset('punt');
        if(Object.keys(state.userLearning.global.plays).length)throw Error('Penalty trained learning');
        setCoordinatorRole('dc');
        await processTranscript('3rd and 7 on my own 40');
        if(!state.presentedDcPackages.length)throw Error('DC packages missing');
        setCoordinatorRole('oc');
        await processTranscript('2nd and 5 on my own 30');
        if(state.presentedRecommendations.length!==3)throw Error('OC return sheet missing');
        await window.desktopApi.ocrResetSession({reason:'smoke_complete'});
        // Let asynchronous role/context IPC finish before shutting Electron down.
        await new Promise(resolve=>setTimeout(resolve,300));
        const ocr=await window.desktopApi.ocrGetStatus();
        if(ocr.lastCapture!==null)throw Error('OCR reset failed');
        return {offensivePlays:state.normalizedPlays.length,defensivePlays:state.normalizedDefensivePlays.length,
          ocCalls:state.presentedRecommendations.length,dcPackages:state.presentedDcPackages.length,
          penaltySafe:true,ocrReset:true,title:document.title};
      })()`);
      // Exercise the real renderer -> preload -> main call/penalty bridge using
      // synthetic OCR fields in this disposable profile (no capture hardware).
      await contents.executeJavaScript(`(async()=>{setCoordinatorRole('dc');await new Promise(r=>setTimeout(r,300));})()`);
      const manager = main.exports.smokeOcrManager();
      await manager.updateConfig({ exactCallsEnabled: true, learningEnabled: true });
      await new Promise(resolve => setTimeout(resolve,300));
      const context = manager.store.get().config.context;
      const emitCapture = async (id, down, spot, defense) => {
        const roi = value => ({ text: value, confidence: 0.99, agreement: 1 });
        const fields = await manager._resolveFields({ down_distance: roi(down), field_position: roi(spot),
          offense_formation_personnel: roi('1RB - 1TE 3WR'), previous_offense_play: roi('--'),
          previous_defense_play: roi(defense || '--') }, context);
        const capture = { id, at: Date.now(), fields, scoreboard: context, validation: { accepted: true }, timing: {} };
        capture.learningRecorded = await manager._reconcileSnap(capture, context, manager.store.get());
        manager.lastCapture = capture;
        manager._emit('capture:complete', { capture });
        await new Promise(resolve => setTimeout(resolve,300));
      };
      await emitCapture('smoke-first', '1st & 10', 'OWN 25');
      await contents.executeJavaScript(`(()=>{
        if(state.presentedOcrExactPlays.length!==3)throw Error('OCR exact sheet missing');
        confirmOcrExactPlay(state.presentedOcrExactPlays[0].play.id);
        applyDcPenalty('offensive_holding');
      })()`);
      await new Promise(resolve => setTimeout(resolve,300));
      if(manager.pendingSnap?.penalty?.id!=='offensive_holding')throw Error('DC penalty did not cross IPC');
      const called = manager.pendingSnap.confirmedPlay;
      if(!called?.id)throw Error('Confirmed DC call did not cross IPC');
      await emitCapture('smoke-next', '1st & 20', 'OWN 15', called.play_name);
      const events = await manager.ledger.readEvents();
      const learned = events.at(-1)?.payload?.learningEvent;
      if(learned?.verification?.learningEligible!==false || learned?.outcome?.learnable!==false)throw Error('DC penalty taught learning');
      if(learned?.defense?.playId!==called.id)throw Error('Confirmed formation identity lost');
      await contents.executeJavaScript(`(()=>{
        if(state.dcPendingPenalty || getOcrExactCallState().sheetConfirmed)throw Error('DC call leaked into next snap');
        confirmOcrExactPlay(state.presentedOcrExactPlays[0].play.id);
      })()`);
      await new Promise(resolve => setTimeout(resolve,300));
      if(manager.pendingSnap.penalty)throw Error('DC penalty carried to next confirm');
      const audibleId = await contents.executeJavaScript(`(()=>{
        const base=state.confirmedDcBasePlay;
        const audible=state.normalizedDefensivePlays.find(p=>p.team===state.selectedTeam&&formationSetKeyOf(p)===formationSetKeyOf(base)&&p.play_name!==base.play_name);
        if(!audible)throw Error('No audible candidate');
        applyDcAudiblePlay(audible.id);
        return audible.id;
      })()`);
      await new Promise(resolve => setTimeout(resolve,300));
      const canonicalAudibleId = audibleId.split('|').map(part=>part.toLowerCase().replace(/[^a-z0-9]+/g,'-')).join('|');
      if(manager.pendingSnap.confirmedPlay.id!==canonicalAudibleId)throw Error('Audible identity did not cross IPC: '+manager.pendingSnap.confirmedPlay.id+' / '+canonicalAudibleId);
      result.dcPenaltyBridge = true;
      result.dcExactIdentity = true;
      result.dcNextSnapCleared = true;
      result.dcAudibleBridge = true;
      clearTimeout(timeout);
      finish(0, { passed: true, result, profile, bundle: root });
    } catch (error) { finish(1, { error: error.stack || String(error) }); }
  });
});
// Only window visibility changes in memory; packaged source remains untouched.
const mainPath = path.join(root, 'main.js');
let source = fs.readFileSync(mainPath, 'utf8');
if (!source.includes('new BrowserWindow({')) throw new Error('Window constructor not found');
source = source.replace('new BrowserWindow({', 'new BrowserWindow({ show: false,');
const main = new Module(mainPath, module);
main.filename = mainPath;
main.paths = Module._nodeModulePaths(root);
main._compile(source + '\nmodule.exports.smokeOcrManager = () => ocrManager;\n', mainPath);
