import { chromium } from 'playwright';
import { readFileSync } from 'fs';
import { resolve, join } from 'path';

const ROOT = resolve(import.meta.dirname, '..');
const CONFIG_PATH = join(ROOT, '.app-screens.json');
const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
const baseUrl = config.appUrl.replace(/\/$/, '');
const viewport = config.viewport || { width: 390, height: 844 };

async function main() {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();

  const loginUrl = `${baseUrl}${config.login.url}`;
  console.log(`\n  Logging in at ${loginUrl}`);
  await page.goto(loginUrl, { waitUntil: 'networkidle' });

  for (const step of config.login.steps) {
    if (step.action === 'fill') {
      const el = await page.waitForSelector(step.selector, { timeout: 10000 });
      await el.fill(step.value);
    } else if (step.action === 'submit') {
      await page.keyboard.press('Enter');
      await page.waitForTimeout(1000);
    } else if (step.action === 'wait') {
      await page.waitForTimeout(step.ms || 2000);
    }
  }

  if (page.url().includes('/login')) {
    console.log('\n  ⏳ Complete MFA in the browser window...\n');
    await page.waitForURL(url => !url.toString().includes('/login'), { timeout: 120000 });
  }

  await page.waitForTimeout(5000);
  console.log(`  ✓ Logged in at: ${page.url()}\n`);

  // Deep recursive shadow DOM walk -- find EVERYTHING
  const report = await page.evaluate(() => {
    const result = {
      tree: [],
      allClickable: [],
      allLinks: [],
      allText: [],
      customElements: [],
    };

    let depth = 0;

    function walk(root, path) {
      if (!root || depth > 15) return;
      depth++;

      const elements = root.querySelectorAll('*');
      for (const el of elements) {
        const tag = el.tagName.toLowerCase();
        const rect = el.getBoundingClientRect();
        const isVisible = rect.width > 0 && rect.height > 0;

        // Track custom elements (contain a hyphen)
        if (tag.includes('-') && el.shadowRoot) {
          result.customElements.push({
            tag,
            path: path + ' > ' + tag,
            childCount: el.shadowRoot.querySelectorAll('*').length,
            hasShadow: true,
          });
          walk(el.shadowRoot, path + ' > ' + tag + '::shadow');
        }

        // Collect clickable things
        const isLink = tag === 'a' && el.getAttribute('href');
        const isButton = tag === 'button';
        const hasRole = ['link', 'tab', 'menuitem', 'button', 'option'].includes(el.getAttribute('role'));
        const hasClick = el.hasAttribute('onclick');
        const isInteractive = tag === 'input' || tag === 'select' || tag === 'textarea';

        if ((isLink || isButton || hasRole || hasClick) && isVisible) {
          const text = el.textContent.trim().replace(/\s+/g, ' ').slice(0, 80);
          const info = {
            tag,
            role: el.getAttribute('role') || null,
            href: el.getAttribute('href') || null,
            text: text || '(empty)',
            x: Math.round(rect.x + rect.width / 2),
            y: Math.round(rect.y + rect.height / 2),
            w: Math.round(rect.width),
            h: Math.round(rect.height),
            path: path + ' > ' + tag,
          };
          result.allClickable.push(info);
        }

        // Collect visible text elements that look like section headers
        if (isVisible && !isInteractive && el.children.length === 0) {
          const text = el.textContent.trim();
          if (text && text.length > 1 && text.length < 50) {
            // Only collect unique-ish text
            if (!result.allText.some(t => t.text === text)) {
              result.allText.push({
                tag,
                text,
                x: Math.round(rect.x),
                y: Math.round(rect.y),
                path: path + ' > ' + tag,
              });
            }
          }
        }
      }
      depth--;
    }

    walk(document, 'document');
    return result;
  });

  console.log('  === Custom Elements (shadow DOM hosts) ===\n');
  for (const ce of report.customElements) {
    console.log(`    ${ce.path}  (${ce.childCount} children)`);
  }

  console.log(`\n  === All Clickable Elements (${report.allClickable.length}) ===\n`);
  for (const item of report.allClickable) {
    console.log(`    [${item.tag}${item.role ? ' role='+item.role : ''}] "${item.text}" at (${item.x}, ${item.y}) ${item.w}x${item.h}${item.href ? ' href='+item.href : ''}`);
  }

  console.log(`\n  === Visible Text (${report.allText.length} unique) ===\n`);
  for (const t of report.allText.slice(0, 60)) {
    console.log(`    "${t.text}" at (${t.x}, ${t.y})`);
  }

  await browser.close();
}

main().catch(err => {
  console.error('  Failed:', err.message);
  process.exit(1);
});
