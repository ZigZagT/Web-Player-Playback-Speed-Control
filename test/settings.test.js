const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUserscript } = require('./harness');

function activationMessages(env) {
    return env.logs.map(entry => entry[1]).filter(message =>
        typeof message === 'string' && message.startsWith('script '));
}

test('activation logs explain frame eligibility and only repeat when the reason changes', () => {
    const env = loadUserscript({ hostname: 'www.youtube.com', withVideo: false });
    const inactive = 'script not activated (youtube): no video element or saved settings for this site';
    const videoPresent = 'script activated (youtube): video element exists in this frame';
    const savedSettings = 'script activated (youtube): saved settings exist for this site';
    const expectedMessages = [inactive];
    env.tick();
    assert.deepEqual(activationMessages(env), expectedMessages);
    env.keydown('3');
    env.tick(3);
    assert.deepEqual(activationMessages(env), expectedMessages);

    env.body.appendChild(env.video);
    env.keydown('3');
    expectedMessages.push(videoPresent);
    assert.deepEqual(activationMessages(env), expectedMessages);
    env.tick(3);
    assert.deepEqual(activationMessages(env), expectedMessages);

    env.video.remove();
    env.keydown('4');
    expectedMessages.push(inactive);
    assert.deepEqual(activationMessages(env), expectedMessages);
    env.tick(3);
    assert.deepEqual(activationMessages(env), expectedMessages);

    env.body.appendChild(env.video);
    env.tick();
    expectedMessages.push(videoPresent);
    env.toggleMenuItem('Playback Speed (youtube)');
    env.video.remove();
    env.tick();
    expectedMessages.push(savedSettings);
    assert.deepEqual(activationMessages(env), expectedMessages);
    assert.equal(env.store.get('playbackSpeed:youtube'), false);
    assert.equal(env.menuLabels().length, 2);
    const event = env.keydown('3');
    assert.equal(event.defaultPrevented, false);
    assert.equal(event.propagationStopped, false);
    env.tick(3);
    assert.deepEqual(activationMessages(env), expectedMessages);

    env.store.delete('playbackSpeed:youtube');
    env.tick();
    expectedMessages.push(inactive);
    assert.deepEqual(activationMessages(env), expectedMessages);
    assert.deepEqual(env.menuLabels(), []);
    assert.equal(env.slots.playbackSpeedControlNaturalVolumeControl, undefined);
});

test('script activation does not enable features that are off', () => {
    const env = loadUserscript({ hostname: 'example.com' });
    env.tick();
    assert.deepEqual(activationMessages(env), [
        'script activated (example.com): video element exists in this frame',
    ]);
    assert.equal(env.menuLabels().length, 2);
    assert.equal(env.keydown('3').defaultPrevented, false);
    assert.equal(env.video.playbackRate, 1);
    assert.equal(env.slots.playbackSpeedControlNaturalVolumeControl, undefined);
});

test('the volume override follows script activation without depending on the speed feature', () => {
    const env = loadUserscript({ hostname: 'www.youtube.com', withVideo: false });
    env.tick();
    assert.equal(env.slots.playbackSpeedControlNaturalVolumeControl, undefined);

    env.body.appendChild(env.video);
    env.tick();
    assert.equal(env.slots.playbackSpeedControlNaturalVolumeControl, 'userscript');

    env.video.remove();
    env.tick();
    assert.equal(env.slots.playbackSpeedControlNaturalVolumeControl, undefined);
    env.video.volume = 0.5;
    assert.equal(env.nativeVolume(), 0.5);

    env.body.appendChild(env.video);
    env.tick();
    env.toggleMenuItem('Playback Speed (youtube)');
    env.tick();
    assert.equal(env.keydown('3').defaultPrevented, false);
    assert.equal(env.slots.playbackSpeedControlNaturalVolumeControl, 'userscript');
    env.video.volume = 0.5;
    assert.ok(env.nativeVolume() < 0.5);

    env.video.remove();
    env.tick();
    assert.equal(env.menuLabels().length, 2);
    assert.equal(env.slots.playbackSpeedControlNaturalVolumeControl, 'userscript');
    env.toggleMenuItem('Natural Volume (youtube)');
    env.tick();
    assert.equal(env.slots.playbackSpeedControlNaturalVolumeControl, undefined);
});

