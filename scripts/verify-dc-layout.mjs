import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "..");
const html = readFileSync(path.join(root, "index.html"), "utf8");
const dc = html.slice(
  html.indexOf('id="dcWorkspace"'),
  html.indexOf('id="coordinatorOverlay"')
);
const panelCount = dc.split('<section class="panel').length - 1;
console.log("dc panels", panelCount);
console.log(
  "offense inside left column",
  dc.includes("dcHeroPanel") &&
    dc.indexOf("dcOffenseShowingPanel") > dc.indexOf("dcHeroPanel") &&
    dc.indexOf("dcOffenseShowingPanel") < dc.indexOf("dcRecPanel")
);
console.log("ocRec", html.includes('id="ocRecPanel"'));
console.log("sharedTrace", html.includes('id="sharedTraceSection"'));

const s = readFileSync(path.join(root, "app.js"), "utf8");
console.log({
  mount: s.includes("sharedTraceSection.parentElement"),
  dcOpp: s.includes("dcOpponentValue"),
  ocRec: s.includes('ocRecPanel:document.getElementById("ocRecPanel")'),
  dcRec: s.includes('dcRecPanel:document.getElementById("dcRecPanel")'),
});
