/**
 * Retakes the screenshots in `docs/`, from a demo board built here rather than
 * from whatever happens to be in a browser.
 *
 *   npm run build
 *   npm i -D playwright-core && node scripts/screenshots.mjs
 *
 * It serves `dist/` itself, writes the board straight into localStorage, and
 * shoots each view at the size the README wants it. The board below is the
 * whole point: a week that shows a full column, an empty one, a done pile, a
 * blocked card and a backlog, with projects and clients behind it that add up
 * to sensible totals — so the pictures explain the app rather than just prove
 * it runs. Change a colour or a default and the docs can be caught up in one
 * command.
 *
 * Set CHROME_PATH to a Chromium binary if playwright-core can't find one.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

let chromium;
try {
  ({ chromium } = await import('playwright-core'));
} catch {
  console.error('This needs playwright-core:  npm i -D playwright-core && node scripts/screenshots.mjs');
  process.exit(1);
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const docs = join(root, 'docs');
const PORT = 4183;
const URL = `http://localhost:${PORT}/`;

/* ---------- the demo board ---------- */

// The week the screenshots are of. Keep it a Mon-Fri, and keep WED the day the
// board calls today when they're taken, or the pictures lose their "today".
const [MON, TUE, WED, THU, FRI] = ['2026-08-31', '2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04'];

const at = (day, hour) => `${day}T${String(hour).padStart(2, '0')}:00:00.000Z`;

const clients = {
  acme: { id: 'acme', name: 'Acme Ltd', colour: '#2179c8' },
  brightwater: { id: 'brightwater', name: 'Brightwater', colour: '#0f8f8a' },
  northgate: { id: 'northgate', name: 'Northgate', colour: '#b81f6a' },
};

const project = (id, title, value, stage, clientId, colour, description = '') => ({
  id, title, description, value, stage, clientId, colour,
  archived: false, createdAt: at(MON, 9), updatedAt: at(WED, 9),
});

// One at each end of the pipeline, so the four totals above the list all have
// something in them.
const projects = [
  project('p-acme-site', 'Acme website refresh', 12500, 'active', 'acme', 'blue',
    '<p>Full rebuild of the marketing site: new IA, design system, and a CMS migration off the old templates.</p>' +
    '<ul data-type="taskList">' +
    '<li data-checked="true" data-type="taskItem"><label><input type="checkbox" checked="checked"><span></span></label><div><p>Discovery workshop</p></div></li>' +
    '<li data-checked="false" data-type="taskItem"><label><input type="checkbox"><span></span></label><div><p>Design sign-off</p></div></li>' +
    '</ul>'),
  project('p-acme-q1', 'Acme Q1 campaign', 5500, 'paid', 'acme', 'green'),
  project('p-bw-guidelines', 'Brightwater brand guidelines', 4200, 'won', 'brightwater', 'purple',
    '<p>Logo lockups, colour, type and a few worked examples.</p>'),
  project('p-halcyon', 'Halcyon microsite', 3800, 'quoted', 'brightwater', 'amber'),
  project('p-ng-concept', 'Northgate app concept', 9000, 'enquiry', 'northgate', 'pink'),
  project('p-ng-retainer', 'Northgate retainer — Q3', 6000, 'invoiced', 'northgate', 'teal'),
];

/** title, category, status, hours, start (minutes past midnight), project, clients, lane, extras */
const rows = [
  ['Homepage wireframes', 'purple', 'done', 2, 9 * 60, 'p-acme-site', ['acme'], MON, {}],
  ['Weekly planning', 'teal', 'done', 0.5, 8 * 60, null, [], MON, {}],

  ['Design system — type scale', 'purple', 'doing', 3, 9 * 60 + 30, 'p-acme-site', ['acme'], TUE, {}],
  ['Invoice run', 'green', 'done', 0.5, 16 * 60, null, [], TUE, {}],

  ['CMS migration spike', 'blue', 'doing', 3, 9 * 60, 'p-acme-site', ['acme'], WED, { publish: true }],
  ['Call with Brightwater about the logo lockups', 'teal', 'todo', 1, 13 * 60, 'p-bw-guidelines', ['brightwater'], WED,
    { publish: true, description: '<p>Go through the two lockup options and agree which goes in the guidelines.</p>' }],
  ['Write the Q3 retainer summary', 'green', 'todo', 1, 15 * 60, 'p-ng-retainer', ['northgate'], WED, {}],
  ['Stand-up notes', 'slate', 'done', 0.25, null, null, [], WED, {}],

  ['Colour and contrast pass', 'purple', 'todo', 2, null, 'p-bw-guidelines', ['brightwater'], THU, {}],
  ['Northgate — accessibility audit', 'red', 'blocked', 4, null, 'p-ng-retainer', ['northgate'], THU,
    { description: '<p>Blocked until they send the staging credentials.</p>' }],

  ['Guidelines first draft', 'purple', 'todo', 3, null, 'p-bw-guidelines', ['brightwater'], FRI, {}],

  ['Rewrite the case studies page', 'amber', 'todo', 2, null, 'p-acme-site', ['acme'], 'backlog', {}],
  ['Look at swapping the analytics', 'slate', 'todo', 1, null, null, [], 'backlog', {}],
];

