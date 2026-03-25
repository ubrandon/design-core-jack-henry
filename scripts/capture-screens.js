import { chromium } from 'playwright';
import { readFileSync, mkdirSync, existsSync, writeFileSync, readdirSync, unlinkSync } from 'fs';
import { resolve, join } from 'path';

const ROOT = resolve(import.meta.dirname, '..');
const SHARED_CONFIG_PATH = join(ROOT, 'public', 'data', 'captures', 'config.json');
const LOCAL_CONFIG_PATH = join(ROOT, '.app-screens.json');
const OUTPUT_DIR = join(ROOT, 'public', 'data', 'captures');
const BROWSER_DATA_DIR = join(ROOT, '.capture-browser-data');

let sharedConfig = {};
let localConfig = {};

if (existsSync(SHARED_CONFIG_PATH)) {
  sharedConfig = JSON.parse(readFileSync(SHARED_CONFIG_PATH, 'utf-8'));
}
if (existsSync(LOCAL_CONFIG_PATH)) {
  localConfig = JSON.parse(readFileSync(LOCAL_CONFIG_PATH, 'utf-8'));
}

const config = { ...sharedConfig, ...localConfig };

if (!config.appUrl) {
  console.error('\n  No app URL configured.');
  console.error('  Either use the Captures page in the browser to enter a URL,');
  console.error('  or create .app-screens.json with { "appUrl": "https://..." }\n');
  process.exit(1);
}

const baseUrl = config.appUrl.replace(/\/$/, '');
const viewport = config.viewport || { width: 390, height: 844 };

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Resolve an href from the page/DOM to an absolute URL (supports subpath deployments and relative links). */
function resolveHref(href, basePageUrl) {
  if (href == null || href === '') return basePageUrl;
  const h = String(href).trim();
  if (/^https?:\/\//i.test(h)) return h;
  if (!basePageUrl) return h;
  try {
    const base = basePageUrl.endsWith('/') ? basePageUrl : `${basePageUrl}/`;
    return new URL(h, base).href;
  } catch {
    try {
      if (h.startsWith('/')) return `${new URL(basePageUrl).origin}${h}`;
    } catch {}
    return h;
  }
}

function urlLooksLikeLoginPage(urlStr) {
  const u = urlStr.toLowerCase();
  return u.includes('/login') || u.includes('/sign-in') || u.includes('/signin') ||
    u.includes('/auth/login') || u.includes('/auth/sign-in') || u.includes('/auth/signin');
}
const extraDismissSelectors = config.dismissSelectors || [];
const SELECT_ALL_KEY = process.platform === 'darwin' ? 'Meta+a' : 'Control+a';
const parallelPages = Math.min(config.parallelPages || 3, 6);
const screenshotType = config.screenshotFormat === 'png' ? 'png' : 'jpeg';
const screenshotQuality = screenshotType === 'jpeg' ? (config.screenshotQuality || 80) : undefined;
const screenshotExt = screenshotType === 'png' ? '.png' : '.jpg';

mkdirSync(OUTPUT_DIR, { recursive: true });

let browserContext = null;

process.on('SIGTERM', () => {
  console.log('\n  Capture cancelled.');
  if (browserContext) browserContext.close().catch(() => {});
  process.exit(0);
});

function writeManifest(newCaptures, replace = false) {
  const manifestPath = join(OUTPUT_DIR, 'manifest.json');
  let existing = [];
  if (!replace && existsSync(manifestPath)) {
    try {
      const data = JSON.parse(readFileSync(manifestPath, 'utf-8'));
      existing = data.captures || [];
    } catch (e) { console.log(`  ⚠ Could not parse existing manifest: ${e.message}`); }
  }

  const byFile = new Map();
  for (const cap of existing) byFile.set(cap.file, cap);
  for (const cap of newCaptures) byFile.set(cap.file, cap);

  const merged = Array.from(byFile.values());
  writeFileSync(manifestPath, JSON.stringify({ viewport, captures: merged }, null, 2));

  cleanOrphanedFiles(merged);
  return merged.length;
}

function cleanOrphanedFiles(manifestCaptures) {
  const referencedFiles = new Set(manifestCaptures.map(c => c.file));
  referencedFiles.add('manifest.json');
  referencedFiles.add('config.json');
  try {
    const files = readdirSync(OUTPUT_DIR);
    for (const file of files) {
      if (!referencedFiles.has(file) && (file.endsWith('.png') || file.endsWith('.jpg') || file.endsWith('.jpeg') || file.endsWith('.webp'))) {
        try {
          unlinkSync(join(OUTPUT_DIR, file));
          console.log(`  ⤷ Cleaned up orphaned file: ${file}`);
        } catch (e) { console.log(`  ⚠ Could not delete ${file}: ${e.message}`); }
      }
    }
  } catch (e) { console.log(`  ⚠ Could not list output dir for cleanup: ${e.message}`); }
}

async function safeGoto(page, url, { retries = 1 } = {}) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
      try {
        await page.waitForLoadState('networkidle', { timeout: 8000 });
      } catch (e) { /* network didn't fully settle, continue */ }
      await waitForContentReady(page);
      return;
    } catch (err) {
      if (attempt < retries) {
        console.log(`    ⤷ Navigation failed, retrying (${attempt + 1}/${retries})...`);
        await sleep(800);
      } else {
        console.log(`    ⚠ Navigation to ${url} failed after ${retries + 1} attempts: ${err.message.slice(0, 100)}`);
      }
    }
  }
}

async function waitForContentReady(page, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;

  try {
    await page.evaluate(() => {
      return new Promise((resolve) => {
        if (!document.body) { resolve(); return; }
        let timer;
        const observer = new MutationObserver(() => {
          clearTimeout(timer);
          timer = setTimeout(() => { observer.disconnect(); resolve(); }, 400);
        });
        observer.observe(document.body, { childList: true, subtree: true, attributes: true });
        timer = setTimeout(() => { observer.disconnect(); resolve(); }, 400);
        setTimeout(() => { observer.disconnect(); resolve(); }, 5000);
      });
    });
  } catch (e) { /* page navigated mid-wait */ }

  const loadingBudget = Math.max(deadline - Date.now(), 1000);
  try {
    await page.evaluate((maxWait) => {
      return new Promise((resolve) => {
        const sels = [
          '.loading', '.spinner', '.skeleton',
          '[class*="loading"]', '[class*="spinner"]', '[class*="skeleton"]',
          '[class*="shimmer"]', '[role="progressbar"]',
          '[class*="progress"]:not(nav):not([role="navigation"])',
        ];
        function hasVisibleLoader() {
          for (const sel of sels) {
            try {
              for (const el of document.querySelectorAll(sel)) {
                const r = el.getBoundingClientRect();
                if (r.width > 10 && r.height > 10) return true;
              }
            } catch {}
          }
          return false;
        }
        if (!hasVisibleLoader()) { resolve(); return; }
        const start = Date.now();
        const iv = setInterval(() => {
          if (!hasVisibleLoader() || Date.now() - start > maxWait) {
            clearInterval(iv);
            resolve();
          }
        }, 150);
      });
    }, loadingBudget);
  } catch (e) { /* page navigated */ }

  const imgBudget = Math.max(deadline - Date.now(), 800);
  try {
    await page.evaluate((maxWait) => {
      return new Promise((resolve) => {
        const imgs = Array.from(document.querySelectorAll('img'));
        const pending = imgs.filter(img => {
          if (img.complete) return false;
          const r = img.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        });
        if (pending.length === 0) { resolve(); return; }
        let done = 0;
        const timer = setTimeout(resolve, maxWait);
        for (const img of pending) {
          const cb = () => { if (++done >= pending.length) { clearTimeout(timer); resolve(); } };
          img.addEventListener('load', cb, { once: true });
          img.addEventListener('error', cb, { once: true });
        }
      });
    }, imgBudget);
  } catch (e) { /* page navigated */ }

  try {
    await page.evaluate(() => document.fonts.ready);
  } catch (e) { /* no fonts API */ }
}

