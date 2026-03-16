import { chromium } from 'playwright';
import { readFileSync, mkdirSync, existsSync, writeFileSync } from 'fs';
import { resolve, join } from 'path';

const ROOT = resolve(import.meta.dirname, '..');
const CONFIG_PATH = join(ROOT, '.app-screens.json');
const OUTPUT_DIR = join(ROOT, 'public', 'data', 'captures');

if (!existsSync(CONFIG_PATH)) {
  console.error('\n  Missing .app-screens.json in repo root.');
  console.error('  Copy .app-screens.example.json and fill in your app details.\n');
  process.exit(1);
}

const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
const baseUrl = config.appUrl.replace(/\/$/, '');
const viewport = config.viewport || { width: 390, height: 844 };
const extraDismissSelectors = config.dismissSelectors || [];

mkdirSync(OUTPUT_DIR, { recursive: true });

// Safe navigation that won't crash on timeout
async function safeGoto(page, url, waitMs = 3000) {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
  } catch {
    // If domcontentloaded times out, the page might still be usable
  }
  await page.waitForTimeout(waitMs);
}

// Dismiss any promo modals, popups, toasts, or overlay dialogs
async function dismissModals(page) {
  // Try Escape a few times first (works for most overlay/modal patterns)
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
  }

  const dismissed = await page.evaluate((extraSelectors) => {
    let closed = 0;

    function walkAndDismiss(root) {
      if (!root) return;
      const els = root.querySelectorAll('*');
      for (const el of els) {
        if (el.shadowRoot) walkAndDismiss(el.shadowRoot);
      }

      const closeSelectors = [
        '[aria-label="Close"]', '[aria-label="close"]',
        '[aria-label="Dismiss"]', '[aria-label="dismiss"]',
        '[aria-label="Close dialog"]', '[aria-label="Close modal"]',
        '.close-button', '.close-btn', '.modal-close', '.toast-close',
        '.dismiss', '.notification-close',
        '[data-dismiss]', '[data-close]', '[data-action="close"]',
        ...extraSelectors,
      ];
      for (const sel of closeSelectors) {
        for (const btn of root.querySelectorAll(sel)) {
          const rect = btn.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            btn.click();
            closed++;
          }
        }
      }

      // Buttons/links with dismiss-like text
      const dismissText = [
        'close', 'dismiss', 'not now', 'no thanks', 'skip',
        'maybe later', 'got it', 'ok', 'cancel', 'x',
      ];
      for (const el of root.querySelectorAll('button, a, [role="button"]')) {
        const text = el.textContent.trim().toLowerCase();
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        if (dismissText.includes(text)) {
          el.click();
          closed++;
        }
      }
    }

    walkAndDismiss(document);
    return closed;
  }, extraDismissSelectors);

  if (dismissed > 0) {
    console.log(`    ⤷ Dismissed ${dismissed} modal(s)/popup(s).`);
    await page.waitForTimeout(800);
  }
}

async function runLoginSteps(page, steps) {
  for (const step of steps) {
    switch (step.action) {
      case 'fill': {
        const el = await page.waitForSelector(step.selector, { timeout: 10000 });
        await el.fill(step.value);
        break;
      }
      case 'click': {
        const el = await page.waitForSelector(step.selector, { timeout: 10000 });
        await el.click();
        break;
      }
      case 'submit': {
        await page.keyboard.press('Enter');
        await page.waitForTimeout(1000);
        break;
      }
      case 'wait': {
        await page.waitForTimeout(step.ms || 2000);
        break;
      }
      case 'waitForUrl': {
        await page.waitForURL(step.pattern || '**/*', { timeout: step.timeout || 15000 });
        break;
      }
      default:
        console.warn(`  Unknown login step action: ${step.action}`);
    }
  }
}

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

