const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUserscript } = require('./harness');

test('plex: both features default on and normalize to one plex name', () => {
    const env = loadUserscript({ hostname: 'app.plex.tv' });
    assert.deepEqual(env.menuLabels(), [
        'Playback Speed (plex): Enabled \u2713',
        'Natural Volume (plex): Enabled \u2713',
        'Skip Auto Play Countdown: Enabled \u2713',
    ]);
});

test('plex is recognized by port, not only by hostname', () => {
    const env = loadUserscript({ hostname: 'media.example.com', port: '32400' });
    assert.ok(env.menuItem('Playback Speed (plex)'));
});

test('youtube: both features default on, no plex-only toggle', () => {
    const env = loadUserscript({ hostname: 'www.youtube.com' });
    assert.deepEqual(env.menuLabels(), [
        'Playback Speed (youtube): Enabled \u2713',
        'Natural Volume (youtube): Enabled \u2713',
    ]);
});

test('other sites: both features default off and are keyed by normalized origin', () => {
    const env = loadUserscript({ hostname: 'www.example.com' });
    assert.deepEqual(env.menuLabels(), [
        'Playback Speed (example.com): Disabled \u2717',
        'Natural Volume (example.com): Disabled \u2717',
    ]);
});

test('non-default ports are part of the normalized origin', () => {
    const env = loadUserscript({ hostname: 'video.example.com', port: '8080' });
    assert.ok(env.menuItem('Playback Speed (video.example.com:8080)'));
});

test('a stored value overrides the default', () => {
    const env = loadUserscript({ hostname: 'app.plex.tv', stored: { 'playbackSpeed:plex': false } });
    assert.ok(env.menuItem('Playback Speed (plex): Disabled'));
});

test('toggling writes the setting under the normalized origin', () => {
    const env = loadUserscript({ hostname: 'example.com' });
    env.toggleMenuItem('Playback Speed (example.com)');
    env.toggleMenuItem('Natural Volume (example.com)');
    assert.equal(env.store.get('playbackSpeed:example.com'), true);
    assert.equal(env.store.get('naturalVolume:example.com'), true);
});

test('toggling relabels the menu command in place', () => {
    const env = loadUserscript({ hostname: 'app.plex.tv' });
    env.toggleMenuItem('Playback Speed (plex)');
    assert.ok(env.menuItem('Playback Speed (plex): Disabled'));
    env.toggleMenuItem('Playback Speed (plex)');
    assert.ok(env.menuItem('Playback Speed (plex): Enabled'));
});

test('toggling applies immediately instead of asking for a reload', () => {
    const env = loadUserscript({ hostname: 'app.plex.tv' });
    env.toggleMenuItem('Playback Speed (plex)');
    assert.deepEqual(env.confirms, []);
    assert.deepEqual(env.reloads, []);
});

test('enabling a feature on an untested site warns first', () => {
    const env = loadUserscript({ hostname: 'example.com' });
    env.toggleMenuItem('Playback Speed (example.com)');
    assert.equal(env.alerts.length, 1);
    assert.match(env.alerts[0], /number keys 1-9/);

    env.toggleMenuItem('Natural Volume (example.com)');
    assert.equal(env.alerts.length, 2);
    assert.match(env.alerts[1], /generic audio fix/);
});

test('disabling a feature on an untested site does not warn', () => {
    const env = loadUserscript({ hostname: 'example.com', stored: { 'playbackSpeed:example.com': true } });
    env.toggleMenuItem('Playback Speed (example.com)');
    assert.deepEqual(env.alerts, []);
});

test('tested sites never warn', () => {
    const env = loadUserscript({ hostname: 'app.plex.tv' });
    env.toggleMenuItem('Playback Speed (plex)');
    env.toggleMenuItem('Playback Speed (plex)');
    env.toggleMenuItem('Natural Volume (plex)');
    env.toggleMenuItem('Natural Volume (plex)');
    assert.deepEqual(env.alerts, []);
});

// v2.2 kept the volume toggle in plexNaturalVolume / youtubeNaturalVolume.
// Those users must not silently get the feature switched back on.
test('legacy plex volume setting is honoured', () => {
    const env = loadUserscript({ hostname: 'app.plex.tv', stored: { plexNaturalVolume: false } });
    assert.ok(env.menuItem('Natural Volume (plex): Disabled'));
    env.tick();
    assert.equal(env.slots.playbackSpeedControlNaturalVolumeControl, undefined);
});

test('legacy youtube volume setting is honoured', () => {
    const env = loadUserscript({ hostname: 'www.youtube.com', stored: { youtubeNaturalVolume: false } });
    assert.ok(env.menuItem('Natural Volume (youtube): Disabled'));
});

test('the current volume setting wins over the legacy one', () => {
    const env = loadUserscript({
        hostname: 'app.plex.tv',
        stored: { plexNaturalVolume: false, 'naturalVolume:plex': true },
    });
    assert.ok(env.menuItem('Natural Volume (plex): Enabled'));
});

test('static-script mode on plex runs with defaults and no menu', () => {
    const env = loadUserscript({ hostname: 'app.plex.tv', userscript: false });
    assert.deepEqual(env.menuLabels(), []);
    env.keydown('3');
    env.tick();
    assert.equal(env.video.playbackRate, 2);
    assert.equal(env.slots.playbackSpeedControlNaturalVolumeControl, 'static');
});

test('static-script mode bails on non-plex sites', () => {
    const env = loadUserscript({ hostname: 'example.com', userscript: false });
    assert.equal(env.keydownListenerCount(), 0);
    env.tick();
    assert.equal(env.slots.playbackSpeedControlNaturalVolumeControl, undefined);
});

test('a second instance stands down while one is already running', () => {
    const env = loadUserscript({ hostname: 'app.plex.tv' });
    assert.equal(env.slots.playbackSpeedControlUserscript, 'active');
    assert.equal(env.keydownListenerCount(), 1);
});