async function scrollToTriggerLazy(page) {
  await page.evaluate(async () => {
    const vh = window.innerHeight;
    const totalH = document.body ? document.body.scrollHeight : 0;
    if (totalH <= vh * 1.5) return;

    const step = Math.floor(vh * 0.7);
    let y = 0;
    const maxScrolls = 20;
    let scrolls = 0;
    while (y < totalH && scrolls < maxScrolls) {
      y = Math.min(y + step, totalH);
      window.scrollTo(0, y);
      await new Promise(r => setTimeout(r, 200));
      scrolls++;
    }
    window.scrollTo(0, 0);
    await new Promise(r => setTimeout(r, 150));
  });
}

async function dismissModals(page) {
  // Brief pause to let modals/popups render after page load
  await sleep(500);

  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('Escape');
    await sleep(400);
  }

  const matchAccept = config.dismissAcceptButtons !== false;

  const dismissed = await page.evaluate(({ extraSelectors, matchAccept: allowAccept }) => {
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

      const dismissText = [
        'close', 'dismiss', 'not now', 'no thanks',
        'maybe later', 'got it',
      ];
      if (allowAccept) {
        dismissText.push('accept', 'ok');
      }
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
  }, { extraSelectors: extraDismissSelectors, matchAccept });

  if (dismissed > 0) {
    console.log(`    ⤷ Dismissed ${dismissed} modal(s)/popup(s).`);
    await sleep(800);
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
        await sleep(800);
        break;
      }
      case 'wait': {
        await sleep(step.ms || 2000);
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

const USERNAME_SELECTORS = [
  'input[type="email"]',
  'input[name="username"]',
  'input[name="email"]',
  'input[name="user"]',
  'input[name="login"]',
  'input[name="userId"]',
  'input[name="user_id"]',
  'input[name="loginId"]',
  'input[autocomplete="username"]',
  'input[autocomplete="email"]',
  'input[id*="user" i]',
  'input[id*="email" i]',
  'input[id*="login" i]',
  'input[placeholder*="email" i]',
  'input[placeholder*="username" i]',
  'input[placeholder*="user" i]',
  'input[aria-label*="email" i]',
  'input[aria-label*="username" i]',
  'input[aria-label*="user" i]',
];

const PASSWORD_SELECTORS = [
  'input[type="password"]',
  'input[name="password"]',
  'input[name="passwd"]',
  'input[name="pass"]',
  'input[autocomplete="current-password"]',
  'input[id*="password" i]',
  'input[id*="passwd" i]',
];

const SUBMIT_SELECTORS = [
  'button[type="submit"]',
  'input[type="submit"]',
  'button:has-text("Sign in")',
  'button:has-text("Log in")',
  'button:has-text("Login")',
  'button:has-text("Sign In")',
  'button:has-text("Log In")',
  'button:has-text("Continue")',
  'button:has-text("Next")',
  'button:has-text("Submit")',
  '[role="button"]:has-text("Sign in")',
  '[role="button"]:has-text("Log in")',
];

async function findVisible(page, selectors) {
  for (const sel of selectors) {
    try {
      const el = await page.$(sel);
      if (el && await el.isVisible()) return el;
    } catch (e) { /* selector syntax not supported, skip */ }
  }
  return null;
}

async function autoLogin(page, login) {
  const username = login.username;
  const password = login.password;

  console.log('  Auto-detecting login fields...');

  let usernameField = await findVisible(page, USERNAME_SELECTORS);

  if (!usernameField) {
    usernameField = await page.evaluate(() => {
      const inputs = document.querySelectorAll('input[type="text"], input:not([type])');
      for (const inp of inputs) {
        const rect = inp.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        const name = (inp.name + inp.id + inp.placeholder + inp.getAttribute('aria-label')).toLowerCase();
        if (name.includes('search') || name.includes('query')) continue;
        return true;
      }
      return false;
    });
    if (usernameField === true) {
      usernameField = await page.$('input[type="text"], input:not([type])');
    }
  }

  if (usernameField) {
    console.log('    ⤷ Found username field');
    await usernameField.fill(username);
    await sleep(200);
  } else {
    console.log('    ⤷ No username field found, trying password directly');
  }

  let passwordField = await findVisible(page, PASSWORD_SELECTORS);

  if (passwordField) {
    console.log('    ⤷ Found password field');
    await passwordField.fill(password);
    await sleep(200);

    let submitBtn = await findVisible(page, SUBMIT_SELECTORS);
    if (submitBtn) {
      console.log('    ⤷ Clicking submit button');
      await submitBtn.click();
    } else {
      console.log('    ⤷ Pressing Enter to submit');
      await page.keyboard.press('Enter');
    }
    await sleep(1000);
  } else {
    console.log('    ⤷ No password field yet — trying multi-step login');
    let submitBtn = await findVisible(page, SUBMIT_SELECTORS);
    if (submitBtn) {
      await submitBtn.click();
    } else {
      await page.keyboard.press('Enter');
    }
    await sleep(1500);

    passwordField = await findVisible(page, PASSWORD_SELECTORS);
    if (passwordField) {
      console.log('    ⤷ Found password field on step 2');
      await passwordField.fill(password);
      await sleep(200);

      submitBtn = await findVisible(page, SUBMIT_SELECTORS);
      if (submitBtn) {
        console.log('    ⤷ Clicking submit button');
        await submitBtn.click();
      } else {
        console.log('    ⤷ Pressing Enter to submit');
        await page.keyboard.press('Enter');
      }
      await sleep(1000);
    } else {
      console.log('    ⤷ Still no password field — login form may need manual steps');
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

const MAX_SCREENSHOT_HEIGHT = viewport.height * 4;
const seenContentSignatures = new Set();

async function getContentSignature(page) {
  return page.evaluate(() => {
    const title = document.title || '';
    const path = location.pathname || '';
    const text = document.body ? document.body.innerText.slice(0, 5000) : '';
    const elCount = document.body ? document.body.querySelectorAll('*').length : 0;
    const normalized = (title + '|' + path + '|' + elCount + '|' + text)
      .replace(/\s+/g, ' ')
      .replace(/\d{1,2}:\d{2}(:\d{2})?\s*(AM|PM|am|pm)?/g, '')
      .replace(/\d+\s*(min|hour|day|sec|minute|second)s?\s*ago/gi, '')
      .replace(/just now/gi, '')
      .trim();
    let hash = 0;
    for (let i = 0; i < normalized.length; i++) {
      hash = ((hash << 5) - hash + normalized.charCodeAt(i)) | 0;
    }
    return String(hash);
  });
}

async function captureCurrentPage(page, name, usedNames, screens, retries = 1) {
  const url = page.url();
  const path = new URL(url).pathname;

  const sig = await getContentSignature(page);
  if (seenContentSignatures.has(sig)) {
    console.log(`    ⤷ Skipping "${name}" — duplicate content of a previous capture`);
    return false;
  }
  seenContentSignatures.add(sig);

  await scrollToTriggerLazy(page);
  await waitForContentReady(page, 2000);

  const dedupedName = dedupeFilename(name, usedNames);
  const filename = `${dedupedName}${screenshotExt}`;

  const bodyHeight = await page.evaluate(() => document.body ? document.body.scrollHeight : 0);

  const screenshotOpts = {
    path: join(OUTPUT_DIR, filename),
    type: screenshotType,
    ...(screenshotQuality != null && { quality: screenshotQuality }),
  };

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      if (bodyHeight > MAX_SCREENSHOT_HEIGHT) {
        await page.screenshot({
          ...screenshotOpts,
          clip: { x: 0, y: 0, width: viewport.width, height: MAX_SCREENSHOT_HEIGHT },
        });
      } else {
        await page.screenshot({ ...screenshotOpts, fullPage: true });
      }
      break;
    } catch (err) {
      if (attempt < retries) {
        console.log(`    ⤷ Screenshot failed, retrying: ${err.message.slice(0, 80)}`);
        await sleep(500);
      } else {
        console.log(`    ⚠ Screenshot failed for "${name}": ${err.message.slice(0, 120)}`);
        seenContentSignatures.delete(sig);
        return false;
      }
    }
  }

  screens.push({
    name: dedupedName,
    file: filename,
    group: groupFromPath(path),
    path,
    url,
    capturedAt: new Date().toISOString()
  });
  console.log(`    ✓ Saved ${filename}${bodyHeight > MAX_SCREENSHOT_HEIGHT ? ` (clipped at ${MAX_SCREENSHOT_HEIGHT}px)` : ''}`);
  return true;
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

function isNavLink(item, visitedPaths, existingItems, skipUuids) {
  if (item.type !== 'link' || !item.href) return false;
  if (item.href.startsWith('tel:') || item.href.startsWith('mailto:')) return false;
  if (skipUuids) {
    const uuidPattern = /[0-9a-f]{8}-[0-9a-f]{4}/;
    if (uuidPattern.test(item.href)) return false;
  }
  const pathOnly = item.href.split('?')[0];
  if (visitedPaths.has(pathOnly)) return false;
  if (existingItems && existingItems.some(n => n.href === item.href)) return false;
  return true;
}

async function getPageSignature(page) {
  return getContentSignature(page);
}

async function discoverTabs(page, parentName, usedNames, screens) {
  const tabs = await page.evaluate(() => {
    const results = [];
    const seen = new Set();
    const selectors = [
      '[role="tab"]',
      '[role="tablist"] button',
      '[role="tablist"] a',
      '.tab', '.tab-item',
      '[data-tab]',
      '.segment', '.segment-item', '.segmented-control > *',
      '.nav-pills > li > a', '.nav-pills > li > button',
      '.nav-tabs > li > a', '.nav-tabs > li > button',
      '[class*="tab-btn"]', '[class*="tab-link"]',
      '[class*="pill"]',
    ];

    function findTabs(root) {
      if (!root) return;
      for (const el of root.querySelectorAll('*')) {
        if (el.shadowRoot) findTabs(el.shadowRoot);
      }
      for (const sel of selectors) {
        try {
          for (const el of root.querySelectorAll(sel)) {
            const rect = el.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) continue;
            const text = el.textContent.trim().replace(/\s+/g, ' ').slice(0, 40);
            if (!text) continue;
            const isActive = el.classList.contains('active') ||
              el.classList.contains('is-active') ||
              el.classList.contains('selected') ||
              el.getAttribute('aria-selected') === 'true' ||
              el.getAttribute('data-active') === 'true' ||
              el.getAttribute('data-state') === 'active';
            if (isActive) continue;
            const key = `${Math.round(rect.x)}:${Math.round(rect.y)}`;
            if (seen.has(key)) continue;
            seen.add(key);
            results.push({ label: text, x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) });
          }
        } catch (e) { /* selector not supported */ }
      }
    }

    findTabs(document);
    return results;
  });

  if (tabs.length === 0) return;
  console.log(`    ⤷ Found ${tabs.length} tabs to explore`);

  const seenSignatures = new Set();
  const beforeSig = await getPageSignature(page);
  seenSignatures.add(beforeSig);

  for (const tab of tabs) {
    try {
      await page.mouse.click(tab.x, tab.y);
      await waitForContentReady(page, 3000);

      const sig = await getPageSignature(page);
      if (seenSignatures.has(sig)) {
        continue;
      }
      seenSignatures.add(sig);

      const tabName = `${parentName}-${slugify(tab.label)}`;
      await captureCurrentPage(page, tabName, usedNames, screens);
    } catch (e) {
      console.log(`    ⚠ Tab "${tab.label}" click failed: ${e.message.slice(0, 80)}`);
    }
  }
}

async function discoverScreens(context, page, linkOrigin) {
  const visitedPaths = new Set();
  const screens = [];
  const usedNames = new Set();
  const homeUrl = page.url();
  const homePath = new URL(homeUrl).pathname;
  const maxScreens = config.maxScreens || 50;
  const skipUuids = config.skipUuids !== false;
  const exploreTabs = config.exploreTabs !== false;

  const actualOrigin = new URL(homeUrl).origin;
  const effectiveOrigin = linkOrigin;
  let configOrigin = actualOrigin;
  try {
    configOrigin = new URL(baseUrl).origin;
  } catch { /* keep actualOrigin */ }

  if (actualOrigin !== configOrigin) {
    console.log(`  Note: App origin is ${actualOrigin} (configured URL origin: ${configOrigin})`);
  }

  console.log(`  Capturing landing page: ${homePath}`);
  if (maxScreens < 999) console.log(`  Max screens: ${maxScreens}`);
  await waitForContentReady(page);
  await dismissModals(page);
  visitedPaths.add(homePath);
  await captureCurrentPage(page, 'home', usedNames, screens);

  const allItems = await getAllClickableItems(page, effectiveOrigin);
  console.log(`\n  Found ${allItems.length} clickable elements total.`);

  const navItems = allItems.filter(item => isNavLink(item, visitedPaths, null, skipUuids));

  const hamburger = allItems.find(item =>
    item.type === 'click' && item.label === '(unlabeled)' && item.x < 60 && item.y < 200
  );

  console.log(`  Filtered to ${navItems.length} navigation links.`);
  if (hamburger) console.log(`  Found hamburger menu button at (${hamburger.x}, ${hamburger.y}).`);
  console.log('');

  if (hamburger) {
    console.log(`  Opening hamburger menu...`);
    await page.mouse.click(hamburger.x, hamburger.y);
    await sleep(1500);

    await captureCurrentPage(page, 'menu', usedNames, screens);

    const menuItems = await getAllClickableItems(page, effectiveOrigin);
    const newMenuLinks = menuItems.filter(item => isNavLink(item, visitedPaths, navItems, skipUuids));

    if (newMenuLinks.length > 0) {
      console.log(`  Found ${newMenuLinks.length} new links in menu.\n`);
      navItems.push(...newMenuLinks);
    }

    await page.keyboard.press('Escape');
    await sleep(300);
    await safeGoto(page, homeUrl);
    await dismissModals(page);
  }

  const numWorkers = Math.min(parallelPages, Math.max(navItems.length, 1));
  const workerPages = [page];
  try {
    for (let i = 1; i < numWorkers; i++) {
      workerPages.push(await context.newPage());
    }

    if (numWorkers > 1) console.log(`  Using ${numWorkers} parallel workers.\n`);

    let nextIdx = 0;

    async function processNavItem(workerPage) {
      while (nextIdx < navItems.length && screens.length < maxScreens && !shouldStopAutomation()) {
        const myIdx = nextIdx++;
        if (myIdx >= navItems.length) break;

        const item = navItems[myIdx];
        const pathOnly = (item.href || '').split('?')[0];

        if (visitedPaths.has(pathOnly)) continue;
        visitedPaths.add(pathOnly);

        console.log(`  [${myIdx + 1}/${navItems.length}] "${item.label}" → ${item.href}`);

        try {
          const targetUrl = resolveHref(item.href, homeUrl);

          await safeGoto(workerPage, targetUrl);
          await dismissModals(workerPage);

          const currentUrl = workerPage.url();
          if (urlLooksLikeLoginPage(currentUrl)) {
            console.log(`    ⤷ Redirected to login, skipping.`);
            continue;
          }

          const name = slugify(item.label !== '(unlabeled)' ? item.label : pathOnly) || `screen-${myIdx}`;
          await captureCurrentPage(workerPage, name, usedNames, screens);

          if (exploreTabs) {
            await discoverTabs(workerPage, name, usedNames, screens);
          }

          const subItems = await getAllClickableItems(workerPage, effectiveOrigin);
          const newSubs = subItems.filter(si => isNavLink(si, visitedPaths, navItems, skipUuids));

          if (newSubs.length > 0) {
            console.log(`    ⤷ Found ${newSubs.length} sub-links.`);
            const here = workerPage.url();
            for (const si of newSubs) {
              navItems.push({ ...si, href: resolveHref(si.href, here) });
            }
          }
        } catch (err) {
          console.log(`    ⤷ Failed: ${err.message.slice(0, 120)}`);
        }
      }
    }

    await Promise.all(workerPages.map(p => processNavItem(p)));
  } finally {
    for (let i = 1; i < workerPages.length; i++) {
      await workerPages[i].close().catch(() => {});
    }
  }

  return screens;
}

async function captureExplicitScreens(page, explicitScreens) {
  const manifest = [];
  const total = explicitScreens.length;

  for (let i = 0; i < total; i++) {
    const screen = explicitScreens[i];
    const url = screen.path.startsWith('http')
      ? screen.path
      : resolveHref(screen.path, baseUrl);

    console.log(`  [${i + 1}/${total}] ${screen.name} → ${url}`);
    await safeGoto(page, url);
    await dismissModals(page);

    if (screen.waitFor) {
      try { await page.waitForSelector(screen.waitFor, { timeout: 10000 }); }
      catch (e) { console.log(`    ⚠ waitFor "${screen.waitFor}" timed out`); }
    }
    if (screen.delay) {
      await sleep(Number(screen.delay) || 0);
    }

    await scrollToTriggerLazy(page);
    await waitForContentReady(page, 2000);

    const filename = `${screen.name}${screenshotExt}`;
    const screenshotOpts = {
      path: join(OUTPUT_DIR, filename),
      fullPage: true,
      type: screenshotType,
      ...(screenshotQuality != null && { quality: screenshotQuality }),
    };
    try {
      await page.screenshot(screenshotOpts);
    } catch (err) {
      console.log(`    ⚠ Screenshot failed for "${screen.name}": ${err.message.slice(0, 100)}`);
      continue;
    }

    const landedUrl = page.url();
    let pathField = screen.path;
    try {
      pathField = new URL(landedUrl).pathname + new URL(landedUrl).search;
    } catch { /* keep screen.path */ }

    manifest.push({
      name: screen.name,
      file: filename,
      group: screen.group || groupFromPath(screen.path),
      path: pathField,
      url: landedUrl,
      capturedAt: new Date().toISOString()
    });
  }

  return manifest;
}

async function loginIfNeeded(page) {
  if (!config.login) return;

  console.log('\n  Checking login status...');
  await safeGoto(page, baseUrl);
  const currentUrl = page.url();
  if (!urlLooksLikeLoginPage(currentUrl)) {
    console.log('  ✓ Already logged in.\n');
    return;
  }

  const loginPath = config.login.url || '/login';
  const loginUrl = loginPath.startsWith('http')
    ? loginPath
    : resolveHref(loginPath, baseUrl);

  if (page.url() !== loginUrl) {
    console.log(`  Navigating to login at ${loginUrl}`);
    await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await sleep(1500);
  }

  if (config.login.steps && config.login.steps.length > 0) {
    console.log('  Using configured login steps...');
    await runLoginSteps(page, config.login.steps);
  } else if (config.login.username && config.login.password) {
    await autoLogin(page, config.login);
  } else {
    console.log('  Login config found but no credentials or steps — skipping auto-login.');
  }

  const isStillOnLogin = urlLooksLikeLoginPage(page.url());

  if (isStillOnLogin) {
    console.log('\n  ⏳ Waiting for you to complete login (MFA, etc) in the browser window...');
    console.log('  The script will continue automatically once you\'re past the login page.\n');
    await page.waitForURL(url => !urlLooksLikeLoginPage(url.toString()), { timeout: 120000 });
  }

  await sleep(2000);
  console.log(`  ✓ Logged in. Now at: ${page.url()}\n`);
  await dismissModals(page);
}

async function getNavItems(page, baseOrigin) {
  return page.evaluate((origin) => {
    const items = [];
    const seen = new Set();
    const skipText = ['logout', 'sign out', 'log out', 'enroll', 'sign up', 'recaptcha', 'skip to main'];

    function isNavAncestor(el) {
      let cur = el;
      while (cur) {
        if (cur instanceof Element) {
          const tag = cur.tagName.toLowerCase();
          if (tag === 'nav') return true;
          const role = cur.getAttribute && cur.getAttribute('role');
          if (role === 'navigation' || role === 'menu' || role === 'menubar') return true;
          const cl = cur.className && typeof cur.className === 'string' ? cur.className.toLowerCase() : '';
          if (cl.includes('nav') || cl.includes('menu') || cl.includes('sidebar') || cl.includes('drawer') || cl.includes('tab-bar') || cl.includes('tabbar') || cl.includes('bottom-bar')) return true;
        }
        cur = cur.parentNode || (cur.host ? cur.host : null);
      }
      return false;
    }

    function walkTree(root) {
      if (!root) return;
      const elements = root.querySelectorAll('*');
      for (const el of elements) {
        if (el.shadowRoot) walkTree(el.shadowRoot);

        const tag = el.tagName.toLowerCase();
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;

        const isLink = tag === 'a' && el.getAttribute('href');
        const isButton = tag === 'button';
        const role = el.getAttribute('role');
        const hasRole = ['link', 'tab', 'menuitem', 'menuitemradio', 'menuitemcheckbox', 'button', 'treeitem'].includes(role);

        if (!isLink && !isButton && !hasRole) continue;

        const text = el.textContent.trim().replace(/\s+/g, ' ').slice(0, 80);
        if (!text || text === '(unlabeled)') continue;
        if (skipText.some(s => text.toLowerCase().includes(s))) continue;

        const href = el.getAttribute('href') || null;
        if (href && (href.startsWith('tel:') || href.startsWith('mailto:') || href === '#' || href === '')) continue;
        if (href && href.startsWith('http') && !href.startsWith(origin)) continue;

        const key = href ? `href:${href}` : `text:${text.toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);

        const inNav = isNavAncestor(el);

        items.push({
          type: isLink ? 'link' : 'click',
          href,
          label: text,
          x: Math.round(rect.x + rect.width / 2),
          y: Math.round(rect.y + rect.height / 2),
          inNav,
        });
      }
    }

    walkTree(document);
    return items;
  }, baseOrigin);
}

async function findHamburger(page) {
  return page.evaluate(() => {
    const candidates = [];

    function check(root) {
      if (!root) return;
      for (const el of root.querySelectorAll('*')) {
        if (el.shadowRoot) check(el.shadowRoot);
      }

      const sels = [
        '[aria-label*="menu" i]', '[aria-label*="navigation" i]',
        '[aria-label*="Menu" i]', '[aria-label*="hamburger" i]',
        '[aria-label*="toggle" i]', '[aria-label*="open" i]',
        '[data-testid*="menu" i]', '[data-testid*="nav" i]',
        '[class*="hamburger" i]', '[class*="menu-toggle" i]',
        '[class*="menu-btn" i]', '[class*="nav-toggle" i]',
        '[class*="menu-trigger" i]', '[class*="drawer-trigger" i]',
        '[id*="menu-toggle" i]', '[id*="hamburger" i]',
        '[aria-expanded]', '[aria-haspopup="true"]',
      ];
      for (const sel of sels) {
        try {
          for (const el of root.querySelectorAll(sel)) {
            const rect = el.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0 && rect.width < 80 && rect.height < 80) {
              const isTop = rect.y < 120;
              candidates.push({
                x: Math.round(rect.x + rect.width / 2),
                y: Math.round(rect.y + rect.height / 2),
                score: 10 + (isTop ? 5 : 0) + (rect.x < 80 ? 3 : 0),
              });
            }
          }
        } catch {}
      }

      for (const el of root.querySelectorAll('button, [role="button"]')) {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        if (rect.width > 80 || rect.height > 80) continue;
        if (rect.y > 200) continue;
        const text = el.textContent.trim();
        if (text.length > 4) continue;

        const svgs = el.querySelectorAll('svg, img, [class*="icon"]');
        const has3lines = el.innerHTML.includes('line') || el.innerHTML.includes('rect') || el.innerHTML.includes('path');
        if (svgs.length > 0 || has3lines || text.length === 0) {
          const score = (rect.x < 80 ? 5 : 0) + (rect.x > 300 ? 3 : 0) + (rect.y < 100 ? 3 : 0) + (text.length === 0 ? 2 : 0);
          candidates.push({ x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2), score });
        }
      }
    }

    check(document);
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => b.score - a.score);
    return candidates[0];
  });
}

async function scoutNavItems(page, baseOrigin) {
  const homeUrl = page.url();
  const homePath = new URL(homeUrl).pathname;

  await waitForContentReady(page);
  await dismissModals(page);

  const viewportHeight = await page.evaluate(() => window.innerHeight);

  const pageItems = await getNavItems(page, baseOrigin);
  console.log(`  Found ${pageItems.length} navigation-like items on page`);

  const classifiedItems = pageItems.map(item => {
    let source = 'content';
    if (item.inNav) {
      source = item.y > viewportHeight * 0.75 ? 'bottom-nav' : 'nav';
    } else if (item.y > viewportHeight * 0.8) {
      source = 'bottom-nav';
    } else if (item.y < viewportHeight * 0.12) {
      source = 'nav';
    }
    const path = item.href ? item.href.split('?')[0] : null;
    return { ...item, source, path };
  });

  const hamburger = await findHamburger(page);
  let menuItems = [];

  if (hamburger) {
    console.log(`  Found menu button at (${hamburger.x}, ${hamburger.y}), opening...`);
    await page.mouse.click(hamburger.x, hamburger.y);
    await sleep(2000);

    const menuAllItems = await getNavItems(page, baseOrigin);
    const beforeLabels = new Set(pageItems.map(i => i.label.toLowerCase()));

    for (const item of menuAllItems) {
      if (beforeLabels.has(item.label.toLowerCase())) continue;
      const path = item.href ? item.href.split('?')[0] : null;
      menuItems.push({ ...item, source: 'menu', path });
    }

    console.log(`  Found ${menuItems.length} new items in menu`);

    await page.keyboard.press('Escape');
    await sleep(300);

    const stillOpen = await page.evaluate(() => {
      const els = document.querySelectorAll('[class*="open"], [class*="active"], [class*="expanded"]');
      for (const el of els) {
        const cl = el.className.toLowerCase();
        if ((cl.includes('menu') || cl.includes('nav') || cl.includes('drawer') || cl.includes('sidebar')) &&
            (cl.includes('open') || cl.includes('active') || cl.includes('expanded'))) return true;
      }
      return false;
    });
    if (stillOpen) {
      await page.mouse.click(hamburger.x, hamburger.y);
      await sleep(300);
    }
  } else {
    console.log('  No hamburger/menu button found');
  }

  const navElementItems = await page.evaluate((origin) => {
    const items = [];
    const seen = new Set();
    function scanNav(root) {
      if (!root) return;
      for (const el of root.querySelectorAll('*')) {
        if (el.shadowRoot) scanNav(el.shadowRoot);
      }
      for (const nav of root.querySelectorAll('nav, [role="navigation"], [role="menu"], [role="menubar"]')) {
        for (const el of nav.querySelectorAll('a[href], button, [role="menuitem"], [role="link"]')) {
          const rect = el.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) continue;
          const text = el.textContent.trim().replace(/\s+/g, ' ').slice(0, 80);
          if (!text) continue;
          const href = el.getAttribute('href') || null;
          if (href && (href.startsWith('tel:') || href.startsWith('mailto:') || href === '#')) continue;
          if (href && href.startsWith('http') && !href.startsWith(origin)) continue;
          const key = href ? `href:${href}` : `text:${text.toLowerCase()}`;
          if (seen.has(key)) continue;
          seen.add(key);
          items.push({
            type: href ? 'link' : 'click',
            href, label: text,
            x: Math.round(rect.x + rect.width / 2),
            y: Math.round(rect.y + rect.height / 2),
            path: href ? href.split('?')[0] : null,
            source: 'nav',
          });
        }
      }
    }
    scanNav(document);
    return items;
  }, baseOrigin);

  const seen = new Set();
  const final = [];

  seen.add(homePath);
  seen.add(homePath.replace(/\/$/, '') || '/');
  seen.add('/');

  const allCandidates = [
    ...classifiedItems.filter(i => i.source === 'bottom-nav'),
    ...classifiedItems.filter(i => i.source === 'nav'),
    ...navElementItems,
    ...menuItems,
    ...classifiedItems.filter(i => i.source === 'content'),
  ];

  const seenLabels = new Set();

  for (const item of allCandidates) {
    if (item.href && (item.href.startsWith('tel:') || item.href.startsWith('mailto:'))) continue;

    let pathKey = null;
    if (item.path) {
      pathKey = item.path;
      if (pathKey.startsWith('http')) {
        try { pathKey = new URL(pathKey).pathname; } catch (e) { /* bad URL */ }
      }
      pathKey = pathKey.replace(/\/$/, '') || '/';
      if (seen.has(pathKey)) continue;
    }

    const normLabel = item.label.toLowerCase().trim();
    if (seenLabels.has(normLabel)) continue;

    if (item.source === 'content') {
      const isDupe = final.some(f => f.label.toLowerCase().trim() === normLabel);
      if (isDupe) continue;
    }

    if (pathKey) seen.add(pathKey);
    seenLabels.add(normLabel);

    final.push({
      label: item.label,
      href: item.href,
      path: item.path,
      source: item.source,
    });
  }

  console.log(`  Filtered to ${final.length} feature links`);
  const navCount = final.filter(i => i.source !== 'content').length;
  const contentCount = final.filter(i => i.source === 'content').length;
  if (navCount > 0) console.log(`    ${navCount} from navigation/menu`);
  if (contentCount > 0) console.log(`    ${contentCount} from dashboard content`);

  return final;
}

const FAKE_DATA = {
  email: 'jane.doe@example.com',
  phone: '5551234567',
  name: 'Jane Doe',
  first: 'Jane',
  last: 'Doe',
  address: '123 Main St',
  city: 'Springfield',
  state: 'IL',
  zip: '62701',
  ssn: '123456789',
  routing: '021000021',
  account: '123456789012',
  amount: '25.00',
  date: '2026-04-01',
  memo: 'Test payment',
  generic: 'Test value',
};

function guessFieldValue(field) {
  const n = (field.name || '').toLowerCase();
  const id = (field.id || '').toLowerCase();
  const ph = (field.placeholder || '').toLowerCase();
  const label = (field.label || '').toLowerCase();
  const all = `${n} ${id} ${ph} ${label}`;

  if (field.type === 'email' || all.includes('email')) return FAKE_DATA.email;
  if (field.type === 'tel' || all.includes('phone') || all.includes('mobile')) return FAKE_DATA.phone;
  if (field.type === 'date') return FAKE_DATA.date;
  if (all.includes('amount') || all.includes('dollar') || all.includes('payment')) return FAKE_DATA.amount;
  if (all.includes('routing')) return FAKE_DATA.routing;
  if (all.includes('account') && (all.includes('number') || all.includes('#') || all.includes('num'))) return FAKE_DATA.account;
  if (all.includes('ssn') || all.includes('social')) return FAKE_DATA.ssn;
  if (all.includes('zip') || all.includes('postal')) return FAKE_DATA.zip;
  if (all.includes('state') || all.includes('province')) return FAKE_DATA.state;
  if (all.includes('city')) return FAKE_DATA.city;
  if (all.includes('address') || all.includes('street')) return FAKE_DATA.address;
  if (all.includes('first') && all.includes('name')) return FAKE_DATA.first;
  if (all.includes('last') && all.includes('name')) return FAKE_DATA.last;
  if (all.includes('name')) return FAKE_DATA.name;
  if (all.includes('memo') || all.includes('note') || all.includes('description')) return FAKE_DATA.memo;

  if (field.type === 'number') return FAKE_DATA.amount;
  if (field.type === 'text' || field.type === 'search' || !field.type) return FAKE_DATA.generic;
  return null;
}

async function fillAndCaptureForms(page, parentName, usedNames, screens, depth) {
  const pad = '  '.repeat(depth + 2);
  const forms = await page.evaluate(() => {
    const results = [];
    const inputSel =
      'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([readonly]):not([disabled]), ' +
      'textarea:not([readonly]):not([disabled]), ' +
      'select:not([disabled])';

    const allInputs = [];
    function findInputs(root) {
      if (!root) return;
      for (const el of root.querySelectorAll('*')) {
        if (el.shadowRoot) findInputs(el.shadowRoot);
      }
      for (const inp of root.querySelectorAll(inputSel)) {
        allInputs.push(inp);
      }
    }
    findInputs(document);

    if (allInputs.length === 0) return results;

    const skipInputTypes = ['search', 'password'];
    const skipNames = ['search', 'query', 'q', 'filter', 'keyword', 'username', 'login', 'email'];

    const fields = [];
    for (const inp of allInputs) {
      const rect = inp.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;

      const iType = (inp.getAttribute('type') || '').toLowerCase();
      if (skipInputTypes.includes(iType)) continue;
      const iName = (inp.getAttribute('name') || '').toLowerCase();
      const iId = (inp.id || '').toLowerCase();
      const iRole = (inp.getAttribute('role') || '').toLowerCase();
      if (iRole === 'searchbox' || iRole === 'combobox') continue;
      if (skipNames.some(s => iName.includes(s) || iId.includes(s))) continue;

      let labelText = '';
      if (inp.id) {
        const lbl = document.querySelector(`label[for="${inp.id}"]`);
        if (lbl) labelText = lbl.textContent.trim();
      }
      if (!labelText) {
        const parent = inp.closest('label, .form-group, .field, [class*="field"], [class*="input"]');
        if (parent) {
          const lbl = parent.querySelector('label, .label, [class*="label"]');
          if (lbl) labelText = lbl.textContent.trim();
        }
      }

      fields.push({
        tag: inp.tagName.toLowerCase(),
        type: inp.getAttribute('type') || '',
        name: inp.getAttribute('name') || '',
        id: inp.id || '',
        placeholder: inp.getAttribute('placeholder') || '',
        label: labelText,
        x: Math.round(rect.x + rect.width / 2),
        y: Math.round(rect.y + rect.height / 2),
        value: inp.value || '',
        checked: inp.checked || false,
      });
    }

    if (fields.length > 0) {
      const submitBtn = document.querySelector(
        'button[type="submit"], input[type="submit"], ' +
        'button:not([type]):not([class*="cancel"]):not([class*="back"]):not([class*="close"])'
      );
      let submit = null;
      if (submitBtn) {
        const r = submitBtn.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          submit = {
            label: submitBtn.textContent.trim().slice(0, 40),
            x: Math.round(r.x + r.width / 2),
            y: Math.round(r.y + r.height / 2),
          };
        }
      }
      results.push({ fields, submit });
    }
    return results;
  });

  if (forms.length === 0) return;

  for (const form of forms) {
    if (form.fields.length === 0) continue;
    const emptyFields = form.fields.filter(f => !f.value && !f.checked);
    if (emptyFields.length === 0) continue;

    console.log(`${pad}⤷ Found form with ${form.fields.length} fields, filling ${emptyFields.length} empty ones`);

    for (const field of emptyFields) {
      try {
        if (field.type === 'checkbox' || field.type === 'radio') {
          if (!field.checked) {
            await page.mouse.click(field.x, field.y);
            await sleep(100);
          }
          continue;
        }

        if (field.tag === 'select') {
          await page.mouse.click(field.x, field.y);
          await sleep(200);
          await page.keyboard.press('ArrowDown');
          await page.keyboard.press('Enter');
          await sleep(100);
          continue;
        }

        const value = guessFieldValue(field);
        if (!value) continue;

        await page.mouse.click(field.x, field.y);
        await sleep(100);
        await page.keyboard.press(SELECT_ALL_KEY);
        await page.keyboard.type(value, { delay: 15 });
        await sleep(50);
      } catch (e) {
        console.log(`${pad}  ⚠ Field fill failed: ${e.message.slice(0, 60)}`);
      }
    }

    // Also try clicking any visible toggle switches
    try {
      const toggles = await page.evaluate(() => {
        const results = [];
        const sels = [
          '[role="switch"]', '.toggle', '.switch',
          '[class*="toggle"]:not(button)', '[class*="switch"]:not(button)',
        ];
        for (const sel of sels) {
          for (const el of document.querySelectorAll(sel)) {
            const rect = el.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) continue;
            const isOff = el.getAttribute('aria-checked') === 'false' ||
              !el.classList.contains('is-on') && !el.classList.contains('active');
            if (isOff) {
              results.push({ x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) });
            }
          }
        }
        return results;
      });
      for (const toggle of toggles) {
        await page.mouse.click(toggle.x, toggle.y);
        await sleep(100);
      }
    } catch (e) { /* toggles optional */ }

    const filledName = `${parentName}-filled`;
    await captureCurrentPage(page, filledName, usedNames, screens);

    if (form.submit) {
      console.log(`${pad}⤷ Submitting form ("${form.submit.label}")...`);
      try {
        await page.mouse.click(form.submit.x, form.submit.y);
        await waitForContentReady(page, 4000);
        await dismissModals(page);

        const submitName = `${parentName}-submitted`;
        await captureCurrentPage(page, submitName, usedNames, screens);
      } catch (e) {
        console.log(`${pad}  ⚠ Submit failed: ${e.message.slice(0, 80)}`);
      }
    }
  }
}

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}/;
const GLOBAL_NAV_PATHS = [
  '/support', '/help', '/contact', '/messages', '/settings', '/profile',
  '/account', '/preferences', '/notifications', '/feedback', '/privacy',
  '/terms', '/about', '/faq', '/login', '/sign-in', '/signin', '/logout',
  '/sign-out', '/signout', '/enroll', '/register',
];

function isInScope(href, scopePath) {
  let pathname;
  try {
    if (href.startsWith('http')) pathname = new URL(href).pathname;
    else pathname = href.split('?')[0];
  } catch (e) { return false; }

  pathname = pathname.replace(/\/$/, '') || '/';
  const scope = scopePath.replace(/\/$/, '') || '/';

  if (pathname.startsWith(scope)) return true;

  const lowerPath = pathname.toLowerCase();
  if (GLOBAL_NAV_PATHS.some(gp => lowerPath === gp || lowerPath.startsWith(gp + '/'))) return false;

  if (UUID_RE.test(pathname)) return false;

  return false;
}

async function deepCaptureItem(page, item, linkOrigin, sessionEntryUrl, sharedUsedNames) {
  const visitedUrls = new Set();
  const screens = [];
  const usedNames = sharedUsedNames || new Set();
  const startUrl = resolveHref(item.href, sessionEntryUrl);
  const itemName = slugify(item.label) || slugify(item.path) || 'screen';
  const MAX_PER_ITEM = 40;
  const MAX_DEPTH = 4;

  let scopePath;
  try {
    scopePath = new URL(startUrl).pathname;
  } catch (e) {
    scopePath = item.href.split('?')[0];
  }

  async function explorePage(pageUrl, name, depth) {
    if (screens.length >= MAX_PER_ITEM) return;
    if (depth > MAX_DEPTH) return;

    const pad = '  '.repeat(depth + 2);

    if (shouldStopAutomation()) {
      if (skipToManual) console.log(`${pad}⏩ Skipping to manual mode`);
      else console.log(`${pad}⏱ Timed out (${MAX_TOTAL_TIME / 60000}min), stopping`);
      return;
    }

    const urlKey = pageUrl.split('?')[0];

    if (visitedUrls.has(urlKey)) {
      return;
    }

    console.log(`${pad}→ ${name} (${pageUrl})`);
    await safeGoto(page, pageUrl);
    await dismissModals(page);

    const actualUrl = page.url();
    const actualKey = actualUrl.split('?')[0];

    if (urlLooksLikeLoginPage(actualUrl)) {
      console.log(`${pad}⤷ Redirected to login, skipping`);
      return;
    }

    if (visitedUrls.has(actualKey)) {
      return;
    }

    visitedUrls.add(urlKey);
    visitedUrls.add(actualKey);

    await captureCurrentPage(page, name, usedNames, screens);

    // Collect sub-links BEFORE tabs/forms change the page state
    const subItems = await getAllClickableItems(page, linkOrigin);
    const subLinks = subItems.filter(si => {
      if (si.type !== 'link' || !si.href) return false;
      if (si.href.startsWith('tel:') || si.href.startsWith('mailto:')) return false;
      if (si.label === '(unlabeled)') return false;
      const sp = si.href.split('?')[0];
      if (visitedUrls.has(sp)) return false;
      if (!isInScope(si.href, scopePath)) return false;
      return true;
    });

    await discoverTabs(page, name, usedNames, screens);
    await fillAndCaptureForms(page, name, usedNames, screens, depth);

    if (screens.length >= MAX_PER_ITEM || depth >= MAX_DEPTH) return;

    if (subLinks.length > 0) {
      console.log(`${pad}⤷ ${subLinks.length} in-scope sub-links to explore`);
    }

    const cap = Math.min(subLinks.length, 20);
    for (let i = 0; i < cap && screens.length < MAX_PER_ITEM; i++) {
      const sub = subLinks[i];
      const subUrl = resolveHref(sub.href, page.url());
      const subName = `${name}-${slugify(sub.label) || `sub-${i}`}`;

      await explorePage(subUrl, subName, depth + 1);
    }
  }

  console.log(`\n  Deep capturing: "${item.label}" → ${startUrl}`);
  console.log(`    Scope: ${scopePath}*`);
  await explorePage(startUrl, itemName, 0);
  console.log(`    ✓ Captured ${screens.length} screens for "${item.label}"`);
  return screens;
}

async function manualCapture(page, usedNames, screens) {
  const url = page.url();
  let path;
  try { path = new URL(url).pathname; } catch { path = '/'; }
  const name = slugify(path.replace(/^\//, '').replace(/\/$/, '')) || 'manual-screen';

  await scrollToTriggerLazy(page);
  await waitForContentReady(page, 2000);

  const dims = await page.evaluate(() => {
    const host = document.querySelector('[data-dc-toolbar-host]');
    const tbH = host ? host.offsetHeight : 0;
    if (host) host.style.display = 'none';
    return { width: window.innerWidth, height: window.innerHeight + tbH };
  }).catch(() => ({ width: viewport.width, height: viewport.height }));

  const dedupedName = dedupeFilename(name, usedNames);
  const filename = `${dedupedName}${screenshotExt}`;

  const screenshotOpts = {
    path: join(OUTPUT_DIR, filename),
    type: screenshotType,
    ...(screenshotQuality != null && { quality: screenshotQuality }),
  };

  try {
    await page.screenshot({
      ...screenshotOpts,
      clip: { x: 0, y: 0, width: dims.width, height: dims.height },
    });
  } catch (err) {
    await page.evaluate(() => {
      const host = document.querySelector('[data-dc-toolbar-host]');
      if (host) host.style.display = '';
    }).catch(() => {});
    console.log(`    ⚠ Screenshot failed: ${err.message.slice(0, 120)}`);
    return false;
  }

  await page.evaluate(() => {
    const host = document.querySelector('[data-dc-toolbar-host]');
    if (host) host.style.display = '';
  }).catch(() => {});

  screens.push({
    name: dedupedName,
    file: filename,
    group: groupFromPath(path),
    path,
    url,
    width: dims.width,
    height: dims.height,
    capturedAt: new Date().toISOString(),
  });
  console.log(`    ✓ Saved ${filename}`);
  return true;
}

const TOOLBAR_HEIGHT = 60;

function injectToolbar() {
  return function () {
    var existingHost = document.querySelector('[data-dc-toolbar-host]');
    if (existingHost && existingHost.shadowRoot && existingHost.shadowRoot.getElementById('__dc-done-btn')) return;
    if (existingHost) existingHost.remove();

    var host = document.createElement('div');
    host.setAttribute('data-dc-toolbar-host', '');
    host.style.cssText =
      'position:fixed;bottom:0;left:0;right:0;z-index:2147483647;height:60px;margin:0;padding:0;border:0;background:transparent;pointer-events:auto;';

    var shadow = host.attachShadow({ mode: 'open' });
    var isolate = document.createElement('style');
    isolate.textContent =
      'button{-webkit-appearance:none;appearance:none;margin:0;font:inherit;' +
      'flex-shrink:0;white-space:nowrap;box-sizing:border-box;}';

    var bar = document.createElement('div');
    bar.id = '__dc-toolbar';
    bar.style.cssText =
      'position:absolute;bottom:0;left:0;right:0;height:60px;font-family:-apple-system,system-ui,sans-serif;display:flex;align-items:center;gap:10px;padding:0 20px;box-sizing:border-box;background:rgba(0,0,0,0.85);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border-top:1px solid rgba(255,255,255,0.08);';

    var statusEl = document.createElement('span');
    statusEl.id = '__dc-status';
    statusEl.style.cssText =
      'font-size:13px;font-weight:600;color:rgba(255,255,255,0.45);margin-right:auto;display:flex;align-items:center;gap:8px;flex-shrink:0;';
    statusEl.innerHTML =
      '<span style="width:8px;height:8px;border-radius:50%;background:#22c55e;flex-shrink:0;"></span> Live';

    function makeBtn(label, bg, color) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.style.cssText =
        'background:' +
        bg +
        ';color:' +
        color +
        ';border:none;padding:9px 18px;border-radius:10px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;display:flex;align-items:center;gap:6px;transition:opacity 0.12s;flex-shrink:0;white-space:nowrap;';
      btn.innerHTML = label;
      btn.onmouseenter = function () {
        btn.style.opacity = '0.8';
      };
      btn.onmouseleave = function () {
        btn.style.opacity = '1';
      };
      return btn;
    }

    var captureBtn = makeBtn(
      '<kbd style="background:rgba(255,255,255,0.15);padding:2px 6px;border-radius:5px;font-size:11px;font-family:inherit;">C</kbd> Capture',
      'rgba(255,255,255,0.12)',
      'rgba(255,255,255,0.8)'
    );
    captureBtn.id = '__dc-capture-btn';

    var fillBtn = makeBtn(
      '<kbd style="background:rgba(255,255,255,0.15);padding:2px 6px;border-radius:5px;font-size:11px;font-family:inherit;">F</kbd> Auto Fill',
      'rgba(255,255,255,0.12)',
      'rgba(255,255,255,0.8)'
    );
    fillBtn.id = '__dc-fill-btn';

    var doneBtn = makeBtn('Done', 'rgba(59,130,246,0.9)', '#fff');
    doneBtn.id = '__dc-done-btn';

    shadow.appendChild(isolate);
    shadow.appendChild(bar);

    bar.appendChild(statusEl);
    bar.appendChild(captureBtn);
    bar.appendChild(fillBtn);
    bar.appendChild(doneBtn);

    var captureBtnDefault = captureBtn.innerHTML;

    function flashCapture(ok) {
      captureBtn.innerHTML = ok ? '✓' : '✕';
      captureBtn.style.background = ok ? 'rgba(34,197,94,0.9)' : 'rgba(220,38,38,0.85)';
      setTimeout(function () {
        captureBtn.innerHTML = captureBtnDefault;
        captureBtn.style.background = 'rgba(255,255,255,0.12)';
      }, 1200);
    }

    function append() {
      if (!document.body) return;
      document.body.appendChild(host);
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', append);
    } else {
      append();
    }

    function doCapture() {
      captureBtn.disabled = true;
      captureBtn.style.opacity = '0.5';
      window.__designCoreCapture().then(function (r) {
        captureBtn.disabled = false;
        captureBtn.style.opacity = '1';
        flashCapture(r && r.ok);
      }).catch(function () {
        captureBtn.disabled = false;
        captureBtn.style.opacity = '1';
        flashCapture(false);
      });
    }

    function doFill() {
      fillBtn.disabled = true;
      fillBtn.style.opacity = '0.5';
      window.__designCoreAutoFill().then(function () {
        fillBtn.disabled = false;
        fillBtn.style.opacity = '1';
      }).catch(function () {
        fillBtn.disabled = false;
        fillBtn.style.opacity = '1';
      });
    }

    captureBtn.onclick = doCapture;
    fillBtn.onclick = doFill;
    doneBtn.onclick = function () {
      window.__designCoreDone();
    };

    if (!window.__dcManualToolbarKeys) {
      window.__dcManualToolbarKeys = true;
      document.addEventListener('keydown', function (e) {
        if (
          e.target.tagName === 'INPUT' ||
          e.target.tagName === 'TEXTAREA' ||
          e.target.tagName === 'SELECT' ||
          e.target.isContentEditable
        )
          return;
        var h = document.querySelector('[data-dc-toolbar-host]');
        var sr = h && h.shadowRoot;
        if (!sr) return;
        if (e.key === 'c' || e.key === 'C') {
          e.preventDefault();
          var cap = sr.getElementById('__dc-capture-btn');
          if (cap && !cap.disabled) cap.click();
        }
        if (e.key === 'f' || e.key === 'F') {
          e.preventDefault();
          var fb = sr.getElementById('__dc-fill-btn');
          if (fb && !fb.disabled) fb.click();
        }
      });
    }
  };
}

async function autoFillCurrentPage(page) {
  const forms = await page.evaluate(() => {
    const inputSel =
      'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([readonly]):not([disabled]), ' +
      'textarea:not([readonly]):not([disabled]), ' +
      'select:not([disabled])';
    const allInputs = [];
    function findInputs(root) {
      if (!root) return;
      for (const el of root.querySelectorAll('*')) { if (el.shadowRoot) findInputs(el.shadowRoot); }
      for (const inp of root.querySelectorAll(inputSel)) allInputs.push(inp);
    }
    findInputs(document);
    if (allInputs.length === 0) return [];

    const skipTypes = ['search', 'password'];
    const skipNames = ['search', 'query', 'q', 'filter', 'keyword'];
    const fields = [];
    for (const inp of allInputs) {
      const rect = inp.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      const iType = (inp.getAttribute('type') || '').toLowerCase();
      if (skipTypes.includes(iType)) continue;
      const iName = (inp.getAttribute('name') || '').toLowerCase();
      const iId = (inp.id || '').toLowerCase();
      const iRole = (inp.getAttribute('role') || '').toLowerCase();
      if (iRole === 'searchbox' || iRole === 'combobox') continue;
      if (skipNames.some(s => iName.includes(s) || iId.includes(s))) continue;
      let labelText = '';
      if (inp.id) { const lbl = document.querySelector('label[for="' + inp.id + '"]'); if (lbl) labelText = lbl.textContent.trim(); }
      if (!labelText) { const parent = inp.closest('label, .form-group, .field, [class*="field"], [class*="input"]'); if (parent) { const lbl = parent.querySelector('label, .label, [class*="label"]'); if (lbl) labelText = lbl.textContent.trim(); } }
      fields.push({ tag: inp.tagName.toLowerCase(), type: inp.getAttribute('type') || '', name: inp.getAttribute('name') || '', id: inp.id || '', placeholder: inp.getAttribute('placeholder') || '', label: labelText, x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2), value: inp.value || '', checked: inp.checked || false });
    }
    return fields;
  });

  let filled = 0;
  for (const field of forms) {
    if (field.value || field.checked) continue;
    try {
      if (field.type === 'checkbox' || field.type === 'radio') {
        await page.mouse.click(field.x, field.y);
        await sleep(100);
        filled++;
        continue;
      }
      if (field.tag === 'select') {
        await page.mouse.click(field.x, field.y);
        await sleep(200);
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('Enter');
        await sleep(100);
        filled++;
        continue;
      }
      const value = guessFieldValue(field);
      if (!value) continue;
      await page.mouse.click(field.x, field.y);
      await sleep(100);
      await page.keyboard.press(SELECT_ALL_KEY);
      await page.keyboard.type(value, { delay: 15 });
      await sleep(50);
      filled++;
    } catch (e) {
      console.log(`    ⚠ Field fill failed: ${e.message.slice(0, 60)}`);
    }
  }
  console.log(`    ✓ Filled ${filled} field(s)`);
  return filled;
}

async function setupBrowserBridge(context, screens, usedNames) {
  let capturing = false;
  let filling = false;

  async function doCapture() {
    if (capturing) return false;
    capturing = true;
    try {
      const activePage = context.pages().find(p => !p.isClosed());
      if (!activePage) return false;
      const ok = await manualCapture(activePage, usedNames, screens);
      if (ok) {
        writeManifest(screens);
        const last = screens[screens.length - 1];
        console.log('__MANUAL_CAPTURED__' + JSON.stringify({ captured: screens.length, name: last.name, file: last.file }));
      }
      return ok;
    } finally {
      capturing = false;
    }
  }

  async function doFill() {
    if (filling) return 0;
    filling = true;
    try {
      const activePage = context.pages().find(p => !p.isClosed());
      if (!activePage) return 0;
      return await autoFillCurrentPage(activePage);
    } finally {
      filling = false;
    }
  }

  try { await context.exposeFunction('__designCoreCapture', async () => ({ ok: await doCapture() })); } catch {}
  try { await context.exposeFunction('__designCoreAutoFill', async () => ({ filled: await doFill() })); } catch {}
  try { await context.exposeFunction('__designCoreDone', () => { handleGlobalCommand('quit'); }); } catch {}

  globalCaptureHandler = doCapture;

  const toolbarFn = injectToolbar();
  await context.addInitScript(toolbarFn);
  for (const p of context.pages()) {
    await p.evaluate(toolbarFn).catch(() => {});
  }
}

async function waitForDone(context) {
  return new Promise((resolve) => {
    manualDoneResolve = resolve;
    context.on('close', () => {
      manualDoneResolve = null;
      resolve();
    });
  });
}

let manualDoneResolve = null;

function startStdinListener() {
  const isTTY = process.stdin.isTTY;
  if (isTTY) {
    try { process.stdin.setRawMode(true); } catch {}
  }
  process.stdin.resume();
  process.stdin.setEncoding('utf8');

  let lineBuffer = '';

  process.stdin.on('data', (data) => {
    if (isTTY) {
      if (data === '\u0003') { handleGlobalCommand('quit'); return; }
      if (data === 'q' || data === 'Q') { handleGlobalCommand('quit'); return; }
      if (data === '\r' || data === '\n' || data === 'c' || data === 'C') {
        handleGlobalCommand('capture');
        return;
      }
    } else {
      lineBuffer += data;
      const lines = lineBuffer.split('\n');
      lineBuffer = lines.pop() || '';
      for (const line of lines) {
        const cmd = line.trim().toLowerCase();
        if (cmd === 'capture') handleGlobalCommand('capture');
        else if (cmd === 'quit') handleGlobalCommand('quit');
      }
    }
  });
}

function handleGlobalCommand(cmd) {
  if (cmd === 'capture') {
    if (globalCaptureHandler) globalCaptureHandler();
  } else if (cmd === 'quit') {
    if (manualDoneResolve) {
      manualDoneResolve();
      manualDoneResolve = null;
    }
  }
}

let globalCaptureHandler = null;

async function main() {
  mkdirSync(BROWSER_DATA_DIR, { recursive: true });

  const winW = viewport.width;
  const winH = viewport.height + TOOLBAR_HEIGHT;

  const context = await chromium.launchPersistentContext(BROWSER_DATA_DIR, {
    headless: false,
    viewport: null,
    args: [`--window-size=${winW},${winH}`],
  });
  browserContext = context;
  const page = context.pages()[0] || await context.newPage();

  const screens = [];
  const usedNames = new Set();

  startStdinListener();
  await setupBrowserBridge(context, screens, usedNames);

  console.log('\n  ── Manual capture mode ──');
  console.log('  Browser is open. Navigate to your app, log in, and capture screens.');
  console.log('  Toolbar: C = Capture, F = Auto Fill forms, Done = finish.\n');
  console.log('__MANUAL_MODE__' + JSON.stringify({ captured: 0 }));

  await safeGoto(page, baseUrl);

  await waitForDone(context);

  writeManifest(screens);
  try { await context.close(); } catch {}
  console.log(`\n  ✓ Finished. ${screens.length} screenshots saved to public/data/captures/`);
  process.exit(0);
}

main().catch(err => {
  console.error('\n  Capture failed:', err.message, '\n');
  process.exit(1);
});