function groupFromPath(urlPath) {
  const segments = urlPath.replace(/^\//, '').split('/').filter(Boolean);
  return segments[0] || 'home';
}

function dedupeFilename(name, usedNames) {
  if (!name) name = 'screen';
  let candidate = name;
  let counter = 2;
  while (usedNames.has(candidate)) {
    candidate = `${name}-${counter}`;
    counter++;
  }
  usedNames.add(candidate);
  return candidate;
}

async function captureCurrentPage(page, name, usedNames, screens) {
  const url = page.url();
  const path = new URL(url).pathname;
  const dedupedName = dedupeFilename(name, usedNames);
  const filename = `${dedupedName}.png`;

  await page.screenshot({ path: join(OUTPUT_DIR, filename), fullPage: true });
  screens.push({
    name: dedupedName,
    file: filename,
    group: groupFromPath(path),
    path,
    url,
    capturedAt: new Date().toISOString()
  });
  console.log(`    ✓ Saved ${filename}`);
}

async function getAllClickableItems(page, origin) {
  return page.evaluate((origin) => {
    const items = [];
    const seen = new Set();
    const skipText = ['logout', 'sign out', 'log out', 'enroll', 'sign up', 'recaptcha', 'skip to main'];

    function walkTree(root) {
      if (!root) return;
      const elements = root.querySelectorAll('*');
      for (const el of elements) {
        const tag = el.tagName.toLowerCase();

        if (el.shadowRoot) {
          walkTree(el.shadowRoot);
        }

        const rect = el.getBoundingClientRect();
        const isVisible = rect.width > 0 && rect.height > 0;
        if (!isVisible) continue;

        const isLink = tag === 'a' && el.getAttribute('href');
        const isButton = tag === 'button';
        const hasRole = ['link', 'tab', 'menuitem', 'button'].includes(el.getAttribute('role'));

        if (!isLink && !isButton && !hasRole) continue;

        const text = el.textContent.trim().replace(/\s+/g, ' ').slice(0, 80);
        if (skipText.some(s => (text || '').toLowerCase().includes(s))) continue;

        const href = el.getAttribute('href') || null;

        if (href && (href.startsWith('tel:') || href.startsWith('mailto:'))) continue;
        if (href && href.startsWith('http') && !href.startsWith(origin)) continue;

        const key = href ? `href:${href}` : `xy:${Math.round(rect.x)}:${Math.round(rect.y)}`;
        if (seen.has(key)) continue;
        seen.add(key);

        items.push({
          type: isLink ? 'link' : 'click',
          href,
          label: text || '(unlabeled)',
          x: Math.round(rect.x + rect.width / 2),
          y: Math.round(rect.y + rect.height / 2),
        });
      }
    }

    walkTree(document);
    return items;
  }, origin);
}

async function discoverScreens(page, baseOrigin) {
  const visitedUrls = new Set();
  const visitedPaths = new Set();
  const screens = [];
  const usedNames = new Set();
  const homeUrl = page.url();
  const homePath = new URL(homeUrl).pathname;

  console.log(`  Capturing landing page: ${homePath}`);
  await page.waitForTimeout(2000);
  await dismissModals(page);
  visitedUrls.add(homeUrl);
  visitedPaths.add(homePath);
  await captureCurrentPage(page, 'home', usedNames, screens);

  const allItems = await getAllClickableItems(page, baseOrigin);
  console.log(`\n  Found ${allItems.length} clickable elements total.`);

  const navItems = allItems.filter(item => {
    if (item.type !== 'link' || !item.href) return false;
    const uuidPattern = /[0-9a-f]{8}-[0-9a-f]{4}/;
    if (uuidPattern.test(item.href)) return false;
    const pathOnly = item.href.split('?')[0];
    if (visitedPaths.has(pathOnly)) return false;
    return true;
  });

  const hamburger = allItems.find(item =>
    item.type === 'click' && item.label === '(unlabeled)' && item.x < 60 && item.y < 200
  );

  console.log(`  Filtered to ${navItems.length} navigation links.`);
  if (hamburger) console.log(`  Found hamburger menu button at (${hamburger.x}, ${hamburger.y}).`);
  console.log('');

  if (hamburger) {
    console.log(`  Opening hamburger menu...`);
    await page.mouse.click(hamburger.x, hamburger.y);
    await page.waitForTimeout(2000);

    await captureCurrentPage(page, 'menu', usedNames, screens);

    const menuItems = await getAllClickableItems(page, baseOrigin);
    const newMenuLinks = menuItems.filter(item => {
      if (item.type !== 'link' || !item.href) return false;
      if (item.href.startsWith('tel:') || item.href.startsWith('mailto:')) return false;
      const uuidPattern = /[0-9a-f]{8}-[0-9a-f]{4}/;
      if (uuidPattern.test(item.href)) return false;
      const pathOnly = item.href.split('?')[0];
      if (visitedPaths.has(pathOnly)) return false;
      if (navItems.some(n => n.href === item.href)) return false;
      return true;
    });

    if (newMenuLinks.length > 0) {
      console.log(`  Found ${newMenuLinks.length} new links in menu.\n`);
      navItems.push(...newMenuLinks);
    }

    // Close menu and go home
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    await safeGoto(page, homeUrl, 3000);
    await dismissModals(page);
  }

  for (let i = 0; i < navItems.length; i++) {
    const item = navItems[i];
    const pathOnly = item.href.split('?')[0];

    if (visitedPaths.has(pathOnly)) {
      console.log(`  [${i + 1}/${navItems.length}] "${item.label}" → ${item.href} (already visited)`);
      continue;
    }

    console.log(`  [${i + 1}/${navItems.length}] "${item.label}" → ${item.href}`);
    visitedPaths.add(pathOnly);

    try {
      const targetUrl = item.href.startsWith('http')
        ? item.href
        : `${baseOrigin}${item.href}`;

      await safeGoto(page, targetUrl, 3000);
      await dismissModals(page);

      const currentUrl = page.url();
      if (currentUrl.includes('/login') || currentUrl.includes('/sign-in')) {
        console.log(`    ⤷ Redirected to login, skipping.`);
        await safeGoto(page, homeUrl, 2000);
        continue;
      }

      visitedUrls.add(currentUrl);
      const name = slugify(item.label !== '(unlabeled)' ? item.label : pathOnly) || `screen-${i}`;
      await captureCurrentPage(page, name, usedNames, screens);

      const subItems = await getAllClickableItems(page, baseOrigin);
      const newSubs = subItems.filter(si => {
        if (si.type !== 'link' || !si.href) return false;
        if (si.href.startsWith('tel:') || si.href.startsWith('mailto:')) return false;
        const uuidPattern = /[0-9a-f]{8}-[0-9a-f]{4}/;
        if (uuidPattern.test(si.href)) return false;
        const sp = si.href.split('?')[0];
        if (visitedPaths.has(sp)) return false;
        if (navItems.some(n => n.href === si.href)) return false;
        return true;
      });

      if (newSubs.length > 0) {
        console.log(`    ⤷ Found ${newSubs.length} sub-links.`);
        navItems.push(...newSubs);
      }

      await safeGoto(page, homeUrl, 2000);
      await dismissModals(page);
    } catch (err) {
      console.log(`    ⤷ Failed: ${err.message.slice(0, 120)}`);
      try {
        await safeGoto(page, homeUrl, 2000);
      } catch { /* give up */ }
    }
  }

  return screens;
}

async function captureExplicitScreens(page, screens) {
  const manifest = [];
  const total = screens.length;

  for (let i = 0; i < total; i++) {
    const screen = screens[i];
    const url = screen.path.startsWith('http')
      ? screen.path
      : `${baseUrl}${screen.path}`;

    console.log(`  [${i + 1}/${total}] ${screen.name} → ${url}`);
    await safeGoto(page, url, 3000);
    await dismissModals(page);

    if (screen.waitFor) {
      try { await page.waitForSelector(screen.waitFor, { timeout: 10000 }); } catch {}
    }
    if (screen.delay) {
      await page.waitForTimeout(screen.delay);
    }

    const filename = `${screen.name}.png`;
    await page.screenshot({ path: join(OUTPUT_DIR, filename), fullPage: true });

    manifest.push({
      name: screen.name,
      file: filename,
      group: screen.group || groupFromPath(screen.path),
      path: screen.path,
      capturedAt: new Date().toISOString()
    });
  }

  return manifest;
}

async function main() {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();

  if (config.login) {
    const loginUrl = config.login.url.startsWith('http')
      ? config.login.url
      : `${baseUrl}${config.login.url}`;

    console.log(`\n  Logging in at ${loginUrl}`);
    await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(2000);
    await runLoginSteps(page, config.login.steps);

    if (page.url().includes('/login')) {
      console.log('\n  ⏳ Waiting for you to complete login (MFA, etc) in the browser window...');
      console.log('  The script will continue automatically once you\'re past the login page.\n');
      await page.waitForURL(url => !url.toString().includes('/login'), { timeout: 120000 });
    }

    await page.waitForTimeout(5000);
    console.log(`  ✓ Logged in. Now at: ${page.url()}\n`);
    await dismissModals(page);
  }

  let captures;

  if (config.discover) {
    console.log('  Discovery mode: finding screens by clicking through the app...\n');
    captures = await discoverScreens(page, baseUrl);
  } else {
    captures = await captureExplicitScreens(page, config.screens || []);
  }

  const manifestPath = join(OUTPUT_DIR, 'manifest.json');
  writeFileSync(manifestPath, JSON.stringify({ viewport, captures }, null, 2));

  await browser.close();

  console.log(`\n  ✓ Done! ${captures.length} screenshots saved to public/data/captures/`);
  console.log(`  Manifest: public/data/captures/manifest.json\n`);
}

main().catch(err => {
  console.error('\n  Capture failed:', err.message, '\n');
  process.exit(1);
});
