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
    assert.equal(env.menuLabels().length, 3);
    const event = env.keydown('3');
    assert.equal(event.defaultPrevented, false);
    assert.equal(event.propagationStopped, false);
    env.tick(3);
    assert.deepEqual(activationMessages(env), expectedMessages);

    env.store.delete('playbackSpeed:youtube');
    env.tick();
    assert.deepEqual(activationMessages(env), expectedMessages);
    assert.equal(env.menuLabels().length, 3);
    const reloaded = loadUserscript({ hostname: 'www.youtube.com', withVideo: false, stored: Object.fromEntries(env.store) });
    reloaded.tick();
    assert.deepEqual(activationMessages(reloaded), [inactive]);
    assert.deepEqual(reloaded.menuLabels(), []);
    assert.equal(reloaded.slots.playbackSpeedControlNaturalVolumeControl, undefined);
});

test('script activation does not enable features that are off', () => {
    const env = loadUserscript({ hostname: 'example.com' });
    env.tick();
    assert.deepEqual(activationMessages(env), [
        'script activated (example.com): video element exists in this frame',
    ]);
    assert.equal(env.menuLabels().length, 3);
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
    assert.equal(env.menuLabels().length, 3);
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
            'Enable for PiP (example.com): Disabled \u2717',
        ]);
        assert.equal(env.menuOperations.length, 3);
    }
});

test('Plex enables speed, volume and PiP by default under the shared plex settings scope', () => {
    const env = loadUserscript({ hostname: 'app.plex.tv' });
    env.tick();
    assert.deepEqual(env.menuLabels(), [
        'Playback Speed (plex): Enabled \u2713',
        'Natural Volume (plex): Enabled \u2713',
        'Enable for PiP (plex): Enabled \u2713',
        'Skip Auto Play Countdown: Enabled \u2713',
    ]);
});

test('plex is recognized by port, not only by hostname', () => {
    const env = loadUserscript({ hostname: 'media.example.com', port: '32400' });
    env.tick();
    assert.ok(env.menuItem('Playback Speed (plex)'));
});

test('YouTube enables speed, volume and PiP by default without the Plex-only toggle', () => {
    const env = loadUserscript({ hostname: 'www.youtube.com' });
    env.tick();
    assert.deepEqual(env.menuLabels(), [
        'Playback Speed (youtube): Enabled \u2713',
        'Natural Volume (youtube): Enabled \u2713',
        'Enable for PiP (youtube): Enabled \u2713',
    ]);
});

test('other sites: speed, volume and PiP integration default off and are keyed by normalized origin', () => {
    const env = loadUserscript({ hostname: 'www.example.com' });
    env.tick();
    assert.deepEqual(env.menuLabels(), [
        'Playback Speed (example.com): Disabled \u2717',
        'Natural Volume (example.com): Disabled \u2717',
        'Enable for PiP (example.com): Disabled \u2717',
    ]);
});

test('PiP integration defaults register handlers only on known sites without persisting a preference or opening a window', () => {
    for (const site of [
        { hostname: 'app.plex.tv', origin: 'plex', enabled: true },
        { hostname: 'media.example.com', port: '32400', origin: 'plex', enabled: true },
        { hostname: 'www.youtube.com', origin: 'youtube', enabled: true },
        { hostname: 'www.example.com', origin: 'example.com', enabled: false },
    ]) {
        const env = loadUserscript(site);
        env.tick(3);
        assert.ok(env.menuItem(`Enable for PiP (${site.origin}): ${site.enabled ? 'Enabled' : 'Disabled'}`));
        assert.equal(typeof env.mediaSessionHandler(), site.enabled ? 'function' : 'undefined');
        assert.equal(env.store.size, 0);
        assert.equal(env.pipRequestCount(), 0);
        assert.deepEqual(env.alerts, []);
        if (site.enabled) {
            const instructions = env.logs.filter(entry => entry[1]?.startsWith('auto picture-in-picture: Enable for PiP'));
            assert.equal(instructions.length, 1);
            assert.match(instructions[0][1], /Chrome controls automatic entry/);
        }
    }
});

