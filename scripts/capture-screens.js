import { chromium } from 'playwright';
import { readFileSync, mkdirSync, existsSync, writeFileSync } from 'fs';
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
const extraDismissSelectors = config.dismissSelectors || [];
const SELECT_ALL_KEY = process.platform === 'darwin' ? 'Meta+a' : 'Control+a';

mkdirSync(OUTPUT_DIR, { recursive: true });

function writeManifest(newCaptures, replace = false) {
  const manifestPath = join(OUTPUT_DIR, 'manifest.json');
  let existing = [];
  if (!replace && existsSync(manifestPath)) {
    try {
      const data = JSON.parse(readFileSync(manifestPath, 'utf-8'));
      existing = data.captures || [];
    } catch {}
  }

  const byFile = new Map();
  for (const cap of existing) byFile.set(cap.file, cap);
  for (const cap of newCaptures) byFile.set(cap.file, cap);

  const merged = Array.from(byFile.values());
  writeFileSync(manifestPath, JSON.stringify({ viewport, captures: merged }, null, 2));
  return merged.length;
}

async function safeGoto(page, url, waitMs = 1500) {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
  } catch {
    // If domcontentloaded times out, the page might still be usable
  }
  try {
    await page.waitForLoadState('networkidle', { timeout: 5000 });
  } catch {
    // Network didn't settle -- use fallback wait
    await page.waitForTimeout(waitMs);
  }
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

      const dismissText = [
        'close', 'dismiss', 'not now', 'no thanks',
        'maybe later', 'got it',
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
    } catch { /* selector syntax not supported, skip */ }
  }
  return null;
}

