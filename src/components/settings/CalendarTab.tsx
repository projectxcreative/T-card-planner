import { useEffect, useRef, useState } from 'react';
import type { CalendarFeed } from '../../feed';
import { webcalOf } from '../../feed';
import type { M365 } from '../../m365';
import { hasBuiltInApp, redirectUri } from '../../m365';
import { useSettings, useSettingsActions } from '../../store/settingsStore';
import type { Settings } from '../../types';

interface CalendarTabProps {
  m365: M365;
  feed: CalendarFeed;
}

const PAST_CHOICES: { value: string; label: string }[] = [
  { value: '30', label: 'The last month' },
  { value: '90', label: 'The last three months' },
  { value: '365', label: 'The last year' },
  { value: 'all', label: 'Everything on the board' },
];

const ALARM_CHOICES: { value: string; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: '0', label: 'At the start' },
  { value: '5', label: '5 minutes before' },
  { value: '15', label: '15 minutes before' },
  { value: '30', label: '30 minutes before' },
  { value: '60', label: 'An hour before' },
];

const FEED_NAME_MAX = 60;

function CalendarFeedPanel({ feed }: { feed: CalendarFeed }) {
  const { options, url } = feed.feed;
  const [copied, setCopied] = useState(false);
  const [name, setName] = useState(options.name);
  const linkRef = useRef<HTMLInputElement>(null);

  useEffect(() => setName(options.name), [options.name]);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  const made = feed.feed.createdAt
    ? new Date(feed.feed.createdAt).toLocaleDateString(undefined, {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
    : '';

  const commitName = () => {
    const next = name.trim().slice(0, FEED_NAME_MAX);
    if (!next) {
      setName(options.name);
      return;
    }
    if (next !== options.name) feed.update({ name: next });
  };

  const copy = () => {
    if (!url) return;
    void navigator.clipboard
      ?.writeText(url)
      .then(() => setCopied(true))
      .catch(() => linkRef.current?.select());
  };

  return (
    <section className="settings-section">
      <h3 className="settings-title">Subscribe from your calendar</h3>
      <p className="settings-note">
        Publishes the board at one address your calendar app can fetch. In Microsoft 365, that's{' '}
        <strong>Add calendar → Subscribe from web</strong>; Outlook then keeps it beside your own entries and
        re-reads it on its own schedule. Nothing signs in, so nothing expires — and nothing can write back, so
        the calendar you get is read-only. The board stays the original.
      </p>

      {feed.status === 'unavailable' && (
        <p className="settings-note">
          This one needs the board's own server: a board that only lives in this browser has nowhere to publish
          from. Set syncing up first — the badge in the toolbar does it.
        </p>
      )}

      {feed.status === 'loading' && <p className="settings-note">Asking the server…</p>}

      {feed.status === 'ready' && !feed.feed.enabled && (
        <div className="settings-actions">
          <button type="button" className="ghost accent" disabled={feed.busy} onClick={feed.create}>
            {feed.busy ? 'Making a link…' : 'Create a calendar link'}
          </button>
        </div>
      )}

      {feed.status === 'ready' && feed.feed.enabled && url && (
        <>
          <div className="feed-link">
            <input
              ref={linkRef}
              type="text"
              className="cat-label"
              value={url}
              readOnly
              spellCheck={false}
              aria-label="Calendar subscription link"
              onFocus={(event) => event.target.select()}
            />
            <button type="button" className="ghost accent" onClick={copy}>
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <p className="settings-note">
            Treat it like a password: anyone who has the link can read every card on the board, without logging
            in to anything. A desktop calendar will usually take it as <code>{webcalOf(url)}</code> instead, which
            opens the app rather than the browser.
            {made && ` Made ${made}.`}
          </p>

          <label className="settings-row">
            <span>
              What it's called
              <span className="settings-hint">The name the calendar suggests for itself</span>
            </span>
            <input
              type="text"
              className="cat-label settings-wide"
              value={name}
              maxLength={FEED_NAME_MAX}
              onChange={(event) => setName(event.target.value)}
              onBlur={commitName}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur();
              }}
            />
          </label>

          <label className="settings-row">
            <span>
              What goes in it
              <span className="settings-hint">Every card with a day, or only the ticked ones</span>
            </span>
            <select
              value={options.scope}
              onChange={(event) => feed.update({ scope: event.target.value as 'all' | 'published' })}
            >
              <option value="all">Every scheduled card</option>
              <option value="published">Only cards ticked to publish</option>
            </select>
          </label>

          <label className="settings-row">
            <span>
              Include finished cards
              <span className="settings-hint">Shown as free time rather than busy</span>
            </span>
            <input
              type="checkbox"
              checked={options.includeDone}
              onChange={(event) => feed.update({ includeDone: event.target.checked })}
            />
          </label>

          <label className="settings-row">
            <span>
              How far back
              <span className="settings-hint">Older days drop out rather than piling up</span>
            </span>
            <select
              value={options.pastDays === null ? 'all' : String(options.pastDays)}
              onChange={(event) =>
                feed.update({ pastDays: event.target.value === 'all' ? null : Number(event.target.value) })
              }
            >
              {PAST_CHOICES.map((choice) => (
                <option key={choice.value} value={choice.value}>
                  {choice.label}
                </option>
              ))}
              {options.pastDays !== null && !PAST_CHOICES.some((c) => c.value === String(options.pastDays)) && (
                <option value={String(options.pastDays)}>{`The last ${options.pastDays} days`}</option>
              )}
            </select>
          </label>

          <label className="settings-row">
            <span>
              Reminder
              <span className="settings-hint">Only on work still to do, and only if your app honours it</span>
            </span>
            <select
              value={options.alarmMinutes === null ? 'none' : String(options.alarmMinutes)}
              onChange={(event) =>
                feed.update({ alarmMinutes: event.target.value === 'none' ? null : Number(event.target.value) })
              }
            >
              {ALARM_CHOICES.map((choice) => (
                <option key={choice.value} value={choice.value}>
                  {choice.label}
                </option>
              ))}
            </select>
          </label>

          <p className="settings-note">
            Times go out in <code>{options.timeZone}</code>, from the device that made the link. Cards with no
            time of their own arrive as all-day items, because “sometime on Thursday” is what they say.
          </p>

          <div className="settings-actions">
            <button
              type="button"
              className="ghost"
              disabled={feed.busy}
              title="Mint a new link and kill this one"
              onClick={() => {
                if (
                  window.confirm(
                    'Replace the link? The one you have now stops working straight away, and every calendar subscribed to it will have to be pointed at the new one.',
                  )
                ) {
                  feed.rotate();
                }
              }}
            >
              Replace the link
            </button>
            <button
              type="button"
              className="ghost danger"
              disabled={feed.busy}
              onClick={() => {
                if (window.confirm('Turn the feed off? The link stops working, and subscribed calendars empty out.')) {
                  feed.remove();
                }
              }}
            >
              Turn it off
            </button>
          </div>
        </>
      )}

      {feed.error && <p className="settings-note is-error">{feed.error}</p>}
    </section>
  );
}