test('enabling PiP shows permission instructions in the toggle alert without a separate help command', () => {
    const env = loadUserscript({ hostname: 'media.example.com', port: '32400' });
    env.tick();
    assert.equal(env.menuItem('Automatic PiP setup'), undefined);
    env.toggleMenuItem('Enable for PiP (plex)');
    assert.equal(env.alerts.length, 0);
    env.toggleMenuItem('Enable for PiP (plex)');
    assert.equal(env.alerts.length, 1);
    assert.match(env.alerts[0], /https:\/\/media\.example\.com:32400/);
    assert.match(env.alerts[0], /This script provides the floating player/);
    assert.match(env.alerts[0], /site controls icon beside the address bar/);
    assert.match(env.alerts[0], /On \(can ask\).*Off, then On/);
    assert.match(env.alerts[0], /On \(allowed\)/);
    assert.match(env.alerts[0], /dropdown instead, choose Allow/);
    assert.match(env.alerts[0], /Other Chrome requirements still apply/);
    assert.match(env.alerts[0], /does not change browser permissions or request camera or microphone access/);
    env.tick(3);
    assert.equal(env.menuItem('Automatic PiP setup'), undefined);
    assert.equal(env.menuLabels().length, 4);
    assert.equal(env.alerts.length, 1);
    assert.deepEqual(Object.fromEntries(env.store), { 'pictureInPicture:plex': true });
    assert.equal(env.pipRequestCount(), 0);
    assert.equal(typeof env.mediaSessionHandler(), 'function');
});

test('enabling PiP after a saved opt-out shows the same instructions without opening a player', () => {
    const env = loadUserscript({
        hostname: 'www.youtube.com',
        withVideo: false,
        stored: { 'pictureInPicture:youtube': false },
    });
    env.tick();
    env.toggleMenuItem('Enable for PiP (youtube)');
    assert.match(env.alerts[0], /Picture-in-Picture is enabled for https:\/\/www\.youtube\.com/);
    assert.deepEqual(Object.fromEntries(env.store), { 'pictureInPicture:youtube': true });
    assert.equal(env.mediaSessionHandler(), undefined);
    assert.equal(env.pipRequestCount(), 0);
});

test('explicitly enabling PiP shows one setup alert while defaults and repeated ticks do not interrupt playback', () => {
    for (const site of [
        { hostname: 'app.plex.tv', origin: 'plex' },
        { hostname: 'www.youtube.com', origin: 'youtube' },
    ]) {
        const env = loadUserscript(site);
        env.tick(3);
        assert.deepEqual(env.alerts, []);
        env.toggleMenuItem(`Enable for PiP (${site.origin})`);
        assert.deepEqual(env.alerts, []);
        env.toggleMenuItem(`Enable for PiP (${site.origin})`);
        assert.equal(env.alerts.length, 1);
        assert.match(env.alerts[0], /Picture-in-Picture is enabled/);
        env.tick(3);
        assert.equal(env.alerts.length, 1);
        assert.equal(env.pipRequestCount(), 0);
        assert.equal(env.video.paused, false);
    }
});

test('generic-site PiP warning and permission instructions share one user-facing message', () => {
    const env = loadUserscript({ hostname: 'example.com' });
    env.tick();
    env.toggleMenuItem('Enable for PiP (example.com)');
    assert.equal(env.alerts.length, 1);
    assert.match(env.alerts[0], /It has not been tested here/);
    assert.match(env.alerts[0], /Picture-in-Picture is enabled for https:\/\/example\.com/);
    assert.match(env.alerts[0], /On \(allowed\)/);
    env.toggleMenuItem('Enable for PiP (example.com)');
    assert.equal(env.alerts.length, 1);
});

test('setup menu is not offered by unsupported browsers, child frames or static-script instances', () => {
    for (const overrides of [
        { documentPip: false },
        { topFrame: false },
        { userscript: false },
    ]) {
        const env = loadUserscript({ hostname: 'app.plex.tv', ...overrides });
        env.tick(3);
        assert.equal(env.menuItem('Automatic PiP setup'), undefined);
        assert.deepEqual(env.alerts, []);
    }
});

