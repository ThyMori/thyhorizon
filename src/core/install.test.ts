// Tests des règles d'installation : appareils, report d'une semaine, trois fois au plus.
import { describe, expect, it } from 'vitest';
import { MAX_SNOOZES, SNOOZE_MS, bannerAllowed, detectPlatform, sanitizeInstallState, snooze } from './install';

const UA = {
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1',
  android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36',
  firefoxAndroid: 'Mozilla/5.0 (Android 14; Mobile; rv:121.0) Gecko/121.0 Firefox/121.0',
  firefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
  chrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36',
  edge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36 Edg/120.0',
  macSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15',
  macChrome: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0 Safari/537.36',
};

describe('detectPlatform', () => {
  it('reconnaît les appareils', () => {
    expect(detectPlatform({ userAgent: UA.iphone })).toBe('ios');
    expect(detectPlatform({ userAgent: UA.macSafari, platform: 'MacIntel', maxTouchPoints: 5 })).toBe('ios'); // iPad qui se fait passer pour un Mac
    expect(detectPlatform({ userAgent: UA.android })).toBe('android');
    expect(detectPlatform({ userAgent: UA.firefoxAndroid })).toBe('android'); // Android avant Firefox
    expect(detectPlatform({ userAgent: UA.firefox })).toBe('firefox-desktop');
    expect(detectPlatform({ userAgent: UA.chrome })).toBe('desktop-chromium');
    expect(detectPlatform({ userAgent: UA.edge })).toBe('desktop-chromium');
    expect(detectPlatform({ userAgent: UA.macSafari, platform: 'MacIntel', maxTouchPoints: 0 })).toBe('mac-safari');
    expect(detectPlatform({ userAgent: UA.macChrome, platform: 'MacIntel', maxTouchPoints: 0 })).toBe('desktop-chromium');
  });
});

describe('bannerAllowed', () => {
  const now = 1_000_000_000_000;
  it('s\'affiche la première fois', () => {
    expect(bannerAllowed({}, now, 'android', false)).toBe(true);
    expect(bannerAllowed({}, now, 'desktop-chromium', false)).toBe(true);
  });
  it('ne s\'affiche pas si l\'application est déjà installée ou ouverte comme application', () => {
    expect(bannerAllowed({ installed: true }, now, 'android', false)).toBe(false);
    expect(bannerAllowed({}, now, 'android', true)).toBe(false);
  });
  it('ne s\'affiche jamais sur Firefox pour ordinateur', () => {
    expect(bannerAllowed({}, now, 'firefox-desktop', false)).toBe(false);
  });
  it('se tait une semaine après « Plus tard », puis revient', () => {
    const s = snooze({}, now);
    expect(s.snoozedUntil).toBe(now + SNOOZE_MS);
    expect(bannerAllowed(s, now + SNOOZE_MS - 1, 'android', false)).toBe(false);
    expect(bannerAllowed(s, now + SNOOZE_MS, 'android', false)).toBe(true);
  });
  it('ne revient plus tout seul après trois reports', () => {
    let s = {};
    for (let i = 0; i < MAX_SNOOZES; i++) s = snooze(s, now);
    expect(bannerAllowed(s, now + 10 * SNOOZE_MS, 'android', false)).toBe(false);
  });
});

describe('sanitizeInstallState', () => {
  it('ignore ce qui n\'est pas valide', () => {
    expect(sanitizeInstallState(null)).toEqual({});
    expect(sanitizeInstallState('x')).toEqual({});
    expect(sanitizeInstallState({ installed: 'oui', snoozedUntil: NaN, count: -2 })).toEqual({});
    expect(sanitizeInstallState({ installed: true, snoozedUntil: 5, count: 2.7 })).toEqual({ installed: true, snoozedUntil: 5, count: 2 });
  });
});