const cards = {};
const lanes = { [MON]: [], [TUE]: [], [WED]: [], [THU]: [], [FRI]: [], backlog: [] };

rows.forEach(([title, colour, status, estimate, start, projectId, tags, lane, extra], i) => {
  const id = `demo-${i}`;
  cards[id] = {
    id, title, description: '', colour, status, estimate, start,
    projectId, clients: tags, publish: false, eventId: null,
    completedAt: status === 'done' ? at(lane === 'backlog' ? WED : lane, 16) : null,
    createdAt: at(MON, 8), updatedAt: at(WED, 10),
    ...extra,
  };
  lanes[lane].push(id);
});

// No `categories`: the board picks up whatever the app's own defaults are, so
// the screenshots follow a recoloured palette without being edited.
const board = {
  version: 2,
  cards,
  lanes,
  projects: Object.fromEntries(projects.map((p) => [p.id, p])),
  clients,
  clientOrder: ['acme', 'brightwater', 'northgate'],
  orphanedEvents: [],
};

const settings = (theme) => ({
  includeWeekend: false, capacity: 6, theme,
  defaultCategory: 'slate', showDescription: true, cardSurface: 'drawer',
  dayStart: 8, dayEnd: 19, m365: { tenant: 'common', clientId: '' },
});

/* ---------- serving it ---------- */

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT)], { cwd: root, stdio: 'ignore' });
const stop = () => server.kill();
process.on('exit', stop);

for (let attempt = 0; ; attempt++) {
  try {
    await fetch(URL);
    break;
  } catch {
    if (attempt > 40) {
      stop();
      throw new Error(`nothing serving ${URL} — is dist/ built? (npm run build)`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

/* ---------- shooting it ---------- */

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });

async function shoot(name, { width, height, theme = 'light', before }) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 2,
    // The board is drawn from local day keys, and the demo week is written in
    // British time; a machine in Auckland would otherwise shoot the wrong day.
    timezoneId: 'Europe/London',
    colorScheme: theme,
    reducedMotion: 'reduce',
  });
  await context.addInitScript(([b, s]) => {
    localStorage.setItem('tcard-planner.board.v1', b);
    localStorage.setItem('tcard-planner.settings.v1', s);
  }, [JSON.stringify(board), JSON.stringify(settings(theme))]);

  const page = await context.newPage();
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  if (before) await before(page);
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(docs, name) });
  await context.close();
  console.log(`shot docs/${name}`);
}

const WIDE = { width: 1400, height: 820 };
// The drawer and the settings dialog are both taller than the board needs.
const TALL = { width: 1400, height: 900 };
const PHONE = { width: 390, height: 844 };

await shoot('board.png', WIDE);
await shoot('board-dark.png', { ...WIDE, theme: 'dark' });
await shoot('day.png', { ...WIDE, before: (p) => p.getByRole('tab', { name: 'Day' }).click() });
await shoot('month.png', { ...WIDE, before: (p) => p.getByRole('tab', { name: 'Month' }).click() });
await shoot('projects.png', {
  ...WIDE,
  before: async (p) => {
    await p.getByRole('tab', { name: 'Projects' }).click();
    await p.getByText('Acme website refresh', { exact: true }).first().click();
  },
});
await shoot('clients.png', {
  ...WIDE,
  before: async (p) => {
    await p.getByRole('tab', { name: 'Clients' }).click();
    await p.getByText('Acme Ltd', { exact: true }).first().click();
  },
});
await shoot('card.png', {
  ...TALL,
  before: (p) => p.getByText('Call with Brightwater about the logo lockups').first().click(),
});
await shoot('settings.png', { ...TALL, before: (p) => p.getByRole('button', { name: 'Settings' }).click() });
await shoot('mobile.png', PHONE);

await browser.close();
stop();