export default function CalendarTab({ m365, feed }: CalendarTabProps) {
  const settings = useSettings();
  const { updateSettings } = useSettingsActions();

  return (
    <>
      <section className="settings-section">
        <h3 className="settings-title">The week</h3>

        <label className="settings-row">
          <span>
            Show the weekend
            <span className="settings-hint">Saturday and Sunday columns</span>
          </span>
          <input
            type="checkbox"
            checked={settings.includeWeekend}
            onChange={(event) => updateSettings({ includeWeekend: event.target.checked })}
          />
        </label>

        <label className="settings-row">
          <span>
            Hours in a day
            <span className="settings-hint">A day's bar turns red past this</span>
          </span>
          <input
            type="number"
            className="settings-number"
            min={1}
            max={24}
            step={1}
            value={settings.capacity}
            onChange={(event) =>
              updateSettings({ capacity: Math.min(24, Math.max(1, Number(event.target.value) || 1)) })
            }
          />
        </label>

        <label className="settings-row">
          <span>
            Day view starts at
            <span className="settings-hint">The first hour on the timeline</span>
          </span>
          <input
            type="number"
            className="settings-number"
            min={0}
            max={23}
            step={1}
            value={settings.dayStart}
            onChange={(event) => {
              const hour = Math.min(23, Math.max(0, Number(event.target.value) || 0));
              updateSettings({ dayStart: hour, dayEnd: Math.max(settings.dayEnd, hour + 1) });
            }}
          />
        </label>

        <label className="settings-row">
          <span>
            …and ends at
            <span className="settings-hint">The last hour on the timeline</span>
          </span>
          <input
            type="number"
            className="settings-number"
            min={1}
            max={24}
            step={1}
            value={settings.dayEnd}
            onChange={(event) => {
              const hour = Math.min(24, Math.max(1, Number(event.target.value) || 1));
              updateSettings({ dayEnd: hour, dayStart: Math.min(settings.dayStart, hour - 1) });
            }}
          />
        </label>

        <label className="settings-row">
          <span>
            Dark theme
            <span className="settings-hint">Also on the toolbar</span>
          </span>
          <input
            type="checkbox"
            checked={settings.theme === 'dark'}
            onChange={(event) => updateSettings({ theme: event.target.checked ? 'dark' : 'light' })}
          />
        </label>

        <label className="settings-row">
          <span>
            Skin
            <span className="settings-hint">Shape and type, independent of light and dark</span>
          </span>
          <select
            value={settings.skin}
            onChange={(event) => updateSettings({ skin: event.target.value as Settings['skin'] })}
          >
            <option value="default">Default</option>
            <option value="draft">Draft</option>
          </select>
        </label>
      </section>

      <CalendarFeedPanel feed={feed} />

      <section className="settings-section">
        <h3 className="settings-title">Microsoft 365 calendar</h3>
        <p className="settings-note">
          Reads your Outlook calendar into the day and month views, and writes an entry for any card you tick
          “publish” on.{' '}
          {hasBuiltInApp
            ? 'Connect and Microsoft will ask you to sign in and approve the two permissions it needs — reading your profile, and reading and writing your calendar.'
            : 'This build ships without an app registration, so you will need to point it at one of your own below.'}
        </p>
        <p className="settings-note">
          Worth knowing: Microsoft only issues a browser app a sign-in that lasts a day or so, and it cannot
          be extended from here — so this connection asks to be made again about that often. That is the
          price of signing in as you, and it buys the half a feed can't do: seeing your existing meetings on
          the board. If all you want is the cards showing up in Outlook, subscribe to the link above instead
          and there is nothing left to expire.
        </p>

        <div className="settings-row">
          <span>
            {m365.status === 'connected' ? 'Connected' : 'Not connected'}
            <span className="settings-hint">
              {m365.status === 'connected'
                ? m365.account || 'Signed in'
                : m365.status === 'unconfigured'
                  ? 'Add a client ID below first'
                  : 'Sign in with your Microsoft account'}
            </span>
          </span>
          {m365.status === 'connected' ? (
            <button type="button" className="ghost" onClick={m365.disconnect}>
              Disconnect
            </button>
          ) : (
            <button
              type="button"
              className="ghost accent"
              disabled={m365.status === 'unconfigured' || m365.status === 'connecting'}
              onClick={m365.connect}
            >
              {m365.status === 'connecting' ? 'Connecting…' : 'Connect Microsoft 365'}
            </button>
          )}
        </div>

        {m365.error && <p className="settings-note is-error">{m365.error}</p>}

        <details className="settings-more" open={!hasBuiltInApp}>
          <summary>Use your own app registration</summary>
          <p className="settings-note">
            An Entra ID app registration, registered as a <strong>single-page application</strong> with{' '}
            <code>{redirectUri()}</code> as a redirect URI, and delegated Microsoft Graph permissions{' '}
            <code>Calendars.ReadWrite</code> and <code>User.Read</code>. Leave the client ID blank to go back to
            the one this build ships with.
          </p>

          <label className="settings-row">
            <span>
              Client ID
              <span className="settings-hint">From the app registration's overview</span>
            </span>
            <input
              type="text"
              className="cat-label settings-wide"
              value={settings.m365.clientId}
              placeholder={hasBuiltInApp ? 'Using the built-in one' : '00000000-0000-0000-0000-000000000000'}
              spellCheck={false}
              onChange={(event) =>
                updateSettings({ m365: { ...settings.m365, clientId: event.target.value.trim() } })
              }
            />
          </label>

          <label className="settings-row">
            <span>
              Tenant
              <span className="settings-hint">Your tenant id or domain, or “common”</span>
            </span>
            <input
              type="text"
              className="cat-label settings-wide"
              value={settings.m365.tenant}
              placeholder="common"
              spellCheck={false}
              onChange={(event) =>
                updateSettings({ m365: { ...settings.m365, tenant: event.target.value.trim() } })
              }
            />
          </label>
        </details>
      </section>
    </>
  );
}
