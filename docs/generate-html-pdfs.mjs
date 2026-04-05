import puppeteer from 'puppeteer';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const files = [
  'quoth-business-ES',
  'quoth-business-EN',
  'quoth-technical-v3.2-ES',
  'quoth-technical-v3.2-EN',
];

async function main() {
  const browser = await puppeteer.launch({
    executablePath: '/home/lord_montino/.nix-profile/bin/chromium-browser',
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  for (const name of files) {
    const htmlPath = path.join(__dirname, `${name}.html`);
    const pdfPath = path.join(__dirname, `${name}.pdf`);

    const page = await browser.newPage();
    await page.goto(`file://${htmlPath}`, { waitUntil: 'networkidle0' });
    await page.pdf({
      path: pdfPath,
      format: 'A4',
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
      printBackground: true,
    });
    await page.close();
    console.log(`Generated: ${name}.pdf`);
  }

  await browser.close();
  console.log('Done!');
}

main().catch(err => { console.error(err); process.exit(1); });