test('Plex countdown actions require script activation and their own enabled setting', () => {
    const cases = [
        { withVideo: false, stored: {}, shouldClick: false },
        { withVideo: true, stored: {}, shouldClick: true },
        { withVideo: false, stored: { plexSkipAutoPlayCountdown: true }, shouldClick: true },
        { withVideo: false, stored: { plexSkipAutoPlayCountdown: false }, shouldClick: false },
        { withVideo: true, stored: { plexSkipAutoPlayCountdown: false }, shouldClick: false },
        { withVideo: true, stored: { 'playbackSpeed:plex': false }, shouldClick: true },
    ];
    for (const scenario of cases) {
        const env = loadUserscript({
            hostname: 'app.plex.tv',
            withVideo: scenario.withVideo,
            stored: scenario.stored,
        });
        const checkbox = env.createElement('input');
        checkbox.id = 'autoPlayCheck';
        checkbox.checked = true;
        env.body.appendChild(checkbox);
        const button = env.createElement('button');
        button.attributes['aria-label'] = 'Play Next';
        const eventTypes = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'];
        const events = [];
        for (const type of eventTypes) {
            button.addEventListener(type, event => events.push(event.type));
        }
        env.body.appendChild(button);
        env.tick();
        assert.deepEqual(events, scenario.shouldClick ? eventTypes : []);
        env.tick(3);
        assert.deepEqual(events, scenario.shouldClick ? eventTypes : []);
    }
});

test('static Plex activation follows local video presence and logs its reason', () => {
    const env = loadUserscript({ hostname: 'app.plex.tv', userscript: false, withVideo: false });
    env.tick();
    assert.deepEqual(activationMessages(env), [
        'script not activated (plex): no video element or saved settings for this site',
    ]);
    assert.equal(env.slots.playbackSpeedControlNaturalVolumeControl, undefined);
    env.body.appendChild(env.video);
    env.tick();
    assert.equal(env.slots.playbackSpeedControlNaturalVolumeControl, 'static');
    env.video.remove();
    env.tick();
    assert.equal(env.slots.playbackSpeedControlNaturalVolumeControl, undefined);
    assert.deepEqual(activationMessages(env), [
        'script not activated (plex): no video element or saved settings for this site',
        'script activated (plex): video element exists in this frame',
        'script not activated (plex): no video element or saved settings for this site',
    ]);
});

test('initial menu registration waits for the first loop tick, including saved settings', () => {
    for (const withVideo of [true, false]) {
        const env = loadUserscript({
            hostname: 'example.com',
            withVideo,
            stored: withVideo ? {} : { 'playbackSpeed:example.com': false },
        });
        assert.deepEqual(env.menuLabels(), []);
        assert.deepEqual(env.menuOperations, []);

        env.tick();
        assert.deepEqual(env.menuLabels(), [
            'Playback Speed (example.com): Disabled \u2717',
            'Natural Volume (example.com): Disabled \u2717',
        ]);
        assert.equal(env.menuOperations.length, 2);
    }
});

test('plex: both features default on and normalize to one plex name', () => {
    const env = loadUserscript({ hostname: 'app.plex.tv' });
    env.tick();
    assert.deepEqual(env.menuLabels(), [
        'Playback Speed (plex): Enabled \u2713',
        'Natural Volume (plex): Enabled \u2713',
        'Skip Auto Play Countdown: Enabled \u2713',
    ]);
});

test('plex is recognized by port, not only by hostname', () => {
    const env = loadUserscript({ hostname: 'media.example.com', port: '32400' });
    env.tick();
    assert.ok(env.menuItem('Playback Speed (plex)'));
});

test('youtube: both features default on, no plex-only toggle', () => {
    const env = loadUserscript({ hostname: 'www.youtube.com' });
    env.tick();
    assert.deepEqual(env.menuLabels(), [
        'Playback Speed (youtube): Enabled \u2713',
        'Natural Volume (youtube): Enabled \u2713',
    ]);
});

test('other sites: both features default off and are keyed by normalized origin', () => {
    const env = loadUserscript({ hostname: 'www.example.com' });
    env.tick();
    assert.deepEqual(env.menuLabels(), [
        'Playback Speed (example.com): Disabled \u2717',
        'Natural Volume (example.com): Disabled \u2717',
    ]);
});

test('non-default ports are part of the normalized origin', () => {
    const env = loadUserscript({ hostname: 'video.example.com', port: '8080' });
    env.tick();
    assert.ok(env.menuItem('Playback Speed (video.example.com:8080)'));
});

