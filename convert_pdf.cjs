const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const htmlPath = path.resolve(__dirname, 'USER_GUIDE.html');
const pdfPath = path.resolve(__dirname, 'USER_GUIDE.pdf');

console.log('Generating PDF from:', htmlPath);
console.log('Output target:', pdfPath);

const fileUrl = 'file:///' + htmlPath.replace(/\\/g, '/');

const args = [
  '--headless',
  '--disable-gpu',
  '--no-pdf-header-footer',
  '--run-all-compositor-stages-before-draw',
  '--print-to-pdf=' + pdfPath,
  fileUrl
];

const res = spawnSync(edgePath, args, { encoding: 'utf8' });
if (res.error) {
  console.error('Execution error:', res.error);
  process.exit(1);
}

if (fs.existsSync(pdfPath)) {
  const stat = fs.statSync(pdfPath);
  console.log('Successfully generated USER_GUIDE.pdf! Size:', stat.size, 'bytes');
} else {
  console.error('Failed to generate PDF. Stderr:', res.stderr);
  process.exit(1);
}