test('existing PiP preferences override new defaults under the unchanged storage key', () => {
    for (const site of [
        { hostname: 'app.plex.tv', origin: 'plex' },
        { hostname: 'www.youtube.com', origin: 'youtube' },
        { hostname: 'example.com', origin: 'example.com' },
    ]) {
        for (const value of [false, true]) {
            const key = `pictureInPicture:${site.origin}`;
            const stored = { [key]: value };
            const env = loadUserscript({ hostname: site.hostname, stored });
            env.tick();
            assert.ok(env.menuItem(`Enable for PiP (${site.origin}): ${value ? 'Enabled' : 'Disabled'}`));
            assert.equal(typeof env.mediaSessionHandler(), value ? 'function' : 'undefined');
            assert.deepEqual(Object.fromEntries(env.store), stored);
            env.toggleMenuItem(`Enable for PiP (${site.origin})`);
            assert.equal(env.store.get(key), !value);
            assert.equal(typeof env.mediaSessionHandler(), value ? 'undefined' : 'function');
            const reloaded = loadUserscript({ hostname: site.hostname, stored: Object.fromEntries(env.store) });
            reloaded.tick();
            assert.ok(reloaded.menuItem(`Enable for PiP (${site.origin}): ${!value ? 'Enabled' : 'Disabled'}`));
        }
    }
});

test('default PiP integration waits for a local video and remains unavailable in static-script mode', () => {
    for (const hostname of ['app.plex.tv', 'www.youtube.com']) {
        const env = loadUserscript({ hostname, withVideo: false });
        env.tick();
        assert.equal(env.mediaSessionHandler(), undefined);
        env.body.appendChild(env.video);
        env.tick();
        assert.equal(typeof env.mediaSessionHandler(), 'function');
        env.video.remove();
        env.tick();
        assert.equal(env.mediaSessionHandler(), undefined);
        assert.equal(env.store.size, 0);
    }
    const env = loadUserscript({ hostname: 'app.plex.tv', userscript: false });
    env.video.disablePictureInPicture = true;
    env.tick();
    assert.equal(env.mediaSessionHandler(), undefined);
    assert.equal(env.video.disablePictureInPicture, true);
    assert.equal(env.pipRequestCount(), 0);
    assert.deepEqual(env.menuLabels(), []);
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
        'Enable for PiP (example.com): Disabled \u2717',
    ]);
    const speedCommand = env.menuItem('Playback Speed (example.com)');
    const volumeCommand = env.menuItem('Natural Volume (example.com)');
    assert.equal(env.menuOperations.length, 3);
    env.tick(3);
    assert.equal(env.menuItem('Playback Speed (example.com)'), speedCommand);
    assert.equal(env.menuItem('Natural Volume (example.com)'), volumeCommand);
    assert.equal(env.menuOperations.length, 3);

    env.video.remove();
    env.tick();
    assert.deepEqual(env.menuLabels(), []);
    assert.equal(env.menuOperations.length, 6);
    env.tick(3);
    assert.deepEqual(env.menuLabels(), []);
    assert.equal(env.menuOperations.length, 6);

    env.body.appendChild(env.video);
    env.tick();
    assert.deepEqual(env.menuLabels(), [
        'Playback Speed (example.com): Disabled \u2717',
        'Natural Volume (example.com): Disabled \u2717',
        'Enable for PiP (example.com): Disabled \u2717',
    ]);
    assert.notEqual(env.menuItem('Playback Speed (example.com)'), speedCommand);
    assert.equal(env.menuOperations.length, 9);
});