async function autoLogin(page, login) {
  const username = login.username;
  const password = login.password;

  console.log('  Auto-detecting login fields...');

  // Try to find username field
  let usernameField = await findVisible(page, USERNAME_SELECTORS);

  if (!usernameField) {
    // Fallback: first visible text input that isn't a search box
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
    await page.waitForTimeout(500);
  } else {
    console.log('    ⤷ No username field found, trying password directly');
  }

  // Check if password field is visible (single-page login)
  let passwordField = await findVisible(page, PASSWORD_SELECTORS);

  if (passwordField) {
    // Both fields on same page
    console.log('    ⤷ Found password field');
    await passwordField.fill(password);
    await page.waitForTimeout(500);

    let submitBtn = await findVisible(page, SUBMIT_SELECTORS);
    if (submitBtn) {
      console.log('    ⤷ Clicking submit button');
      await submitBtn.click();
    } else {
      console.log('    ⤷ Pressing Enter to submit');
      await page.keyboard.press('Enter');
    }
    await page.waitForTimeout(2000);
  } else {
    // Multi-step login: submit username first, then look for password
    console.log('    ⤷ No password field yet — trying multi-step login');
    let submitBtn = await findVisible(page, SUBMIT_SELECTORS);
    if (submitBtn) {
      await submitBtn.click();
    } else {
      await page.keyboard.press('Enter');
    }
    await page.waitForTimeout(3000);

    // Now look for password on the new page/step
    passwordField = await findVisible(page, PASSWORD_SELECTORS);
    if (passwordField) {
      console.log('    ⤷ Found password field on step 2');
      await passwordField.fill(password);
      await page.waitForTimeout(500);

      submitBtn = await findVisible(page, SUBMIT_SELECTORS);
      if (submitBtn) {
        console.log('    ⤷ Clicking submit button');
        await submitBtn.click();
      } else {
        console.log('    ⤷ Pressing Enter to submit');
        await page.keyboard.press('Enter');
      }
      await page.waitForTimeout(2000);
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

async function captureCurrentPage(page, name, usedNames, screens) {
  const url = page.url();
  const path = new URL(url).pathname;
  const dedupedName = dedupeFilename(name, usedNames);
  const filename = `${dedupedName}.png`;

  const bodyHeight = await page.evaluate(() => document.body ? document.body.scrollHeight : 0);

  if (bodyHeight > MAX_SCREENSHOT_HEIGHT) {
    await page.screenshot({
      path: join(OUTPUT_DIR, filename),
      clip: { x: 0, y: 0, width: viewport.width, height: MAX_SCREENSHOT_HEIGHT },
    });
  } else {
    await page.screenshot({ path: join(OUTPUT_DIR, filename), fullPage: true });
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
  return page.evaluate(() => {
    const text = document.body ? document.body.innerText.slice(0, 500) : '';
    return document.title + '|' + text.replace(/\s+/g, ' ').trim();
  });
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
    ];

    function findTabs(root) {
      if (!root) return;
      for (const el of root.querySelectorAll('*')) {
        if (el.shadowRoot) findTabs(el.shadowRoot);
      }
      for (const sel of selectors) {
        for (const el of root.querySelectorAll(sel)) {
          const rect = el.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) continue;
          const text = el.textContent.trim().replace(/\s+/g, ' ').slice(0, 40);
          if (!text) continue;
          const isActive = el.classList.contains('active') ||
            el.classList.contains('is-active') ||
            el.classList.contains('selected') ||
            el.getAttribute('aria-selected') === 'true' ||
            el.getAttribute('data-active') === 'true';
          if (isActive) continue;
          const key = `${Math.round(rect.x)}:${Math.round(rect.y)}`;
          if (seen.has(key)) continue;
          seen.add(key);
          results.push({ label: text, x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) });
        }
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
      await page.waitForTimeout(1500);

      const sig = await getPageSignature(page);
      if (seenSignatures.has(sig)) {
        console.log(`      ⤷ Tab "${tab.label}" didn't change content, skipping`);
        continue;
      }
      seenSignatures.add(sig);

      const tabName = `${parentName}-${slugify(tab.label)}`;
      await captureCurrentPage(page, tabName, usedNames, screens);
    } catch {
      // tab click failed, move on
    }
  }
}

async function discoverScreens(page, baseOrigin) {
  const visitedPaths = new Set();
  const screens = [];
  const usedNames = new Set();
  const homeUrl = page.url();
  const homePath = new URL(homeUrl).pathname;
  const maxScreens = config.maxScreens || 50;
  const skipUuids = config.skipUuids !== false;
  const exploreTabs = config.exploreTabs !== false;

  console.log(`  Capturing landing page: ${homePath}`);
  if (maxScreens < 999) console.log(`  Max screens: ${maxScreens}`);
  await page.waitForTimeout(2000);
  await dismissModals(page);
  visitedPaths.add(homePath);
  await captureCurrentPage(page, 'home', usedNames, screens);

  const allItems = await getAllClickableItems(page, baseOrigin);
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
    await page.waitForTimeout(2000);

    await captureCurrentPage(page, 'menu', usedNames, screens);

    const menuItems = await getAllClickableItems(page, baseOrigin);
    const newMenuLinks = menuItems.filter(item => isNavLink(item, visitedPaths, navItems, skipUuids));

    if (newMenuLinks.length > 0) {
      console.log(`  Found ${newMenuLinks.length} new links in menu.\n`);
      navItems.push(...newMenuLinks);
    }

    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    await safeGoto(page, homeUrl, 3000);
    await dismissModals(page);
  }

  for (let i = 0; i < navItems.length; i++) {
    if (screens.length >= maxScreens) {
      console.log(`\n  Reached max screens (${maxScreens}). Stopping discovery.`);
      break;
    }

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

      const name = slugify(item.label !== '(unlabeled)' ? item.label : pathOnly) || `screen-${i}`;
      await captureCurrentPage(page, name, usedNames, screens);

      if (exploreTabs) {
        await discoverTabs(page, name, usedNames, screens);
      }

      const subItems = await getAllClickableItems(page, baseOrigin);
      const newSubs = subItems.filter(si => isNavLink(si, visitedPaths, navItems, skipUuids));

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

async function loginIfNeeded(page) {
  if (!config.login) return;

  // Check if already logged in by navigating to the app first
  console.log('\n  Checking login status...');
  await safeGoto(page, baseUrl);
  const currentUrl = page.url().toLowerCase();
  const isOnLogin = currentUrl.includes('/login') || currentUrl.includes('/sign-in') ||
    currentUrl.includes('/signin') || currentUrl.includes('/auth');

  if (!isOnLogin) {
    console.log('  ✓ Already logged in.\n');
    return;
  }

  const loginPath = config.login.url || '/login';
  const loginUrl = loginPath.startsWith('http')
    ? loginPath
    : `${baseUrl}${loginPath}`;

  if (page.url() !== loginUrl) {
    console.log(`  Navigating to login at ${loginUrl}`);
    await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(2000);
  }

  if (config.login.steps && config.login.steps.length > 0) {
    console.log('  Using configured login steps...');
    await runLoginSteps(page, config.login.steps);
  } else if (config.login.username && config.login.password) {
    await autoLogin(page, config.login);
  } else {
    console.log('  Login config found but no credentials or steps — skipping auto-login.');
  }

  const isStillOnLogin = (() => {
    const url = page.url().toLowerCase();
    return url.includes('/login') || url.includes('/sign-in') || url.includes('/signin') || url.includes('/auth');
  })();

  if (isStillOnLogin) {
    console.log('\n  ⏳ Waiting for you to complete login (MFA, etc) in the browser window...');
    console.log('  The script will continue automatically once you\'re past the login page.\n');
    await page.waitForURL(url => {
      const u = url.toString().toLowerCase();
      return !u.includes('/login') && !u.includes('/sign-in') && !u.includes('/signin') && !u.includes('/auth');
    }, { timeout: 120000 });
  }

  await page.waitForTimeout(5000);
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
        '[data-testid*="menu" i]', '[data-testid*="nav" i]',
        '[class*="hamburger" i]', '[class*="menu-toggle" i]',
        '[class*="menu-btn" i]', '[class*="nav-toggle" i]',
        '[id*="menu-toggle" i]', '[id*="hamburger" i]',
      ];
      for (const sel of sels) {
        try {
          for (const el of root.querySelectorAll(sel)) {
            const rect = el.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0 && rect.width < 80 && rect.height < 80) {
              candidates.push({ x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2), score: 10 });
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
          const score = (rect.x < 80 ? 5 : 1) + (rect.y < 100 ? 3 : 0) + (text.length === 0 ? 2 : 0);
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

  await page.waitForTimeout(2000);
  await dismissModals(page);

  const viewportHeight = await page.evaluate(() => window.innerHeight);

  // --- Phase 1: Scan visible page for nav-like items ---
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

  // --- Phase 2: Try to find and open a hamburger/menu ---
  const hamburger = await findHamburger(page);
  let menuItems = [];

  if (hamburger) {
    console.log(`  Found menu button at (${hamburger.x}, ${hamburger.y}), opening...`);
    await page.mouse.click(hamburger.x, hamburger.y);
    await page.waitForTimeout(2500);

    const menuAllItems = await getNavItems(page, baseOrigin);
    const beforeLabels = new Set(pageItems.map(i => i.label.toLowerCase()));

    for (const item of menuAllItems) {
      if (beforeLabels.has(item.label.toLowerCase())) continue;
      const path = item.href ? item.href.split('?')[0] : null;
      menuItems.push({ ...item, source: 'menu', path });
    }

    console.log(`  Found ${menuItems.length} new items in menu`);

    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // If Escape didn't close it, try clicking the hamburger again (toggle)
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
      await page.waitForTimeout(500);
    }
  } else {
    console.log('  No hamburger/menu button found');
  }

  // --- Phase 3: Also scan <nav> elements explicitly ---
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
          const text = el.textContent.trim().replace(/\\s+/g, ' ').slice(0, 80);
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

  // --- Phase 4: Merge and deduplicate ---
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
        try { pathKey = new URL(pathKey).pathname; } catch {}
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
      'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="checkbox"]):not([type="radio"]):not([readonly]):not([disabled]), ' +
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
    const emptyFields = form.fields.filter(f => !f.value);
    if (emptyFields.length === 0) continue;

    console.log(`${pad}⤷ Found form with ${form.fields.length} fields, filling ${emptyFields.length} empty ones`);

    for (const field of emptyFields) {
      const value = guessFieldValue(field);
      if (!value) continue;

      try {
        if (field.tag === 'select') {
          await page.mouse.click(field.x, field.y);
          await page.waitForTimeout(300);
          await page.keyboard.press('ArrowDown');
          await page.keyboard.press('Enter');
          await page.waitForTimeout(200);
        } else {
          await page.mouse.click(field.x, field.y);
          await page.waitForTimeout(200);
          await page.keyboard.press(SELECT_ALL_KEY);
          await page.keyboard.type(value, { delay: 20 });
          await page.waitForTimeout(100);
        }
      } catch {
        // field interaction failed
      }
    }

    const filledName = `${parentName}-filled`;
    await captureCurrentPage(page, filledName, usedNames, screens);

    if (form.submit) {
      console.log(`${pad}⤷ Submitting form ("${form.submit.label}")...`);
      try {
        await page.mouse.click(form.submit.x, form.submit.y);
        await page.waitForTimeout(3000);
        await dismissModals(page);

        const submitName = `${parentName}-submitted`;
        await captureCurrentPage(page, submitName, usedNames, screens);
      } catch {
        console.log(`${pad}  ⤷ Submit failed`);
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

function isInScope(href, scopePath, baseOrigin) {
  let pathname;
  try {
    if (href.startsWith('http')) pathname = new URL(href).pathname;
    else pathname = href.split('?')[0];
  } catch { return false; }

  pathname = pathname.replace(/\/$/, '') || '/';
  const scope = scopePath.replace(/\/$/, '') || '/';

  if (pathname.startsWith(scope)) return true;

  const lowerPath = pathname.toLowerCase();
  if (GLOBAL_NAV_PATHS.some(gp => lowerPath === gp || lowerPath.startsWith(gp + '/'))) return false;

  if (UUID_RE.test(pathname)) return false;

  return false;
}

async function deepCaptureItem(page, item, baseOrigin) {
  const visitedUrls = new Set();
  const screens = [];
  const usedNames = new Set();
  const startUrl = item.href.startsWith('http') ? item.href : `${baseOrigin}${item.href}`;
  const itemName = slugify(item.label) || slugify(item.path) || 'screen';
  const MAX_PER_ITEM = 40;
  const MAX_DEPTH = 4;

  let scopePath;
  try {
    scopePath = new URL(startUrl).pathname;
  } catch {
    scopePath = item.href.split('?')[0];
  }

  async function explorePage(pageUrl, name, depth) {
    if (screens.length >= MAX_PER_ITEM) return;
    if (depth > MAX_DEPTH) return;

    const pad = '  '.repeat(depth + 2);

    if (isTimedOut()) {
      console.log(`${pad}⏱ Timed out (${MAX_TOTAL_TIME / 60000}min), stopping`);
      return;
    }

    const urlKey = pageUrl.split('?')[0];

    if (visitedUrls.has(urlKey)) {
      console.log(`${pad}⤷ Already visited, skipping`);
      return;
    }

    console.log(`${pad}→ ${name} (${pageUrl})`);
    await safeGoto(page, pageUrl, 3000);
    await dismissModals(page);

    const actualUrl = page.url();
    const actualKey = actualUrl.split('?')[0];

    if (actualUrl.includes('/login') || actualUrl.includes('/sign-in')) {
      console.log(`${pad}⤷ Redirected to login, skipping`);
      return;
    }

    if (visitedUrls.has(actualKey)) {
      console.log(`${pad}⤷ Already visited (redirect), skipping`);
      return;
    }

    visitedUrls.add(urlKey);
    visitedUrls.add(actualKey);

    await captureCurrentPage(page, name, usedNames, screens);

    await discoverTabs(page, name, usedNames, screens);

    await fillAndCaptureForms(page, name, usedNames, screens, depth);

    if (screens.length >= MAX_PER_ITEM || depth >= MAX_DEPTH) return;

    await safeGoto(page, pageUrl, 2000);
    await dismissModals(page);

    const subItems = await getAllClickableItems(page, baseOrigin);
    const subLinks = subItems.filter(si => {
      if (si.type !== 'link' || !si.href) return false;
      if (si.href.startsWith('tel:') || si.href.startsWith('mailto:')) return false;
      if (si.label === '(unlabeled)') return false;
      const sp = si.href.split('?')[0];
      if (visitedUrls.has(sp)) return false;
      if (!isInScope(si.href, scopePath, baseOrigin)) {
        return false;
      }
      return true;
    });

    if (subLinks.length > 0) {
      console.log(`${pad}⤷ ${subLinks.length} in-scope sub-links to explore`);
    }

    const cap = Math.min(subLinks.length, 20);
    for (let i = 0; i < cap && screens.length < MAX_PER_ITEM; i++) {
      const sub = subLinks[i];
      const subUrl = sub.href.startsWith('http') ? sub.href : `${baseOrigin}${sub.href}`;
      const subName = `${name}-${slugify(sub.label) || `sub-${i}`}`;

      await explorePage(subUrl, subName, depth + 1);

      await safeGoto(page, pageUrl, 2000);
      await dismissModals(page);
    }
  }

  console.log(`\n  Deep capturing: "${item.label}" → ${startUrl}`);
  console.log(`    Scope: ${scopePath}*`);
  await explorePage(startUrl, itemName, 0);
  console.log(`    ✓ Captured ${screens.length} screens for "${item.label}"`);
  return screens;
}

const MODE = process.argv[2] || 'default';

const MAX_TOTAL_TIME = 10 * 60 * 1000; // 10 minutes
const captureStartTime = Date.now();

function isTimedOut() {
  return Date.now() - captureStartTime > MAX_TOTAL_TIME;
}

async function main() {
  mkdirSync(BROWSER_DATA_DIR, { recursive: true });
  const context = await chromium.launchPersistentContext(BROWSER_DATA_DIR, {
    headless: false,
    viewport,
  });
  const page = context.pages()[0] || await context.newPage();

  await loginIfNeeded(page);

  // Navigate to home after login
  await safeGoto(page, baseUrl, 3000);
  await dismissModals(page);

  if (MODE === 'scout') {
    console.log('  Scout mode: finding navigation items...\n');
    const items = await scoutNavItems(page, baseUrl);
    // Output JSON to stdout for the API to parse
    console.log('__SCOUT_RESULT__' + JSON.stringify(items));
    await context.close();
    return;
  }

  if (MODE === 'deep') {
    const selected = JSON.parse(process.env.CAPTURE_ITEMS || '[]');
    const includeHome = process.env.CAPTURE_INCLUDE_HOME === '1';
    if (selected.length === 0 && !includeHome) {
      console.error('  No items selected for deep capture.');
      process.exit(1);
    }

    console.log(`  Deep capture mode: ${selected.length} items selected${includeHome ? ' + home' : ''}\n`);
    let allCaptures = [];
    const usedNames = new Set();

    if (includeHome) {
      console.log('  Capturing home page...');
      await captureCurrentPage(page, 'home', usedNames, allCaptures);
      await discoverTabs(page, 'home', usedNames, allCaptures);
      await safeGoto(page, baseUrl, 2000);
      await dismissModals(page);
    }

    for (const item of selected) {
      const captures = await deepCaptureItem(page, item, baseUrl);
      allCaptures.push(...captures);
      // Return to home between items
      await safeGoto(page, baseUrl, 2000);
      await dismissModals(page);
    }

    const totalInManifest = writeManifest(allCaptures);
    await context.close();
    console.log(`\n  ✓ Done! ${allCaptures.length} new screenshots. ${totalInManifest} total in manifest.`);
    return;
  }

  // Default mode: full discover or explicit (replaces manifest)
  let captures;
  if (config.discover) {
    console.log('  Discovery mode: finding screens by clicking through the app...\n');
    captures = await discoverScreens(page, baseUrl);
  } else {
    captures = await captureExplicitScreens(page, config.screens || []);
  }

  writeManifest(captures, true);
  await context.close();
  console.log(`\n  ✓ Done! ${captures.length} screenshots saved to public/data/captures/`);
}

main().catch(err => {
  console.error('\n  Capture failed:', err.message, '\n');
  process.exit(1);
});