test('frames without a video or saved settings have no menu, even on known sites', () => {
    for (const hostname of ['app.plex.tv', 'www.youtube.com', 'www.example.com']) {
        const env = loadUserscript({ hostname, withVideo: false });
        assert.deepEqual(env.menuLabels(), [], hostname);
        env.tick(3);
        assert.deepEqual(env.menuLabels(), [], hostname);
        assert.deepEqual(env.menuOperations, [], hostname);
        assert.equal(env.store.size, 0, hostname);
    }
});

test('menus follow video insertion and removal without repeatedly registering unchanged commands', () => {
    const env = loadUserscript({ hostname: 'example.com', withVideo: false });
    assert.deepEqual(env.menuLabels(), []);

    env.body.appendChild(env.video);
    env.tick();
    assert.deepEqual(env.menuLabels(), [
        'Playback Speed (example.com): Disabled \u2717',
        'Natural Volume (example.com): Disabled \u2717',
    ]);
    const speedCommand = env.menuItem('Playback Speed (example.com)');
    const volumeCommand = env.menuItem('Natural Volume (example.com)');
    assert.equal(env.menuOperations.length, 2);
    env.tick(3);
    assert.equal(env.menuItem('Playback Speed (example.com)'), speedCommand);
    assert.equal(env.menuItem('Natural Volume (example.com)'), volumeCommand);
    assert.equal(env.menuOperations.length, 2);

    env.video.remove();
    env.tick();
    assert.deepEqual(env.menuLabels(), []);
    assert.equal(env.menuOperations.length, 4);
    env.tick(3);
    assert.deepEqual(env.menuLabels(), []);
    assert.equal(env.menuOperations.length, 4);

    env.body.appendChild(env.video);
    env.tick();
    assert.deepEqual(env.menuLabels(), [
        'Playback Speed (example.com): Disabled \u2717',
        'Natural Volume (example.com): Disabled \u2717',
    ]);
    assert.notEqual(env.menuItem('Playback Speed (example.com)'), speedCommand);
    assert.equal(env.menuOperations.length, 6);
});

test('saved feature settings keep the entire site menu available without a video, including disabled values', () => {
    const sites = [
        { hostname: 'www.example.com', origin: 'example.com', count: 2 },
        { hostname: 'video.example.com', port: '8080', origin: 'video.example.com:8080', count: 2 },
        { hostname: 'app.plex.tv', origin: 'plex', count: 3 },
        { hostname: 'www.youtube.com', origin: 'youtube', count: 2 },
    ];
    for (const site of sites) {
        for (const [feature, label] of [['playbackSpeed', 'Playback Speed'], ['naturalVolume', 'Natural Volume']]) {
            for (const value of [true, false]) {
                const env = loadUserscript({
                    hostname: site.hostname,
                    port: site.port,
                    withVideo: false,
                    stored: { [`${feature}:${site.origin}`]: value },
                });
                env.tick();
                const prefix = `${label} (${site.origin}): ${value ? 'Enabled' : 'Disabled'}`;
                assert.ok(env.menuItem(prefix), prefix);
                assert.equal(env.menuLabels().length, site.count, prefix);
                assert.deepEqual(activationMessages(env), [
                    `script activated (${site.origin}): saved settings exist for this site`,
                ]);
                env.tick(3);
                assert.ok(env.menuItem(prefix), prefix);
                assert.deepEqual(activationMessages(env), [
                    `script activated (${site.origin}): saved settings exist for this site`,
                ]);
                assert.equal(env.menuLabels().length, site.count, prefix);
            }
        }
    }
});

test('saving a setting keeps the menu available after the last video is removed', () => {
    const env = loadUserscript({ hostname: 'example.com' });
    env.tick();
    env.toggleMenuItem('Playback Speed (example.com)');
    env.video.remove();
    env.tick();
    assert.deepEqual(env.menuLabels(), [
        'Playback Speed (example.com): Enabled \u2713',
        'Natural Volume (example.com): Disabled \u2717',
    ]);

    env.toggleMenuItem('Playback Speed (example.com)');
    env.tick();
    assert.equal(env.store.get('playbackSpeed:example.com'), false);
    assert.deepEqual(env.menuLabels(), [
        'Playback Speed (example.com): Disabled \u2717',
        'Natural Volume (example.com): Disabled \u2717',
    ]);
});

