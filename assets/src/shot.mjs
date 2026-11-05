// Screenshot a page with Playwright (not a dependency of reachgate; use any local install).
//   PW=/path/to/node_modules/playwright node assets/src/shot.mjs URL OUT [width] [height] [light|dark]
// Without PW, resolves `playwright` from the current directory.
import { createRequire } from 'node:module';

const require = createRequire((process.env.PW ?? process.cwd() + '/node_modules/playwright') + '/');
const { chromium } = require(process.env.PW ? '.' : 'playwright');
const [url, out, w = '1040', h = '900', scheme = 'light'] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: +w, height: +h }, colorScheme: scheme, deviceScaleFactor: 1 });
await page.goto(url);
await page.waitForTimeout(300);
await page.screenshot({ path: out, fullPage: true });
await browser.close();