test('saved feature settings keep the entire site menu available without a video, including disabled values', () => {
    const sites = [
        { hostname: 'www.example.com', origin: 'example.com', count: 3 },
        { hostname: 'video.example.com', port: '8080', origin: 'video.example.com:8080', count: 3 },
        { hostname: 'app.plex.tv', origin: 'plex', count: 4 },
        { hostname: 'www.youtube.com', origin: 'youtube', count: 3 },
    ];
    for (const site of sites) {
        for (const [feature, label] of [['playbackSpeed', 'Playback Speed'], ['naturalVolume', 'Natural Volume'], ['pictureInPicture', 'Enable for PiP']]) {
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
        'Enable for PiP (example.com): Disabled \u2717',
    ]);

    env.toggleMenuItem('Playback Speed (example.com)');
    env.tick();
    assert.equal(env.store.get('playbackSpeed:example.com'), false);
    assert.deepEqual(env.menuLabels(), [
        'Playback Speed (example.com): Disabled \u2717',
        'Natural Volume (example.com): Disabled \u2717',
        'Enable for PiP (example.com): Disabled \u2717',
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
        assert.equal(env.menuLabels().length, 4);
        assert.ok(env.menuItem(`Skip Auto Play Countdown: ${value ? 'Enabled' : 'Disabled'}`));
        env.tick();
        assert.equal(env.menuLabels().length, 4);
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
    assert.equal(env.menuOperations.length, 4);

    const labels = env.menuLabels();
    const commands = labels.map(label => env.menuItem(label));
    env.tick(3);
    assert.deepEqual(env.menuLabels(), labels);
    assert.equal(env.menuOperations.length, 4);
    labels.forEach((label, index) => assert.equal(env.menuItem(label), commands[index]));

    for (const state of ['Disabled', 'Enabled']) {
        env.toggleMenuItem('Playback Speed (plex)');
        const expectedLabels = [
            `Playback Speed (plex): ${state} ${state === 'Enabled' ? '\u2713' : '\u2717'}`,
            'Natural Volume (plex): Enabled \u2713',
            'Enable for PiP (plex): Enabled \u2713',
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
    const prefixes = [
        'Playback Speed (plex)',
        'Natural Volume (plex)',
        'Enable for PiP (plex)',
        'Skip Auto Play Countdown',
    ];
    const enabledLabels = prefixes.map(prefix => `${prefix}: Enabled \u2713`);
    assert.deepEqual(env.menuLabels(), enabledLabels);

    for (const [index, prefix] of prefixes.entries()) {
        const operationsBeforeToggle = env.menuOperations.length;
        env.toggleMenuItem(prefix);
        const toggledLabels = [...enabledLabels];
        toggledLabels[index] = `${prefix}: Disabled \u2717`;
        assert.deepEqual(env.menuLabels(), toggledLabels);
        assert.equal(env.menuOperations.length, operationsBeforeToggle + 1);

        env.toggleMenuItem(prefix);
        assert.deepEqual(env.menuLabels(), enabledLabels);
        assert.equal(env.menuOperations.length, operationsBeforeToggle + 2);
        env.tick(3);
        assert.deepEqual(env.menuLabels(), enabledLabels);
        assert.equal(env.menuOperations.length, operationsBeforeToggle + 2);
    }
});

test('toggling applies immediately instead of asking for a reload', () => {
    const env = loadUserscript({ hostname: 'app.plex.tv' });
    env.tick();
    env.toggleMenuItem('Playback Speed (plex)');
    assert.deepEqual(env.confirms, []);
    assert.deepEqual(env.reloads, []);
});

test('enabling a feature on an untested site shows a warning', () => {
    const env = loadUserscript({ hostname: 'example.com' });
    env.tick();
    env.toggleMenuItem('Playback Speed (example.com)');
    assert.equal(env.alerts.length, 1);
    assert.match(env.alerts[0], /number keys 1-9/);

    env.toggleMenuItem('Natural Volume (example.com)');
    assert.equal(env.alerts.length, 2);
    assert.match(env.alerts[1], /volume slider controls loudness/);
});

test('disabling a feature on an untested site does not warn', () => {
    const env = loadUserscript({ hostname: 'example.com', stored: { 'playbackSpeed:example.com': true } });
    env.tick();
    env.toggleMenuItem('Playback Speed (example.com)');
    assert.deepEqual(env.alerts, []);
});

test('speed and volume toggles on tested sites do not warn', () => {
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

test('a userscript instance claims the frame and registers one keyboard listener', () => {
    const env = loadUserscript({ hostname: 'app.plex.tv' });
    assert.equal(env.slots.playbackSpeedControlUserscript, 'active');
    assert.equal(env.keydownListenerCount(), 1);
});

test('changing one setting updates its existing menu entry without recreating other entries', () => {
    const env = loadUserscript({ hostname: 'app.plex.tv' });
    env.tick();
    const ids = env.menuCommandIds();
    const volumeCommand = env.menuItem('Natural Volume (plex)');
    const before = env.menuOperations.length;
    env.toggleMenuItem('Playback Speed (plex)');
    assert.deepEqual(env.menuCommandIds(), ids);
    assert.equal(env.menuItem('Natural Volume (plex)'), volumeCommand);
    assert.deepEqual(env.menuOperations.slice(before), [{
        type: 'update', id: ids[0], label: 'Playback Speed (plex): Disabled \u2717',
    }]);
});

test('a partial registration failure retains successful entries and retries missing entries', () => {
    const env = loadUserscript({ hostname: 'app.plex.tv' });
    env.failMenuOperation('register', 2);
    assert.doesNotThrow(() => env.tick());
    const firstId = env.menuCommandIds()[0];
    assert.ok(env.logs.some(entry => entry.join(' ').includes('Menu register failed')));
    env.tick();
    assert.equal(env.menuCommandIds()[0], firstId);
    assert.equal(env.menuLabels().length, 4);
    assert.equal(new Set(env.menuLabels()).size, 4);
    const count = env.menuOperations.length;
    env.tick(3);
    assert.equal(env.menuOperations.length, count);
});

test('a failed menu update leaves the old entry intact and retries without duplicating it', () => {
    const env = loadUserscript({ hostname: 'app.plex.tv' });
    env.tick();
    const ids = env.menuCommandIds();
    env.failMenuOperation('register');
    assert.doesNotThrow(() => env.toggleMenuItem('Playback Speed (plex)'));
    assert.equal(env.store.get('playbackSpeed:plex'), false);
    assert.ok(env.menuItem('Playback Speed (plex): Enabled'));
    env.tick();
    assert.ok(env.menuItem('Playback Speed (plex): Disabled'));
    assert.deepEqual(env.menuCommandIds(), ids);
    assert.equal(env.menuLabels().length, 4);
});

test('failed menu removal retains the entry ID until removal succeeds', () => {
    const env = loadUserscript({ hostname: 'example.com' });
    env.tick();
    const ids = env.menuCommandIds();
    env.video.remove();
    env.failMenuOperation('unregister', 2);
    assert.doesNotThrow(() => env.tick());
    assert.deepEqual(env.menuCommandIds(), ids.slice(1));
    env.tick();
    assert.deepEqual(env.menuCommandIds(), []);
    env.body.appendChild(env.video);
    env.tick();
    assert.equal(env.menuLabels().length, 3);
    assert.equal(new Set(env.menuLabels()).size, 3);
});

test('a failed preference write does not change the displayed or applied setting', () => {
    const env = loadUserscript({ hostname: 'app.plex.tv' });
    env.tick();
    const command = env.menuItem('Playback Speed (plex): Enabled');
    env.setStorageWriteError(new Error('Preference write failed'));
    assert.doesNotThrow(() => command.fn());
    assert.equal(env.menuItem('Playback Speed (plex): Enabled'), command);
    assert.equal(env.store.has('playbackSpeed:plex'), false);
    env.keydown('3');
    assert.equal(env.video.playbackRate, 2);
    assert.ok(env.logs.some(entry => entry.join(' ').includes('Preference write failed')));
    env.setStorageWriteError(null);
    command.fn();
    assert.ok(env.menuItem('Playback Speed (plex): Disabled'));
});

test('a menu callback applies the action represented by its label rather than inverting newer state', () => {
    const env = loadUserscript({ hostname: 'app.plex.tv' });
    env.tick();
    const disable = env.menuItem('Playback Speed (plex): Enabled').fn;
    disable();
    disable();
    assert.equal(env.store.get('playbackSpeed:plex'), false);
    assert.ok(env.menuItem('Playback Speed (plex): Disabled'));
    const enable = env.menuItem('Playback Speed (plex): Disabled').fn;
    enable();
    enable();
    assert.equal(env.store.get('playbackSpeed:plex'), true);
    assert.ok(env.menuItem('Playback Speed (plex): Enabled'));
});

test('preferences changed elsewhere take effect on reload, not in the current application state', () => {
    const env = loadUserscript({ hostname: 'app.plex.tv' });
    env.tick();
    const ids = env.menuCommandIds();
    env.setStoredValue('playbackSpeed:plex', false);
    env.setStoredValue('naturalVolume:plex', false);
    env.setStoredValue('pictureInPicture:plex', false);
    env.setStoredValue('plexSkipAutoPlayCountdown', false);
    env.tick(3);
    assert.ok(env.menuItem('Playback Speed (plex): Enabled'));
    assert.ok(env.menuItem('Natural Volume (plex): Enabled'));
    assert.ok(env.menuItem('Enable for PiP (plex): Enabled'));
    assert.ok(env.menuItem('Skip Auto Play Countdown: Enabled'));
    assert.equal(env.keydown('3').defaultPrevented, true);
    assert.equal(env.slots.playbackSpeedControlNaturalVolumeControl, 'userscript');
    assert.equal(typeof env.mediaSessionHandler(), 'function');
    assert.deepEqual(env.menuCommandIds(), ids);
    assert.deepEqual(env.alerts, []);
    const reloaded = loadUserscript({ hostname: 'app.plex.tv', stored: Object.fromEntries(env.store) });
    reloaded.tick();
    assert.ok(reloaded.menuItem('Playback Speed (plex): Disabled'));
    assert.ok(reloaded.menuItem('Natural Volume (plex): Disabled'));
    assert.ok(reloaded.menuItem('Enable for PiP (plex): Disabled'));
    assert.ok(reloaded.menuItem('Skip Auto Play Countdown: Disabled'));
    assert.equal(reloaded.keydown('3').defaultPrevented, false);
    assert.equal(reloaded.mediaSessionHandler(), undefined);
});

test('unrelated hostnames containing youtube.com do not inherit YouTube labels or defaults', () => {
    for (const hostname of ['notyoutube.com', 'youtube.com.example.org']) {
        const env = loadUserscript({ hostname });
        env.tick();
        assert.ok(env.menuItem(`Playback Speed (${hostname}): Disabled`), hostname);
        assert.ok(env.menuItem(`Enable for PiP (${hostname}): Disabled`), hostname);
        assert.equal(env.mediaSessionHandler(), undefined);
        assert.equal(env.store.size, 0);
    }
});

test('YouTube and its actual subdomains keep the existing settings scope', () => {
    for (const hostname of ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com']) {
        const env = loadUserscript({ hostname, stored: { 'playbackSpeed:youtube': false } });
        env.tick();
        assert.ok(env.menuItem('Playback Speed (youtube): Disabled'), hostname);
        assert.ok(env.menuItem('Enable for PiP (youtube): Enabled'), hostname);
        assert.equal(env.store.get('playbackSpeed:youtube'), false);
    }
});

test('explicit changes use local settings even if persistence already contains the requested value', () => {
    const env = loadUserscript({ hostname: 'app.plex.tv', stored: { 'pictureInPicture:plex': false } });
    env.tick();
    const enable = env.menuItem('Enable for PiP (plex): Disabled').fn;
    env.setStoredValue('pictureInPicture:plex', true);
    env.setStorageReadError(new Error('Unexpected read after startup'));
    enable();
    enable();
    assert.equal(env.store.get('pictureInPicture:plex'), true);
    assert.ok(env.menuItem('Enable for PiP (plex): Enabled'));
    assert.equal(env.alerts.length, 1, 'only the first local change enables the feature');
});

test('startup applies saved overrides and legacy fallbacks without persisting defaults', () => {
    for (const [stored, enabled] of [
        [{ youtubeNaturalVolume: false, 'naturalVolume:youtube': true }, true],
        [{ youtubeNaturalVolume: false }, false],
        [{}, true],
    ]) {
        const env = loadUserscript({ hostname: 'www.youtube.com', stored });
        env.tick();
        assert.ok(env.menuItem(`Natural Volume (youtube): ${enabled ? 'Enabled' : 'Disabled'}`));
        assert.deepEqual(Object.fromEntries(env.store), stored);
        assert.deepEqual(env.alerts, []);
    }
});

test('remote changes for other sites do not refresh or alter the current menu', () => {
    const env = loadUserscript({ hostname: 'www.youtube.com' });
    env.tick();
    const labels = env.menuLabels();
    const operations = env.menuOperations.length;
    env.setStoredValue('playbackSpeed:plex', false);
    env.setStoredValue('pictureInPicture:example.com', true);
    env.tick();
    assert.deepEqual(env.menuLabels(), labels);
    assert.equal(env.menuOperations.length, operations);
    assert.deepEqual(env.alerts, []);
});

test('returning to a cached page preserves its applied settings and menu entries', () => {
    const env = loadUserscript({ hostname: 'app.plex.tv' });
    env.tick();
    const ids = env.menuCommandIds();
    env.pageEvent('pagehide', { persisted: true });
    env.setStoredValue('playbackSpeed:plex', false);
    assert.ok(env.menuItem('Playback Speed (plex): Enabled'));
    env.pageEvent('pageshow', { persisted: true });
    assert.ok(env.menuItem('Playback Speed (plex): Enabled'));
    const operations = env.menuOperations.length;
    env.pageEvent('pageshow', { persisted: true });
    assert.deepEqual(env.menuCommandIds(), ids);
    assert.equal(env.menuOperations.length, operations);
});

test('preferences saved elsewhere do not activate an existing video-free frame', () => {
    const env = loadUserscript({ hostname: 'example.com', withVideo: false });
    env.tick();
    assert.deepEqual(env.menuLabels(), []);
    env.setStoredValue('playbackSpeed:example.com', false);
    env.tick();
    assert.deepEqual(env.menuLabels(), []);
    const reloaded = loadUserscript({ hostname: 'example.com', withVideo: false, stored: Object.fromEntries(env.store) });
    reloaded.tick();
    assert.equal(reloaded.menuLabels().length, 3);
    assert.ok(reloaded.menuItem('Playback Speed (example.com): Disabled'));
});

test('the PiP playback loop consumes applied settings without synchronizing persistence', async () => {
    const env = loadUserscript({ hostname: 'app.plex.tv' });
    const controls = env.addPlexControlBar();
    env.tick();
    await env.enterPictureInPicture();
    env.setStoredValue('playbackSpeed:plex', false);
    env.setStoredValue('pictureInPicture:plex', false);
    env.setStorageReadError(new Error('Unexpected read after startup'));
    assert.doesNotThrow(() => env.tickPip());
    assert.equal(controls.children.length, 2);
    assert.equal(env.pipDocument().querySelector('media-playback-rate-menu-button').disabled, false);
    assert.equal(env.pipKeydown('3').defaultPrevented, true);
    assert.notEqual(env.pipWindow(), null);
    assert.equal(typeof env.mediaSessionHandler(), 'function');
    assert.ok(env.menuItem('Enable for PiP (plex): Enabled'));
    assert.equal(env.logs.some(entry => entry.join(' ').includes('Unexpected read after startup')), false);
    assert.deepEqual(env.alerts, []);
});

test('managers without update-by-ID support do not accumulate old menu entries', () => {
    const env = loadUserscript({ hostname: 'app.plex.tv', menuUpdatesById: false });
    env.tick();
    const volumeCommand = env.menuItem('Natural Volume (plex)');
    for (let count = 0; count < 4; count++) {
        env.toggleMenuItem('Playback Speed (plex)');
        assert.equal(env.menuLabels().length, 4);
        assert.equal(env.menuItem('Natural Volume (plex)'), volumeCommand);
        assert.equal(env.menuLabels().filter(label => label.startsWith('Playback Speed (plex)')).length, 1);
    }
});

test('a failed legacy-menu replacement cleanup retries its old ID without creating another entry', () => {
    const env = loadUserscript({ hostname: 'app.plex.tv', menuUpdatesById: false });
    env.tick();
    const originalId = env.menuCommandIds()[0];
    env.failMenuOperation('unregister');
    assert.doesNotThrow(() => env.toggleMenuItem('Playback Speed (plex)'));
    const replacementId = env.menuCommandIds().at(-1);
    assert.notEqual(originalId, replacementId);
    assert.ok(env.menuCommandIds().includes(originalId));
    assert.ok(env.logs.some(entry => entry.join(' ').includes('Menu unregister failed')));
    const registrations = env.menuOperations.filter(operation => operation.type === 'register').length;
    env.tick();
    assert.equal(env.menuCommandIds().includes(originalId), false);
    assert.ok(env.menuCommandIds().includes(replacementId));
    assert.equal(env.menuLabels().length, 4);
    assert.equal(env.menuOperations.filter(operation => operation.type === 'register').length, registrations);
});

test('repeated registration failures are reported once while polling continues to retry', () => {
    const env = loadUserscript({ hostname: 'example.com' });
    for (let attempt = 0; attempt < 3; attempt++) {
        env.failMenuOperation('register');
        assert.doesNotThrow(() => env.tick());
    }
    assert.equal(env.logs.filter(entry => entry.join(' ').includes('Menu register failed')).length, 1);
    env.tick();
    assert.equal(env.menuLabels().length, 3);
    env.failMenuOperation('register');
    env.toggleMenuItem('Playback Speed (example.com)');
    assert.equal(env.logs.filter(entry => entry.join(' ').includes('Menu register failed')).length, 2);
    env.tick();
    assert.ok(env.menuItem('Playback Speed (example.com): Enabled'));
});

test('application settings load and remain usable without a menu API', () => {
    const env = loadUserscript({
        hostname: 'example.com',
        menuApi: false,
        stored: { 'playbackSpeed:example.com': true, 'naturalVolume:example.com': true },
    });
    assert.equal(env.keydown('3').defaultPrevented, true);
    assert.equal(env.video.playbackRate, 2);
    env.tick();
    assert.deepEqual(env.menuLabels(), []);
    assert.equal(env.slots.playbackSpeedControlNaturalVolumeControl, 'userscript');
    env.setStoredValue('playbackSpeed:example.com', false);
    env.setStoredValue('naturalVolume:example.com', false);
    env.setStorageReadError(new Error('Unexpected read after startup'));
    env.tick();
    assert.equal(env.keydown('4').defaultPrevented, true);
    assert.equal(env.video.playbackRate, 3);
    assert.equal(env.slots.playbackSpeedControlNaturalVolumeControl, 'userscript');
    assert.deepEqual(env.menuOperations, []);
});

test('application consumers use applied settings without reading userscript storage', () => {
    const env = loadUserscript({
        hostname: 'app.plex.tv', withVideo: false,
        stored: { 'playbackSpeed:plex': true },
    });
    env.tick();
    env.setStorageReadError(new Error('Storage is temporarily unavailable'));
    assert.doesNotThrow(() => env.keydown('3'));
    assert.equal(env.keydown('3').defaultPrevented, false);
    env.body.appendChild(env.video);
    assert.equal(env.keydown('3').defaultPrevented, true);
    assert.equal(env.video.playbackRate, 2);
});

test('an explicit setting change takes effect even when its menu update fails', async () => {
    const env = loadUserscript({ hostname: 'app.plex.tv' });
    const pageControls = env.addPlexControlBar();
    env.tick();
    await env.enterPictureInPicture();
    env.failMenuOperation('register');
    env.toggleMenuItem('Playback Speed (plex)');
    assert.equal(env.pipDocument().querySelector('media-playback-rate-menu-button').disabled, true);
    assert.equal(pageControls.children.length, 0);
    assert.equal(env.pipKeydown('3').defaultPrevented, false);
    assert.ok(env.menuItem('Playback Speed (plex): Enabled'), 'the failed projection still shows the old label');
    env.tick();
    assert.ok(env.menuItem('Playback Speed (plex): Disabled'));
});

test('menu reconciliation and explicit changes do not reread preferences after startup', () => {
    const env = loadUserscript({
        hostname: 'example.com',
        stored: { 'playbackSpeed:example.com': true },
    });
    env.setStorageReadError(new Error('Storage read failed'));
    env.tick(3);
    assert.ok(env.menuItem('Playback Speed (example.com): Enabled'));
    assert.equal(env.menuLabels().length, 3);
    assert.equal(env.logs.filter(entry => entry.join(' ').includes('Storage read failed')).length, 0);
    assert.equal(env.keydown('3').defaultPrevented, true);
    assert.equal(env.video.playbackRate, 2);
    env.setStoredValue('playbackSpeed:example.com', false);
    env.tick();
    assert.ok(env.menuItem('Playback Speed (example.com): Enabled'));
    env.toggleMenuItem('Playback Speed (example.com)');
    assert.ok(env.menuItem('Playback Speed (example.com): Disabled'));
    assert.equal(env.keydown('4').defaultPrevented, false);
});

test('a video-free frame can use saved preferences without creating menu definitions as storage state', () => {
    const env = loadUserscript({
        hostname: 'app.plex.tv',
        menuApi: false,
        withVideo: false,
        stored: { 'naturalVolume:plex': true },
    });
    env.tick();
    assert.deepEqual(env.menuOperations, []);
    assert.equal(env.slots.playbackSpeedControlNaturalVolumeControl, 'userscript');
    assert.ok(activationMessages(env).includes('script activated (plex): saved settings exist for this site'));
    env.setStoredValue('naturalVolume:plex', undefined);
    env.tick();
    assert.equal(env.slots.playbackSpeedControlNaturalVolumeControl, 'userscript');
    assert.deepEqual(env.menuOperations, []);
});