test('legacy volume settings retain the menu and their value without a video', () => {
    for (const origin of ['plex', 'youtube']) {
        for (const value of [true, false]) {
            const env = loadUserscript({
                hostname: `www.${origin}.com`,
                withVideo: false,
                stored: { [`${origin}NaturalVolume`]: value },
            });
            env.tick();
            const prefix = `Natural Volume (${origin}): ${value ? 'Enabled' : 'Disabled'}`;
            assert.ok(env.menuItem(prefix), prefix);
            env.tick();
            assert.ok(env.menuItem(prefix), prefix);
            assert.deepEqual(activationMessages(env), [
                `script activated (${origin}): saved settings exist for this site`,
            ]);
            assert.equal(env.store.has(`naturalVolume:${origin}`), false);
        }
    }
});

test('a saved Plex countdown setting retains the Plex menu without a video', () => {
    for (const value of [true, false]) {
        const env = loadUserscript({
            hostname: 'app.plex.tv',
            withVideo: false,
            stored: { plexSkipAutoPlayCountdown: value },
        });
        env.tick();
        assert.equal(env.menuLabels().length, 3);
        assert.ok(env.menuItem(`Skip Auto Play Countdown: ${value ? 'Enabled' : 'Disabled'}`));
        env.tick();
        assert.equal(env.menuLabels().length, 3);
    }
});

test('settings for other sites or ports do not expose a video-free frame menu', () => {
    const env = loadUserscript({
        hostname: 'www.example.com',
        withVideo: false,
        stored: {
            'playbackSpeed:youtube': true,
            'naturalVolume:plex': false,
            'playbackSpeed:example.com:8080': true,
            plexNaturalVolume: false,
            youtubeNaturalVolume: false,
            plexSkipAutoPlayCountdown: false,
        },
    });
    assert.deepEqual(env.menuLabels(), []);
    env.tick();
    assert.deepEqual(env.menuLabels(), []);
});

test('a video in a child document does not enable the parent frame menu or shortcuts', () => {
    const env = loadUserscript({ hostname: 'www.youtube.com', withVideo: false });
    const iframe = env.createElement('iframe');
    iframe.contentDocument = env.createElement('html');
    iframe.contentDocument.appendChild(env.video);
    env.body.appendChild(iframe);

    env.tick();
    assert.deepEqual(env.menuLabels(), []);
    const event = env.keydown('3');
    assert.equal(event.defaultPrevented, false);
    assert.equal(event.propagationStopped, false);
    assert.equal(env.document.querySelector('#playback-speed-prompt'), null);
    assert.equal(env.video.playbackRate, 1);
});

test('static-script mode never registers a menu as videos come and go', () => {
    const env = loadUserscript({ hostname: 'app.plex.tv', userscript: false, withVideo: false });
    env.tick();
    assert.deepEqual(env.menuLabels(), []);
    env.body.appendChild(env.video);
    env.tick();
    assert.deepEqual(env.menuLabels(), []);
    env.video.remove();
    env.tick();
    assert.deepEqual(env.menuLabels(), []);
});

test('a stored value overrides the default', () => {
    const env = loadUserscript({ hostname: 'app.plex.tv', stored: { 'playbackSpeed:plex': false } });
    env.tick();
    assert.ok(env.menuItem('Playback Speed (plex): Disabled'));
});

test('toggling writes the setting under the normalized origin', () => {
    const env = loadUserscript({ hostname: 'example.com' });
    env.tick();
    env.toggleMenuItem('Playback Speed (example.com)');
    env.toggleMenuItem('Natural Volume (example.com)');
    assert.equal(env.store.get('playbackSpeed:example.com'), true);
    assert.equal(env.store.get('naturalVolume:example.com'), true);
});

test('toggling relabels the menu command in place', () => {
    const env = loadUserscript({ hostname: 'app.plex.tv' });
    env.tick();
    env.toggleMenuItem('Playback Speed (plex)');
    assert.ok(env.menuItem('Playback Speed (plex): Disabled'));
    env.toggleMenuItem('Playback Speed (plex)');
    assert.ok(env.menuItem('Playback Speed (plex): Enabled'));
});

