// Generates PNG icons from logo.svg for browser favicon and mobile home-screen icons.
// Run once after changing logo.svg: node generate-icons.js
//
// Requires sharp: npm install sharp

const sharp = require('sharp');
const path = require('path');

const input = path.join(__dirname, 'logo2.png');

const icons = [
  { output: 'favicon.png',         size: 32  },
  { output: 'apple-touch-icon.png', size: 180 },
  { output: 'icon-192.png',         size: 192 },
  { output: 'icon-512.png',         size: 512 },
];

(async () => {
  for (const { output, size } of icons) {
    await sharp(input)
      .resize(size, size)
      .png()
      .toFile(path.join(__dirname, output));
    console.log(`✓ ${output} (${size}×${size})`);
  }
  console.log('\nDone. Deploy the project to apply the new icons.');
})();