test('menu registration preserves feature order and is idempotent before and after label changes', () => {
    const env = loadUserscript({ hostname: 'app.plex.tv' });
    env.tick();
    assert.equal(env.menuOperations.length, 3);

    const labels = env.menuLabels();
    const commands = labels.map(label => env.menuItem(label));
    env.tick(3);
    assert.deepEqual(env.menuLabels(), labels);
    assert.equal(env.menuOperations.length, 3);
    labels.forEach((label, index) => assert.equal(env.menuItem(label), commands[index]));

    for (const state of ['Disabled', 'Enabled']) {
        env.toggleMenuItem('Playback Speed (plex)');
        const expectedLabels = [
            `Playback Speed (plex): ${state} ${state === 'Enabled' ? '\u2713' : '\u2717'}`,
            'Natural Volume (plex): Enabled \u2713',
            'Skip Auto Play Countdown: Enabled \u2713',
        ];
        assert.deepEqual(env.menuLabels(), expectedLabels);
        const operationCount = env.menuOperations.length;
        const updatedCommands = expectedLabels.map(label => env.menuItem(label));
        env.tick(3);
        assert.deepEqual(env.menuLabels(), expectedLabels);
        assert.equal(env.menuOperations.length, operationCount);
        expectedLabels.forEach((label, index) => assert.equal(env.menuItem(label), updatedCommands[index]));
    }
});

test('cached menu registration refreshes every feature toggle without waiting for a tick', () => {
    const env = loadUserscript({ hostname: 'app.plex.tv' });
    env.tick();
    const prefixes = ['Playback Speed (plex)', 'Natural Volume (plex)', 'Skip Auto Play Countdown'];
    const enabledLabels = prefixes.map(prefix => `${prefix}: Enabled \u2713`);
    assert.deepEqual(env.menuLabels(), enabledLabels);

    for (const [index, prefix] of prefixes.entries()) {
        const operationsBeforeToggle = env.menuOperations.length;
        env.toggleMenuItem(prefix);
        const disabledLabels = [...enabledLabels];
        disabledLabels[index] = `${prefix}: Disabled \u2717`;
        assert.deepEqual(env.menuLabels(), disabledLabels);
        assert.equal(env.menuOperations.length, operationsBeforeToggle + 6);

        env.toggleMenuItem(prefix);
        assert.deepEqual(env.menuLabels(), enabledLabels);
        assert.equal(env.menuOperations.length, operationsBeforeToggle + 12);
        env.tick(3);
        assert.deepEqual(env.menuLabels(), enabledLabels);
        assert.equal(env.menuOperations.length, operationsBeforeToggle + 12);
    }
});

test('toggling applies immediately instead of asking for a reload', () => {
    const env = loadUserscript({ hostname: 'app.plex.tv' });
    env.tick();
    env.toggleMenuItem('Playback Speed (plex)');
    assert.deepEqual(env.confirms, []);
    assert.deepEqual(env.reloads, []);
});

test('enabling a feature on an untested site warns first', () => {
    const env = loadUserscript({ hostname: 'example.com' });
    env.tick();
    env.toggleMenuItem('Playback Speed (example.com)');
    assert.equal(env.alerts.length, 1);
    assert.match(env.alerts[0], /number keys 1-9/);

    env.toggleMenuItem('Natural Volume (example.com)');
    assert.equal(env.alerts.length, 2);
    assert.match(env.alerts[1], /generic audio fix/);
});

test('disabling a feature on an untested site does not warn', () => {
    const env = loadUserscript({ hostname: 'example.com', stored: { 'playbackSpeed:example.com': true } });
    env.tick();
    env.toggleMenuItem('Playback Speed (example.com)');
    assert.deepEqual(env.alerts, []);
});

test('tested sites never warn', () => {
    const env = loadUserscript({ hostname: 'app.plex.tv' });
    env.tick();
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
    env.tick();
    assert.ok(env.menuItem('Natural Volume (plex): Disabled'));
    env.tick();
    assert.equal(env.slots.playbackSpeedControlNaturalVolumeControl, undefined);
});

test('legacy youtube volume setting is honoured', () => {
    const env = loadUserscript({ hostname: 'www.youtube.com', stored: { youtubeNaturalVolume: false } });
    env.tick();
    assert.ok(env.menuItem('Natural Volume (youtube): Disabled'));
});

test('the current volume setting wins over the legacy one', () => {
    const env = loadUserscript({
        hostname: 'app.plex.tv',
        stored: { plexNaturalVolume: false, 'naturalVolume:plex': true },
    });
    env.tick();
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
