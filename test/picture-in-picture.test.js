const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUserscript } = require('./harness');

function loadWithPip(overrides = {}) {
    const { hostname = 'app.plex.tv', origin = 'plex', ...rest } = overrides;
    return loadUserscript({
        hostname,
        stored: { [`pictureInPicture:${origin}`]: true },
        ...rest,
    });
}

function pipLayoutSnapshots(env) {
    const snapshots = [];
    for (let index = 0; index < env.consoleCalls.length; index++) {
        const call = env.consoleCalls[index];
        if (call.method !== 'group' || !call.args[0].startsWith('PlaybackSpeed: %cPiPLayout:')) continue;
        const table = env.consoleCalls[index + 1];
        assert.equal(table.method, 'table');
        assert.equal(Array.isArray(table.args[0]), false);
        assert.deepEqual(table.args[1], ['Value']);
        assert.equal(env.consoleCalls[index + 2].method, 'groupEnd');
        snapshots.push({
            header: call.args[0].slice('PlaybackSpeed: %c'.length),
            values: Object.fromEntries(Object.entries(table.args[0]).map(([field, row]) => [field, row.Value])),
        });
    }
    return snapshots;
}

test('PiP integration defaults off on an unrecognized site', () => {
    const env = loadUserscript({ hostname: 'example.com' });
    env.tick();
    assert.equal(env.mediaSessionHandler(), undefined);
    assert.ok(env.menuItem('Enable for PiP (example.com): Disabled'));
});

test('enabling PiP registers the Media Session entry handler', () => {
    const env = loadWithPip();
    env.tick();
    assert.equal(typeof env.mediaSessionHandler(), 'function');
});

test('site registrations preserve our dispatcher and are restored on disable', () => {
    const env = loadWithPip();
    env.tick();
    const ours = env.mediaSessionHandler();
    const theirs = () => {};
    env.pageSetsMediaSessionHandler(theirs);
    assert.equal(env.mediaSessionHandler(), ours);
    assert.throws(() => env.pageSetsMediaSessionHandler(42), TypeError);
    assert.equal(env.mediaSessionHandler(), ours);
    env.toggleMenuItem('Enable for PiP (plex)');
    assert.equal(env.mediaSessionHandler(), theirs);
});

test('enabled instances reclaim handlers changed through a previously captured browser method', async () => {
    for (const replacement of [null, () => {}]) {
        const env = loadWithPip({ hostname: 'www.youtube.com', origin: 'youtube' });
        env.tick();
        const ours = env.mediaSessionHandler();
        env.pageUsesCapturedMediaSessionHandler(replacement);
        assert.notEqual(env.mediaSessionHandler(), ours);
        env.tick();
        assert.equal(env.mediaSessionHandler(), ours);
        await env.enterPictureInPicture({ enterPictureInPictureReason: 'contentoccluded' });
        assert.equal(env.pipDocument().querySelector('media-controller').media, env.video);
    }
});

test('disabled instances leave subsequent site handlers alone', () => {
    const env = loadWithPip();
    env.tick();
    env.toggleMenuItem('Enable for PiP (plex)');
    assert.equal(env.mediaSessionHandler(), undefined);
    const replacement = () => {};
    env.pageSetsMediaSessionHandler(replacement);
    env.tick(3);
    assert.equal(env.mediaSessionHandler(), replacement);
    env.pageUsesCapturedMediaSessionHandler(null);
    env.tick(3);
    assert.equal(env.mediaSessionHandler(), undefined);
});

test('enabling Plex does not override a saved YouTube opt-out', () => {
    const env = loadUserscript({
        hostname: 'www.youtube.com',
        stored: { 'pictureInPicture:plex': true, 'pictureInPicture:youtube': false },
    });
    env.tick(3);
    assert.equal(env.mediaSessionHandler(), undefined);
    assert.ok(env.menuItem('Enable for PiP (youtube): Disabled'));
});

test('unsupported browsers and child frames do not claim the action', () => {
    for (const overrides of [{ documentPip: false }, { topFrame: false }, { mediaSessionAvailable: false }]) {
        const env = loadWithPip(overrides);
        env.tick();
        assert.equal(env.mediaSessionHandler(), undefined);
        assert.equal(env.pipRequestCount(), 0);
    }
});

test('registration errors remain visible, deduplicated and recoverable', () => {
    const env = loadWithPip({ mediaSessionError: new TypeError('registration denied') });
    env.tick(4);
    assert.equal(env.mediaSessionHandler(), undefined);
    assert.equal(env.logs.filter(entry => entry.join(' ').includes('registration denied')).length, 1);
    env.setMediaSessionError(null);
    env.tick();
    assert.equal(typeof env.mediaSessionHandler(), 'function');
});

test('observer installation failure is surfaced without claiming registration', () => {
    const env = loadWithPip({ blockMediaSessionObserver: true });
    env.tick();
    assert.equal(env.mediaSessionHandler(), undefined);
    assert.ok(env.logs.some(entry => entry.join(' ').includes('cannot coordinate Picture-in-Picture handlers')));
});

test('unblocking browser controls retains unrelated restrictions', () => {
    const env = loadWithPip();
    env.video.disablePictureInPicture = true;
    env.video.setAttribute('controlsList', 'nodownload nopictureinpicture');
    env.tick();
    assert.equal(env.video.disablePictureInPicture, false);
    assert.equal(env.video.getAttribute('controlsList'), 'nodownload');
});

test('the original video moves into library controls without moving the site player', async () => {
    const env = loadWithPip();
    const { player, controls } = env.addPlexPlayer();
    const originalChildren = [...player.children];
    env.tick();
    await env.enterPictureInPicture();
    const controller = env.pipDocument().querySelector('media-controller');
    assert.equal(controller.media, env.video);
    assert.equal(env.document.contains(player), true);
    assert.equal(env.document.contains(controls), true);
    assert.equal(env.document.contains(env.video), false);
    assert.equal(env.video.controls, false);
    assert.deepEqual(controller.querySelector('media-control-bar').children.map(element => element.tagName), [
        'media-play-button', 'media-mute-button', 'media-volume-range', 'media-time-range',
        'media-time-display', 'media-playback-rate-menu-button', 'media-captions-button', 'media-chrome-button',
    ]);
    assert.deepEqual(env.libraryCalls, ['DOMPurify', 'VideoPlayer']);
    env.closePipWindow();
    assert.deepEqual(player.children, originalChildren);
    assert.equal(env.pipPlaceholder(), null);
});

test('native controls stay disabled in PiP and can be enabled again after restoration', async () => {
    const env = loadWithPip();
    env.tick();
    await env.enterPictureInPicture();
    env.video.controls = true;
    env.flushMutations();
    assert.equal(env.video.controls, false);
    env.closePipWindow();
    assert.equal(env.video.controls, false);
    env.video.controls = true;
    env.flushMutations();
    assert.equal(env.video.controls, true);
});

test('library player layout does not import application stylesheets', async () => {
    const env = loadWithPip();
    env.addPlexPlayer();
    Object.defineProperty(env.document, 'styleSheets', {
        get() { throw new Error('Site stylesheets must not be read'); },
    });
    env.tick();
    await env.enterPictureInPicture();
    const sheets = env.pipDocument().head.querySelectorAll('style');
    assert.equal(sheets.length, 1);
    assert.match(sheets[0].textContent, /media-controller/);
    assert.equal(env.pipDocument().querySelector('link'), null);
});

test('library injection and player initialization failures preserve the source page', async () => {
    for (const [overrides, message] of [
        [{ failLibraries: true }, 'could not load'],
        [{ controllerInitializationError: new Error('player initialization failed') }, 'player initialization failed'],
    ]) {
        const env = loadWithPip(overrides);
        env.tick();
        await env.enterPictureInPicture();
        assert.equal(env.pipWindow(), null);
        assert.equal(env.document.contains(env.video), true);
        assert.equal(env.pipPlaceholder(), null);
        assert.ok(env.logs.some(entry => entry.join(' ').includes(message)));
    }
});

test('unsupported managers do not open a bare fallback window', async () => {
    const env = loadWithPip({ libraryApi: false });
    env.tick();
    await env.enterPictureInPicture();
    assert.equal(env.pipRequestCount(), 0);
    assert.ok(env.logs.some(entry => entry.join(' ').includes('GM_addElement')));
});

test('the template sanitizer is installed in the PiP window before library evaluation', async () => {
    const policies = [];
    const pipTrustedTypes = {
        createPolicy(name, policy) {
            policies.push(name);
            this.defaultPolicy = policy;
            return policy;
        },
    };
    const env = loadWithPip({ pipTrustedTypes });
    env.tick();
    await env.enterPictureInPicture();
    assert.equal(env.pipDocument().querySelector('media-controller').media, env.video);
    assert.deepEqual(policies, ['default']);
    assert.equal(env.pageWindow.trustedTypes, undefined);
    let sanitized;
    env.pipWindow().DOMPurify.sanitize = (html, options) => {
        sanitized = { html, options };
        return 'sanitized template';
    };
    assert.equal(pipTrustedTypes.defaultPolicy.createHTML('<slot></slot>'), 'sanitized template');
    assert.equal(sanitized.html, '<slot></slot>');
    assert.equal(sanitized.options.RETURN_TRUSTED_TYPE, false);
    assert.equal(sanitized.options.FORCE_BODY, true);
    assert.deepEqual(Array.from(sanitized.options.ADD_TAGS), ['slot', 'media-tooltip', 'media-gesture-receiver']);
});

test('an existing template policy is not replaced', async () => {
    const existing = { createHTML: html => html };
    const pipTrustedTypes = {
        defaultPolicy: existing,
        createPolicy() { throw new Error('The existing policy must not be replaced'); },
    };
    const env = loadWithPip({ pipTrustedTypes });
    env.tick();
    await env.enterPictureInPicture();
    assert.equal(env.pipDocument().querySelector('media-controller').media, env.video);
    assert.equal(pipTrustedTypes.defaultPolicy, existing);
});

test('policy failures and missing menu components report failure without moving the video', async () => {
    for (const [overrides, message] of [
        [{ pipTrustedTypes: { createPolicy() { throw new Error('Policy creation denied'); } } }, 'Policy creation denied'],
        [{ missingLibraryComponent: 'media-playback-rate-menu' }, 'Player libraries did not initialize'],
        [{ missingLibraryComponent: 'media-playback-rate-menu-button' }, 'Player libraries did not initialize'],
        [{ missingLibraryComponent: 'media-chrome-button' }, 'Player libraries did not initialize'],
    ]) {
        const env = loadWithPip(overrides);
        env.tick();
        await env.enterPictureInPicture();
        assert.equal(env.pipWindow(), null);
        assert.equal(env.document.contains(env.video), true);
        assert.equal(env.pipPlaceholder(), null);
        assert.ok(env.logs.some(entry => entry.join(' ').includes(message)));
    }
});

test('closing the window or disabling PiP during library loading cancels entry without moving the video', async () => {
    for (const closeByUser of [true, false]) {
        const env = loadWithPip({ deferLibraries: true });
        env.tick();
        const opening = env.enterPictureInPicture();
        await Promise.resolve();
        assert.equal(env.document.contains(env.video), true);
        if (closeByUser) env.closePipWindow();
        else env.toggleMenuItem('Enable for PiP (plex)');
        env.finishLoadingLibraries();
        await opening;
        assert.equal(env.document.contains(env.video), true);
        assert.equal(env.pipPlaceholder(), null);
        assert.equal(env.pipWindow(), null);
        assert.equal(env.video.getAttribute('slot'), undefined);
    }
});

test('library timeout reports the failure and leaves the source player intact', async () => {
    const env = loadWithPip({ deferLibraries: true });
    env.tick();
    const opening = env.enterPictureInPicture();
    await Promise.resolve();
    env.tick();
    await opening;
    assert.equal(env.pipWindow(), null);
    assert.equal(env.document.contains(env.video), true);
    assert.ok(env.logs.some(entry => entry.join(' ').includes('10 seconds')));
});

test('library media attributes and original controls state are restored exactly', async () => {
    const env = loadWithPip();
    env.video.setAttribute('slot', 'original-media');
    env.video.setAttribute('tabindex', '4');
    env.video.setAttribute('data-playback-speed-pip-player', 'previous');
    env.video.controls = true;
    env.tick();
    await env.enterPictureInPicture();
    assert.equal(env.video.getAttribute('slot'), 'media');
    env.closePipWindow();
    assert.equal(env.video.getAttribute('slot'), 'original-media');
    assert.equal(env.video.getAttribute('tabindex'), '4');
    assert.equal(env.video.getAttribute('data-playback-speed-pip-player'), 'previous');
    assert.equal(env.video.controls, true);
});

test('library volume writes use the perceptual curve on the page media prototype', async () => {
    for (const separateSandbox of [false, true]) {
        const env = loadWithPip({ separateSandbox });
        env.tick();
        await env.enterPictureInPicture();
        const controller = env.pipDocument().querySelector('media-controller');
        controller.media.volume = 0.5;
        assert.ok(Math.abs(env.nativeVolume() - 0.042169650342858224) < 1e-12);
        assert.ok(Math.abs(controller.media.volume - 0.5) < 1e-12);
        env.toggleMenuItem('Natural Volume (plex)');
        env.tick();
        controller.media.volume = 0.5;
        assert.equal(env.nativeVolume(), 0.5);
    }
});

test('YouTube volume normalization still uses the original player while its video is in PiP', async () => {
    const env = loadWithPip();
    const player = env.wrapInYouTubePlayer(6);
    env.tick();
    env.video.volume = 0.3;
    const before = env.nativeVolume();
    await env.enterPictureInPicture();
    assert.equal(env.document.contains(player), true);
    env.video.volume = 0.3;
    assert.equal(env.nativeVolume(), before);
    env.closePipWindow();
    env.video.volume = 0.3;
    assert.equal(env.nativeVolume(), before);
});

test('closing or disabling returns the video to its original position', async () => {
    for (const closeByUser of [true, false]) {
        const env = loadWithPip();
        env.body.appendChild(env.createElement('div'));
        const originalOrder = [...env.body.children];
        env.tick();
        await env.enterPictureInPicture();
        if (closeByUser) env.closePipWindow();
        else env.toggleMenuItem('Enable for PiP (plex)');
        assert.deepEqual(env.body.children, originalOrder);
        assert.equal(env.pipWindow(), null);
        assert.equal(env.pipPlaceholder(), null);
        assert.equal(env.video.controls, false);
        assert.equal(env.video.getAttribute('data-playback-speed-pip-player'), undefined);
    }
});

test('a window the page opened for itself is left alone', async () => {
    const env = loadWithPip();
    const pipWindow = await env.openPipWindow();
    env.tick(3);
    assert.equal(env.pipWindow(), pipWindow);
    assert.equal(pipWindow.document.querySelector('video'), null);
    assert.equal(env.document.contains(env.video), true);
    assert.equal(env.pipPlaceholder(), null);
    env.toggleMenuItem('Enable for PiP (plex)');
    env.tick();
    assert.equal(env.pipWindow(), pipWindow);
});

test('speed keys apply immediately and update the library rate control without a PiP overlay', async () => {
    const env = loadWithPip();
    env.tick();
    await env.enterPictureInPicture();
    const event = env.pipKeydown('3');
    assert.equal(event.defaultPrevented, true);
    assert.equal(env.pipDocument().querySelector('media-playback-rate-menu-button').mediaPlaybackRate, 2);
    assert.equal(env.pipDocument().querySelector('#playback-speed-prompt'), null);
    assert.equal(env.document.querySelector('#playback-speed-prompt'), null);
    assert.equal(env.video.playbackRate, 2);
    env.video.playbackRate = 1;
    env.tick();
    assert.equal(env.video.playbackRate, 2);
});

test('PiP uses the stock library menu to select faster and slower values on every site', async () => {
    for (const site of [
        { hostname: 'app.plex.tv', origin: 'plex' },
        { hostname: 'www.youtube.com', origin: 'youtube' },
        { hostname: 'example.com', origin: 'example.com' },
    ]) {
        const env = loadWithPip({
            ...site,
            stored: { [`pictureInPicture:${site.origin}`]: true, [`playbackSpeed:${site.origin}`]: true },
        });
        env.tick();
        await env.enterPictureInPicture();
        const bar = env.pipDocument().querySelector('media-control-bar');
        const rate = bar.querySelector('media-playback-rate-menu-button');
        const menu = env.pipDocument().querySelector('media-playback-rate-menu');
        assert.equal(bar.tagName, 'media-control-bar');
        assert.equal(env.pipDocument().querySelectorAll('media-control-bar').length, 1);
        assert.equal(env.pipDocument().querySelectorAll('media-chrome-button').length, 1);
        assert.equal(bar.querySelector('media-chrome-button').getAttribute('aria-label'), 'Resize window to current video');
        assert.equal(bar.getAttribute('slot'), undefined);
        assert.equal(bar.getAttribute('noautohide'), undefined);
        assert.equal(rate.tagName, 'media-playback-rate-menu-button');
        assert.equal(menu.hidden, true);
        assert.equal(menu.getAttribute('anchor'), 'auto');
        rate.click();
        assert.equal(env.video.playbackRate, 1, 'opening a menu must not change speed');
        assert.equal(menu.hidden, false);
        menu.selectRate(2.5);
        assert.equal(env.video.playbackRate, 2.5);
        assert.equal(rate.mediaPlaybackRate, 2.5);
        assert.equal(rate.innerText, '2.5x');
        rate.click();
        menu.selectRate(0.8);
        assert.equal(env.video.playbackRate, 0.8);
        assert.equal(rate.innerText, '0.8x');
        assert.equal(menu.lastRateRequest.defaultPrevented, false);
        assert.equal(menu.lastRateRequest.propagationStopped, false);
        assert.equal(env.pipDocument().querySelector('#playback-speed-prompt'), null);
        assert.equal(env.document.querySelector('#playback-speed-prompt'), null);
        env.closePipWindow();
    }
});

test('the library menu uses our values and its selection is not overwritten by polling', async () => {
    const env = loadWithPip();
    env.tick();
    await env.enterPictureInPicture();
    const rate = env.pipDocument().querySelector('media-playback-rate-menu-button');
    const menu = env.pipDocument().querySelector('media-playback-rate-menu');
    const rates = menu.getAttribute('rates').split(' ').map(Number);
    assert.ok(rates.includes(1.5), 'quick-set values remain available in the library control');
    assert.deepEqual(rates, [...new Set(rates)].sort((a, b) => a - b));
    assert.deepEqual(rates, [0.5, 0.8, 1, 1.2, 1.4, 1.5, 1.6, 1.8, 2, 2.5, 3, 4, 5, 6, 7, 8, 9, 10, 15, 20]);
    rate.click();
    menu.selectRate(1.2);
    assert.equal(env.video.playbackRate, 1.2);
    env.tick(3);
    assert.equal(env.video.playbackRate, 1.2);
    env.video.playbackRate = 1;
    env.tick();
    assert.equal(env.video.playbackRate, 1.2);
    assert.equal(rate.mediaPlaybackRate, 1.2);
    env.closePipWindow();
    env.video.playbackRate = 1;
    env.tick();
    assert.equal(env.video.playbackRate, 1.2);
});

test('the menu remembers the actual resulting media rate instead of the requested value', async () => {
    const env = loadWithPip();
    env.tick();
    await env.enterPictureInPicture();
    let playbackRate = env.video.playbackRate;
    const writes = [];
    Object.defineProperty(env.video, 'playbackRate', {
        configurable: true,
        enumerable: true,
        get() { return playbackRate; },
        set(value) {
            writes.push(value);
            playbackRate = Math.min(Number(value), 1.5);
        },
    });
    const rate = env.pipDocument().querySelector('media-playback-rate-menu-button');
    const menu = env.pipDocument().querySelector('media-playback-rate-menu');
    rate.click();
    menu.selectRate(2);
    assert.equal(menu.lastRateRequest.detail, '2');
    assert.equal(env.video.playbackRate, 1.5);
    assert.deepEqual(writes, [2]);
    env.tick(3);
    assert.equal(env.video.playbackRate, 1.5);
    assert.deepEqual(writes, [2]);
    env.video.playbackRate = 1;
    assert.equal(env.video.playbackRate, 1);
    env.tick();
    assert.equal(env.video.playbackRate, 1.5);
    assert.deepEqual(writes, [2, 1, 1.5]);
    env.closePipWindow();
});

test('the rate menu permits direct selection of either endpoint without cycling', async () => {
    const env = loadWithPip();
    env.tick();
    await env.enterPictureInPicture();
    const rate = env.pipDocument().querySelector('media-playback-rate-menu-button');
    const menu = env.pipDocument().querySelector('media-playback-rate-menu');
    rate.click();
    menu.selectRate(20);
    assert.equal(env.video.playbackRate, 20);
    rate.click();
    assert.equal(env.video.playbackRate, 20);
    menu.selectRate(0.5);
    assert.equal(env.video.playbackRate, 0.5);
    env.tick();
    assert.equal(env.video.playbackRate, 0.5);
});

test('disabling playback speed uses the library disabled state without disabling other controls', async () => {
    const env = loadWithPip();
    env.tick();
    await env.enterPictureInPicture();
    const controller = env.pipDocument().querySelector('media-controller');
    const rate = controller.querySelector('media-playback-rate-menu-button');
    const menu = controller.querySelector('media-playback-rate-menu');
    env.pipKeydown('3');
    rate.click();
    assert.equal(menu.hidden, false);
    env.toggleMenuItem('Playback Speed (plex)');
    assert.equal(rate.disabled, true);
    assert.equal(menu.disabled, true);
    assert.equal(menu.hidden, true);
    for (const tag of ['media-play-button', 'media-volume-range']) {
        const control = controller.querySelector(tag);
        assert.ok(control, tag);
        assert.notEqual(control.disabled, true, tag);
        assert.equal(control.getAttribute('disabled'), undefined, tag);
    }
    const before = env.video.playbackRate;
    rate.click();
    menu.selectRate(1);
    assert.equal(env.video.playbackRate, before);
    assert.equal(env.pipKeydown('5').defaultPrevented, false);
    env.toggleMenuItem('Playback Speed (plex)');
    assert.equal(rate.disabled, false);
    assert.equal(menu.disabled, false);
    rate.click();
    menu.selectRate(2.5);
    assert.equal(env.video.playbackRate, 2.5);
});

test('PiP respects a saved playback-speed opt-out until explicitly enabled', async () => {
    const env = loadWithPip({ stored: { 'pictureInPicture:plex': true, 'playbackSpeed:plex': false } });
    env.tick();
    await env.enterPictureInPicture();
    assert.equal(env.pipDocument().querySelector('media-playback-rate-menu-button').disabled, true);
    assert.equal(env.pipKeydown('3').defaultPrevented, false);
    env.toggleMenuItem('Playback Speed (plex)');
    assert.equal(env.pipDocument().querySelector('media-playback-rate-menu-button').disabled, false);
    env.pipDocument().querySelector('media-playback-rate-menu-button').click();
    env.pipDocument().querySelector('media-playback-rate-menu').selectRate(1.2);
    assert.equal(env.video.playbackRate, 1.2);
});

test('closing the window releases speed listeners and old controls cannot affect a later session', async () => {
    const env = loadWithPip();
    env.tick();
    await env.enterPictureInPicture();
    const first = env.pipDocument().querySelector('media-controller');
    const rate = first.querySelector('media-playback-rate-menu-button');
    const menu = first.querySelector('media-playback-rate-menu');
    assert.equal(first.eventListeners.mediaplaybackraterequest.length, 1);
    env.closePipWindow();
    assert.equal(first.eventListeners.mediaplaybackraterequest.length, 0);
    await env.enterPictureInPicture();
    rate.click();
    menu.selectRate(4);
    assert.equal(env.video.playbackRate, 1);
    env.pipDocument().querySelector('media-playback-rate-menu-button').click();
    env.pipDocument().querySelector('media-playback-rate-menu').selectRate(1.2);
    assert.equal(env.video.playbackRate, 1.2);
    env.closePipWindow();
    env.keydown('3');
    assert.equal(env.document.querySelector('#playback-speed-prompt').innerText, 'Speed: 2x');
});

test('speed controls ignore input after the site reclaims the video', async () => {
    const env = loadWithPip();
    env.tick();
    await env.enterPictureInPicture();
    const controller = env.pipDocument().querySelector('media-controller');
    const rate = controller.querySelector('media-playback-rate-menu-button');
    env.body.appendChild(env.video);
    rate.click();
    controller.querySelector('media-playback-rate-menu').selectRate(3);
    assert.equal(env.video.playbackRate, 1);
    env.tick();
    assert.equal(env.pipWindow(), null);
    assert.equal(controller.eventListeners.mediaplaybackraterequest.length, 0);
});

test('PiP speed controls display the actual media rate when it changes', async () => {
    const env = loadWithPip();
    env.tick();
    await env.enterPictureInPicture();
    const rate = env.pipDocument().querySelector('media-playback-rate-menu-button');
    env.video.playbackRate = 1.5;
    env.video.dispatch('ratechange');
    assert.equal(rate.mediaPlaybackRate, 1.5);
    env.tick();
    assert.equal(rate.mediaPlaybackRate, 1);
});

test('the field and event guide uses rich console formatting once at load, not per window or snapshot', async () => {
    const env = loadWithPip();
    const guides = () => env.consoleCalls.filter(call =>
        call.method === 'groupCollapsed' && call.args[0].includes('PiPLayout log fields'));
    assert.equal(guides().length, 1);
    assert.equal(env.pipRequestCount(), 0);
    const groupStart = env.consoleCalls.indexOf(guides()[0]);
    const groupEnd = env.consoleCalls.findIndex(call => call.method === 'groupEnd');
    const guideCalls = env.consoleCalls.slice(groupStart, groupEnd + 1);
    assert.deepEqual(guideCalls.map(call => call.method),
        ['groupCollapsed', 'log', 'log', 'table', 'log', 'log', 'table', 'log', 'groupEnd']);
    assert.match(guides()[0].args[0], /%cPiPLayout log fields%c/);
    assert.match(guides()[0].args[1], /font-weight: bold/);
    assert.equal(guides()[0].args[2], '');
    assert.equal(guideCalls[1].args[0], '%cMeasurements%c - width x height in browser-reported pixels');
    assert.match(guideCalls[1].args[1], /font-weight: bold/);
    assert.equal(guideCalls[4].args[0], '%cEvent names');
    assert.match(guideCalls[4].args[1], /font-weight: bold/);
    const tables = guideCalls.filter(call => call.method === 'table');
    assert.deepEqual(tables[0].args[1], ['Meaning']);
    assert.deepEqual(tables[1].args[1], ['Meaning']);
    for (const table of tables) assert.equal(Array.isArray(table.args[0]), false);
    const fields = Object.fromEntries(Object.entries(tables[0].args[0]).map(([field, row]) => [field, row.Meaning]));
    const events = Object.fromEntries(Object.entries(tables[1].args[0]).map(([event, row]) => [event, row.Meaning]));
    assert.equal(Object.keys(fields).length, 10);
    assert.equal(Object.keys(events).length, 5);
    assert.match(fields['Requested viewport size'], /target.*excluding title bar and borders; not a measurement/);
    assert.match(fields['Requested outer window size'], /total window size requested by Fit.*title bar and borders/);
    assert.match(fields['Measured viewport size'], /integer.*including any scrollbar space/);
    assert.match(fields['Reported outer window size'], /pending request rather than the final window size/);
    assert.match(fields['Video element bounds'], /includes any black bars, not just the visible picture/);
    assert.match(fields['Device pixel ratio'], /display scaling and page zoom/);
    assert.match(events['setup-timer'], /resize events can precede it/);
    assert.match(events['one-second-timer'], /not a guarantee of stable size/);
    assert.match(events['window-resize'], /does not identify what caused/);
    assert.match(events.loadedmetadata, /no automatic window resize/);
    assert.match(events['fit-video-requested'], /Chrome can round or constrain/);
    for (let opening = 0; opening < 2; opening++) {
        env.tick();
        await env.enterPictureInPicture();
        env.tick();
        env.pipResize(700, 400);
        env.video.dispatch('loadedmetadata');
        env.closePipWindow();
        env.tick(5);
        assert.equal(guides().length, 1);
        assert.equal(env.consoleCalls.filter(call => call.method === 'table').length, 2 + pipLayoutSnapshots(env).length);
        assert.equal(env.consoleCalls.filter(call => call.method === 'groupEnd').length, 1 + pipLayoutSnapshots(env).length);
    }
    const snapshots = pipLayoutSnapshots(env);
    assert.ok(snapshots.length >= 8);
    for (const snapshot of snapshots) {
        const measurements = Object.keys(snapshot.values);
        assert.equal(measurements.length, 10);
        for (const measurement of measurements) assert.ok(fields[measurement]);
        assert.doesNotMatch(JSON.stringify(snapshot), /Snapshot trigger|Measurement format|not a measurement|not a guarantee|not confirmation/);
        assert.doesNotMatch(JSON.stringify(snapshot), /title bar|before display scaling|preserve|aspect ratio|page zoom/);
    }
});

test('sizing diagnosis leaves video styles untouched and logs requested versus actual geometry', async () => {
    const env = loadWithPip();
    const siteStyle = 'padding: 32px; border: 8px solid black; min-width: 1200px; transform: scale(0.9); object-fit: cover;';
    env.video.setAttribute('style', siteStyle);
    env.tick();
    await env.enterPictureInPicture();
    const css = env.pipDocument().head.querySelector('style').textContent;
    assert.match(css, /html, body \{[^}]*overflow: hidden/);
    assert.match(css, /media-controller \{ display: block; width: 100%; height: 100%; \}/);
    assert.match(css, /width: 100% !important; height: 100% !important/);
    assert.doesNotMatch(css, /all:|transform:|object-fit:|resize/);
    env.video.box = { width: 900, height: 500 };
    env.video.computedStyle = { objectFit: 'contain', transform: 'matrix(0.9, 0, 0, 0.9, 0, 0)', paddingLeft: '32px' };
    env.video.src = 'https://private-media.example/title?token=secret';
    env.tick();
    const entries = pipLayoutSnapshots(env);
    assert.equal(entries.length, 2);
    assert.match(entries[0].header, /^PiPLayout: setup-timer \| T\+0ms \|/);
    assert.match(entries[1].header, /^PiPLayout: one-second-timer/);
    assert.equal(entries[0].values['Requested viewport size'], '960 x 540');
    assert.equal(entries[0].values['Requested outer window size'], '-');
    assert.equal(entries[0].values['Measured viewport size'], '960 x 540');
    assert.equal(entries[0].values['Reported outer window size'], '968 x 582');
    assert.equal(entries[0].values['Source video size'], '1920 x 1080');
    assert.equal(entries[0].values['Video element bounds'], '900 x 500; left 0, top 0');
    assert.equal(entries[0].values['Video object-fit'], 'contain');
    assert.equal(entries[0].values['Device pixel ratio'], '1');
    assert.equal(Object.keys(entries[0].values).length, 10);
    assert.doesNotMatch(JSON.stringify(entries), /PiPLayout: (initialized|settled)/);
    assert.equal(JSON.stringify(entries).includes('secret'), false);
    assert.equal(JSON.stringify(entries).includes('private-media'), false);
    assert.equal(env.video.getAttribute('style'), siteStyle);
    env.closePipWindow();
    assert.equal(env.video.getAttribute('style'), siteStyle);
    assert.equal(env.video.getAttribute('data-playback-speed-pip-player'), undefined);
});

test('readable geometry reports separate scrollbar space from document overflow', async () => {
    const env = loadWithPip();
    env.tick();
    await env.enterPictureInPicture();
    env.tick();
    assert.equal(pipLayoutSnapshots(env).at(-1).values['Scrollbar space'], 'vertical width 0 px; horizontal height 0 px');
    assert.equal(pipLayoutSnapshots(env).at(-1).values['Page overflow'], 'width 0 px; height 0 px');
    const root = env.pipDocument().documentElement;
    Object.assign(root, { clientWidth: 943, clientHeight: 525, scrollWidth: 960, scrollHeight: 551 });
    env.video.dispatch('loadedmetadata');
    let entry = pipLayoutSnapshots(env).at(-1);
    assert.equal(entry.values['Measured viewport size'], '960 x 540');
    assert.equal(entry.values['Scrollbar space'], 'vertical width 17 px; horizontal height 15 px');
    assert.equal(entry.values['Page overflow'], 'width 17 px; height 26 px');
    const body = env.pipDocument().body;
    env.pipDocument().scrollingElement = body;
    Object.assign(body, { clientWidth: 943, clientHeight: 525, scrollWidth: 943, scrollHeight: 532 });
    env.video.dispatch('loadedmetadata');
    entry = pipLayoutSnapshots(env).at(-1);
    assert.equal(entry.values['Page overflow'], 'width 0 px; height 7 px');
    assert.doesNotMatch(JSON.stringify(entry), /undefined|NaN|private-media/);
});

test('layout tables use setup-timer as the elapsed-time origin and preserve earlier measurements', async () => {
    const env = loadWithPip();
    env.tick();
    await env.enterPictureInPicture();
    const window = env.pipWindow();
    const times = [100, 107, 1107];
    window.performance.now = () => times.shift();
    const resizeCalls = [];
    window.resizeBy = (...args) => resizeCalls.push(args);
    window.resizeTo = (...args) => resizeCalls.push(args);
    env.pipResize(833, 468);
    assert.equal(pipLayoutSnapshots(env).length, 0);
    env.video.videoWidth = 1280;
    env.video.videoHeight = 720;
    env.tick();
    const snapshots = pipLayoutSnapshots(env);
    assert.equal(snapshots.length, 3);
    assert.match(snapshots[0].header, /^PiPLayout: window-resize \| T-7ms \|/);
    assert.equal(snapshots[0].values['Source video size'], '1920 x 1080');
    assert.match(snapshots[1].header, /^PiPLayout: setup-timer \| T\+0ms \|/);
    assert.equal(snapshots[1].values['Source video size'], '1280 x 720');
    assert.match(snapshots[2].header, /^PiPLayout: one-second-timer \| T\+1000ms \|/);
    for (const snapshot of snapshots) {
        assert.match(snapshot.header, /\| \d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
    }
    window.performance.now = () => 1142;
    env.pipResize(700, 400);
    assert.match(pipLayoutSnapshots(env).at(-1).header, /window-resize \| T\+1035ms \|/);
    assert.deepEqual(resizeCalls, []);
    env.closePipWindow();
    await env.enterPictureInPicture();
    env.pipWindow().performance.now = () => 9000;
    env.tick();
    const setups = pipLayoutSnapshots(env).filter(entry => entry.header.startsWith('PiPLayout: setup-timer'));
    assert.equal(setups.length, 2);
    assert.match(setups[1].header, /T\+0ms/);
});

test('closing before the setup timer preserves captured data without inventing an elapsed origin', async () => {
    const env = loadWithPip();
    env.tick();
    await env.enterPictureInPicture();
    env.pipWindow().performance.now = () => 123;
    env.pipResize(849, 469);
    assert.equal(pipLayoutSnapshots(env).length, 0);
    env.closePipWindow();
    const snapshots = pipLayoutSnapshots(env);
    assert.equal(snapshots.length, 1);
    assert.match(snapshots[0].header, /window-resize \| T unavailable \(no setup-timer\) \|/);
    assert.equal(snapshots[0].values['Measured viewport size'], '849 x 469');
    env.tick(3);
    assert.equal(pipLayoutSnapshots(env).length, 1);
});

test('geometry snapshots report viewport and metadata changes without resizing or polling spam', async () => {
    const env = loadWithPip();
    env.tick();
    await env.enterPictureInPicture();
    env.tick();
    const window = env.pipWindow();
    const resizeRequests = [];
    window.resizeTo = (...args) => resizeRequests.push(args);
    window.resizeBy = (...args) => resizeRequests.push(args);
    const before = env.consoleCalls.length;
    env.tick(20);
    assert.equal(env.consoleCalls.length, before);
    env.pipResize(700, 300);
    let entry = pipLayoutSnapshots(env).at(-1);
    assert.match(entry.header, /^PiPLayout: window-resize/);
    assert.equal(entry.values['Requested viewport size'], '960 x 540');
    assert.equal(entry.values['Measured viewport size'], '700 x 300');
    env.video.videoWidth = 1280;
    env.video.videoHeight = 720;
    env.video.dispatch('loadedmetadata');
    entry = pipLayoutSnapshots(env).at(-1);
    assert.match(entry.header, /^PiPLayout: loadedmetadata/);
    assert.equal(entry.values['Source video size'], '1280 x 720');
    assert.deepEqual(resizeRequests, []);
    assert.equal(env.pipRequestCount(), 1);
    env.closePipWindow();
    const afterClose = env.consoleCalls.length;
    env.video.dispatch('loadedmetadata');
    env.tick();
    assert.equal(env.consoleCalls.length, afterClose);
});

test('repeated ticks do not duplicate controls or introduce diagnostic trace output', async () => {
    const env = loadWithPip();
    env.tick();
    await env.enterPictureInPicture();
    env.tick();
    const movedContent = [...env.pipDocument().body.children];
    const logCount = env.consoleCalls.length;
    env.tick(100);
    assert.deepEqual(env.pipDocument().body.children, movedContent);
    assert.equal(env.document.querySelectorAll('[data-playback-speed-pip-slot]').length, 1);
    assert.equal(env.pipKeydownListenerCount(), 1);
    assert.equal(env.pipDocument().head.querySelectorAll('style').length, 1);
    assert.equal(env.consoleCalls.length, logCount);
    assert.equal(env.logs.some(entry => entry.join(' ').includes('PiPTrace')), false);
});

test('initial size uses intrinsic video dimensions and stays within half the available screen width and height', async () => {
    for (const [videoWidth, videoHeight, availWidth, availHeight, expectedWidth, expectedHeight] of [
        [1920, 1080, 1920, 1080, 960, 540],
        [640, 360, 1920, 1080, 640, 360],
        [960, 540, 1920, 1080, 960, 540],
        [3840, 2160, 1920, 1040, 924, 520],
        [1080, 1920, 1920, 1080, 303, 540],
        [2560, 1080, 1920, 1080, 960, 405],
        [1920, 1080, 1080, 1920, 540, 303],
        [1920, 1080, 1365, 767, 681, 383],
    ]) {
        const env = loadWithPip({ screen: { availWidth, availHeight } });
        env.video.videoWidth = videoWidth;
        env.video.videoHeight = videoHeight;
        const { player } = env.addPlexPlayer();
        player.box = { width: 2000, height: 1600 };
        env.video.box = { width: 800, height: 800 };
        env.tick();
        await env.enterPictureInPicture();
        const options = env.pipWindow().requestedOptions;
        assert.deepEqual(options, {
            width: expectedWidth, height: expectedHeight, preferInitialWindowPlacement: true,
        });
        assert.ok(options.width <= videoWidth && options.height <= videoHeight);
        assert.ok(options.width <= availWidth / 2 && options.height <= availHeight / 2);
        assert.ok(Math.abs(options.width * videoHeight - options.height * videoWidth) < Math.max(videoWidth, videoHeight));
        env.closePipWindow();
    }
});

test('a new video or resolution does not resize an existing PiP window', async () => {
    const env = loadWithPip();
    env.tick();
    await env.enterPictureInPicture();
    const window = env.pipWindow();
    const initial = { ...window.requestedOptions };
    const requests = env.pipRequestCount();
    const resizeCalls = [];
    window.resizeTo = (...args) => resizeCalls.push(args);
    window.resizeBy = (...args) => resizeCalls.push(args);
    window.innerWidth = 400;
    window.innerHeight = 300;
    env.video.videoWidth = 720;
    env.video.videoHeight = 1280;
    env.video.src = 'blob:next-video';
    env.pipDocument().dispatch('loadedmetadata', { type: 'loadedmetadata', target: env.video });
    env.tick(5);
    await env.enterPictureInPicture();
    assert.equal(env.pipWindow(), window);
    assert.deepEqual(window.requestedOptions, initial);
    assert.equal(env.pipRequestCount(), requests);
    assert.deepEqual(resizeCalls, []);
    assert.equal(window.innerWidth, 400);
    assert.equal(window.innerHeight, 300);
    env.closePipWindow();
    await env.enterPictureInPicture();
    assert.deepEqual(env.pipWindow().requestedOptions, {
        width: 303, height: 540, preferInitialWindowPlacement: true,
    });
});

test('Fit video reapplies intrinsic sizing to the current video and screen only on user action', async () => {
    for (const [videoWidth, videoHeight, availWidth, availHeight, width, height] of [
        [1920, 1080, 1664, 936, 832, 468],
        [640, 360, 1920, 1080, 640, 360],
        [1080, 1920, 1920, 1080, 303, 540],
        [3840, 2160, 1920, 1040, 924, 520],
        [1920, 1080, 1365, 767, 681, 383],
    ]) {
        const env = loadWithPip();
        env.tick();
        await env.enterPictureInPicture();
        const window = env.pipWindow();
        const initialOptions = { ...window.requestedOptions };
        const resizeCalls = [];
        window.resizeTo = (outerWidth, outerHeight) => {
            resizeCalls.push([outerWidth, outerHeight]);
            window.outerWidth = outerWidth;
            window.outerHeight = outerHeight;
            env.pipResize(outerWidth - 8, outerHeight - 42);
        };
        env.pipResize(500, 300);
        window.outerWidth = 508;
        window.outerHeight = 342;
        env.video.videoWidth = videoWidth;
        env.video.videoHeight = videoHeight;
        env.video.src = 'blob:next-queued-video';
        Object.assign(window.screen, { availWidth, availHeight });
        env.video.dispatch('loadedmetadata');
        env.tick(3);
        assert.deepEqual(resizeCalls, []);
        const beforeClick = pipLayoutSnapshots(env).length;
        env.pipDocument().querySelector('media-chrome-button').click();
        assert.deepEqual(resizeCalls, [[width + 8, height + 42]]);
        assert.equal(window.innerWidth, width);
        assert.equal(window.innerHeight, height);
        const resizeLog = pipLayoutSnapshots(env).slice(beforeClick).find(entry => entry.header.startsWith('PiPLayout: window-resize'));
        assert.equal(resizeLog.values['Requested viewport size'], `${width} x ${height}`);
        assert.equal(resizeLog.values['Requested outer window size'], `${width + 8} x ${height + 42}`);
        assert.ok(width <= videoWidth && height <= videoHeight);
        assert.ok(width <= availWidth / 2 && height <= availHeight / 2);
        assert.deepEqual(window.requestedOptions, initialOptions);
        assert.equal(env.pipRequestCount(), 1);
        assert.equal(env.video.src, 'blob:next-queued-video');
        assert.equal(env.video.paused, false);
        env.tick(3);
        assert.equal(resizeCalls.length, 1);
        env.closePipWindow();
    }
});

test('the first Fit uses absolute outer bounds without a hardcoded frame or scrollbar size', async () => {
    const env = loadWithPip({ screen: { availWidth: 1664, availHeight: 936 } });
    env.tick();
    await env.enterPictureInPicture();
    env.tick();
    const window = env.pipWindow();
    env.pipResize(849, 469);
    window.outerWidth = 864;
    window.outerHeight = 510;
    const resizeCalls = [];
    const relativeCalls = [];
    window.resizeTo = (...args) => resizeCalls.push(args);
    window.resizeBy = (...args) => relativeCalls.push(args);
    env.pipDocument().querySelector('media-chrome-button').click();
    assert.deepEqual(resizeCalls, [[847, 509]]);
    assert.deepEqual(relativeCalls, []);
    assert.equal(pipLayoutSnapshots(env).at(-1).values['Requested viewport size'], '832 x 468');
    assert.equal(pipLayoutSnapshots(env).at(-1).values['Requested outer window size'], '847 x 509');
    assert.match(pipLayoutSnapshots(env).at(-1).header, /^PiPLayout: fit-video-requested/);
});

test('rounded size measurements and manual resizing do not change repeated absolute Fit targets', async () => {
    const env = loadWithPip({ screen: { availWidth: 1664, availHeight: 936 } });
    env.tick();
    await env.enterPictureInPicture();
    env.tick();
    const window = env.pipWindow();
    window.devicePixelRatio = 1.5;
    const resizeCalls = [];
    window.resizeTo = (...args) => resizeCalls.push(args);
    const button = env.pipDocument().querySelector('media-chrome-button');
    for (const [innerWidth, innerHeight, outerWidth, outerHeight] of [
        [847, 469, 862, 510],
        [833, 468, 848, 510],
        [833, 469, 848, 510],
        [833, 468, 848, 510],
        [833, 469, 848, 510],
        [1200, 800, 1215, 841],
    ]) {
        window.outerWidth = outerWidth;
        window.outerHeight = outerHeight;
        env.pipResize(innerWidth, innerHeight);
        button.click();
        assert.deepEqual(resizeCalls.at(-1), [847, 509]);
        assert.equal(pipLayoutSnapshots(env).at(-1).values['Requested viewport size'], '832 x 468');
        assert.equal(pipLayoutSnapshots(env).at(-1).values['Requested outer window size'], '847 x 509');
    }
    assert.equal(resizeCalls.length, 6);
});

test('a pending absolute request is not recalculated using its old viewport', async () => {
    const env = loadWithPip({ screen: { availWidth: 1664, availHeight: 936 } });
    env.tick();
    await env.enterPictureInPicture();
    const window = env.pipWindow();
    env.pipResize(847, 469);
    window.outerWidth = 862;
    window.outerHeight = 510;
    const resizeCalls = [];
    window.resizeTo = (width, height) => {
        resizeCalls.push([width, height]);
        window.outerWidth = width;
        window.outerHeight = height;
    };
    const button = env.pipDocument().querySelector('media-chrome-button');
    button.click();
    button.click();
    assert.deepEqual(resizeCalls, [[847, 509]]);
    window.outerWidth = 848;
    window.outerHeight = 510;
    env.pipResize(833, 468);
    button.click();
    assert.deepEqual(resizeCalls, [[847, 509], [847, 509]]);
});

test('queued videos reuse the frame allowance and display changes refresh it only on Fit', async () => {
    const env = loadWithPip({ screen: { availWidth: 1664, availHeight: 936 } });
    env.tick();
    await env.enterPictureInPicture();
    const window = env.pipWindow();
    window.devicePixelRatio = 1.5;
    env.pipResize(847, 469);
    window.outerWidth = 862;
    window.outerHeight = 510;
    const resizeCalls = [];
    window.resizeTo = (...args) => resizeCalls.push(args);
    const button = env.pipDocument().querySelector('media-chrome-button');
    button.click();
    assert.deepEqual(resizeCalls, [[847, 509]]);
    window.outerWidth = 848;
    env.pipResize(833, 468);
    env.video.videoWidth = 720;
    env.video.videoHeight = 1280;
    env.video.dispatch('loadedmetadata');
    env.tick(3);
    assert.equal(resizeCalls.length, 1);
    button.click();
    assert.deepEqual(resizeCalls.at(-1), [278, 509]);
    Object.assign(window.screen, { availWidth: 1920, availHeight: 1080 });
    window.outerWidth = 616;
    window.outerHeight = 444;
    env.pipResize(600, 400);
    env.tick(3);
    assert.equal(resizeCalls.length, 2);
    button.click();
    assert.deepEqual(resizeCalls.at(-1), [319, 584]);
    window.devicePixelRatio = 2;
    window.outerWidth = 618;
    window.outerHeight = 448;
    button.click();
    assert.deepEqual(resizeCalls.at(-1), [321, 588]);
    window.outerWidth = 720;
    window.outerHeight = 510;
    env.pipResize(700, 460);
    button.click();
    assert.deepEqual(resizeCalls.at(-1), [321, 588]);
});

test('frame allowances are not carried into a newly opened window', async () => {
    const env = loadWithPip({ screen: { availWidth: 1664, availHeight: 936 } });
    env.tick();
    await env.enterPictureInPicture();
    const first = env.pipWindow();
    env.pipResize(847, 469);
    first.outerWidth = 862;
    first.outerHeight = 510;
    const resizeCalls = [];
    first.resizeTo = (...args) => resizeCalls.push(args);
    env.pipDocument().querySelector('media-chrome-button').click();
    env.closePipWindow();
    await env.enterPictureInPicture();
    env.pipWindow().resizeTo = (...args) => resizeCalls.push(args);
    env.video.videoWidth = 640;
    env.video.videoHeight = 360;
    env.pipDocument().querySelector('media-chrome-button').click();
    assert.deepEqual(resizeCalls, [[847, 509], [648, 402]]);
});

test('Fit video uses the generic library button action hook for mouse and keyboard independently of speed settings', async () => {
    const env = loadWithPip({ stored: { 'pictureInPicture:plex': true, 'playbackSpeed:plex': false } });
    env.tick();
    await env.enterPictureInPicture();
    const window = env.pipWindow();
    env.pipResize(800, 450);
    window.outerWidth = 808;
    window.outerHeight = 492;
    const resizeCalls = [];
    window.resizeTo = (...args) => resizeCalls.push(args);
    const button = env.pipDocument().querySelector('media-chrome-button');
    assert.equal(button.disabled, false);
    assert.equal(button.textContent, 'Fit video');
    assert.equal(button.getAttribute('aria-label'), 'Resize window to current video');
    assert.equal(button.querySelector('[slot="tooltip-content"]').textContent, 'Resize window to current video');
    assert.equal(button.style, '');
    button.click();
    assert.deepEqual(resizeCalls, [[968, 582]], 'the resize runs synchronously in the user action');
    for (const key of ['Enter', ' ']) {
        button.dispatch('keydown', { key });
        button.dispatch('keyup', { key });
    }
    assert.equal(resizeCalls.length, 3);
    button.dispatch('keydown', { key: 'x' });
    button.dispatch('keyup', { key: 'x' });
    env.tick(3);
    assert.equal(resizeCalls.length, 3);
    assert.equal(env.video.playbackRate, 1);
});

test('Fit video does not request a resize when the current content size already matches', async () => {
    const env = loadWithPip();
    env.tick();
    await env.enterPictureInPicture();
    const resizeCalls = [];
    env.pipWindow().resizeTo = (...args) => resizeCalls.push(args);
    env.pipDocument().querySelector('media-chrome-button').click();
    assert.deepEqual(resizeCalls, []);
});

test('Fit video reports missing dimensions without changing the last target or interrupting playback', async () => {
    for (const [videoWidth, videoHeight, availWidth, availHeight, error] of [
        [0, 1080, 1920, 1080, 'wait for video metadata'],
        [1920, 0, 1920, 1080, 'wait for video metadata'],
        [1920, 1080, 0, 1080, 'available screen dimensions'],
        [1920, 1080, 1920, 0, 'available screen dimensions'],
    ]) {
        const env = loadWithPip();
        env.tick();
        await env.enterPictureInPicture();
        env.tick();
        const window = env.pipWindow();
        const resizeCalls = [];
        window.resizeTo = (...args) => resizeCalls.push(args);
        env.video.videoWidth = videoWidth;
        env.video.videoHeight = videoHeight;
        Object.assign(window.screen, { availWidth, availHeight });
        env.pipDocument().querySelector('media-chrome-button').click();
        assert.deepEqual(resizeCalls, []);
        assert.ok(env.logs.some(entry => entry.join(' ').includes(error)));
        assert.equal(env.pipWindow(), window);
        assert.equal(env.video.paused, false);
        env.video.dispatch('loadedmetadata');
        assert.equal(pipLayoutSnapshots(env).at(-1).values['Requested viewport size'], '960 x 540');
        assert.equal(pipLayoutSnapshots(env).at(-1).values['Requested outer window size'], '-');
        env.closePipWindow();
    }
});

test('Fit video surfaces browser denial and requires another explicit action to retry', async () => {
    const env = loadWithPip();
    env.tick();
    await env.enterPictureInPicture();
    env.tick();
    const window = env.pipWindow();
    env.video.videoWidth = 640;
    env.video.videoHeight = 360;
    let attempts = 0;
    window.resizeTo = () => {
        attempts++;
        throw new DOMException('Resize requires a user gesture', 'NotAllowedError');
    };
    const button = env.pipDocument().querySelector('media-chrome-button');
    button.click();
    assert.equal(attempts, 1);
    assert.ok(env.logs.some(entry => entry.join(' ').includes('could not resize the Picture-in-Picture window to fit the video: NotAllowedError')));
    assert.equal(env.pipWindow(), window);
    env.video.dispatch('loadedmetadata');
    assert.equal(pipLayoutSnapshots(env).at(-1).values['Requested viewport size'], '960 x 540');
    assert.equal(pipLayoutSnapshots(env).at(-1).values['Requested outer window size'], '-');
    env.tick(3);
    assert.equal(attempts, 1);
    const resizeCalls = [];
    window.outerWidth = 970;
    window.outerHeight = 584;
    window.resizeTo = (...args) => resizeCalls.push(args);
    button.click();
    assert.deepEqual(resizeCalls, [[650, 404]]);
    assert.equal(pipLayoutSnapshots(env).at(-1).values['Requested viewport size'], '640 x 360');
    assert.equal(pipLayoutSnapshots(env).at(-1).values['Requested outer window size'], '650 x 404');
});

test('a failed Fit recalibration restores the previous target and frame allowance', async () => {
    const env = loadWithPip({ screen: { availWidth: 1664, availHeight: 936 } });
    env.tick();
    await env.enterPictureInPicture();
    env.tick();
    const window = env.pipWindow();
    const button = env.pipDocument().querySelector('media-chrome-button');
    const resizeCalls = [];

    window.outerWidth = 862;
    window.outerHeight = 510;
    env.pipResize(847, 469);
    window.resizeTo = (...args) => resizeCalls.push(args);
    button.click();
    assert.deepEqual(resizeCalls, [[847, 509]]);

    window.devicePixelRatio = 2;
    window.outerWidth = 900;
    window.outerHeight = 550;
    env.pipResize(880, 500);
    env.video.videoWidth = 640;
    env.video.videoHeight = 360;
    window.resizeTo = (...args) => {
        resizeCalls.push(args);
        throw new DOMException('Resize requires a user gesture', 'NotAllowedError');
    };
    button.click();
    assert.deepEqual(resizeCalls, [[847, 509], [660, 410]]);

    env.video.dispatch('loadedmetadata');
    const snapshot = pipLayoutSnapshots(env).at(-1);
    assert.equal(snapshot.values['Requested viewport size'], '832 x 468');
    assert.equal(snapshot.values['Requested outer window size'], '847 x 509');
    env.tick(3);
    assert.equal(resizeCalls.length, 2);

    // Returning to the previous configuration must recover its old allowance,
    // not capture the different readbacks left by the failed attempt.
    window.devicePixelRatio = 1;
    window.resizeTo = (...args) => resizeCalls.push(args);
    button.click();
    assert.deepEqual(resizeCalls, [[847, 509], [660, 410], [655, 401]]);
    assert.equal(pipLayoutSnapshots(env).at(-1).values['Requested viewport size'], '640 x 360');
    assert.equal(pipLayoutSnapshots(env).at(-1).values['Requested outer window size'], '655 x 401');
    env.closePipWindow();
});

test('stale Fit controls cannot resize windows after the video is reclaimed or the session ends', async () => {
    const env = loadWithPip();
    env.tick();
    await env.enterPictureInPicture();
    const window = env.pipWindow();
    const button = env.pipDocument().querySelector('media-chrome-button');
    const resizeCalls = [];
    window.resizeTo = (...args) => resizeCalls.push(args);
    env.video.videoWidth = 640;
    env.video.videoHeight = 360;
    env.body.appendChild(env.video);
    button.click();
    assert.deepEqual(resizeCalls, []);
    env.tick();
    assert.equal(env.pipWindow(), null);
    button.click();
    await env.enterPictureInPicture();
    env.pipWindow().resizeTo = (...args) => resizeCalls.push(args);
    env.video.videoWidth = 320;
    env.video.videoHeight = 180;
    button.click();
    assert.deepEqual(resizeCalls, []);
    env.pipDocument().querySelector('media-chrome-button').click();
    assert.deepEqual(resizeCalls, [[328, 222]]);
});

test('missing intrinsic dimensions do not create an incorrectly sized window', async () => {
    for (const [width, height] of [[0, 0], [0, 1080], [1920, 0]]) {
        const env = loadWithPip();
        env.video.videoWidth = width;
        env.video.videoHeight = height;
        env.tick();
        await env.enterPictureInPicture();
        assert.equal(env.pipRequestCount(), 0);
        assert.equal(env.document.contains(env.video), true);
        assert.ok(env.logs.some(entry => entry.join(' ').includes('wait for video metadata')));
        env.video.videoWidth = 1920;
        env.video.videoHeight = 1080;
        await env.enterPictureInPicture();
        assert.ok(env.pipDocument().contains(env.video));
    }
});

test('unavailable screen dimensions surface an error instead of violating the cap', async () => {
    const env = loadWithPip({ screen: { availWidth: 0, availHeight: 1080 } });
    env.tick();
    await env.enterPictureInPicture();
    assert.equal(env.pipRequestCount(), 0);
    assert.equal(env.document.contains(env.video), true);
    assert.ok(env.logs.some(entry => entry.join(' ').includes('available screen dimensions')));
});

test('manual and automatic browser entry share the player integration', async () => {
    for (const reason of ['useraction', 'contentoccluded']) {
        const env = loadWithPip();
        env.tick();
        const labels = env.menuLabels();
        await env.enterPictureInPicture({ enterPictureInPictureReason: reason });
        assert.equal(env.pipDocument().querySelector('media-controller').media, env.video);
        assert.deepEqual(env.menuLabels(), labels);
        assert.ok(env.logs.some(entry => entry.join(' ').includes(`reason: ${reason}`)));
    }
});

test('HTTP remains registered for manual entry with a clear automatic-entry limitation', () => {
    const env = loadWithPip({ protocol: 'http:' });
    env.tick();
    assert.equal(typeof env.mediaSessionHandler(), 'function');
    assert.ok(env.logs.some(entry => entry.join(' ').includes('manual entry only')));
});

test('concurrent entry requests share a single opening operation', async () => {
    const env = loadWithPip({ deferPipRequest: true });
    env.tick();
    const first = env.enterPictureInPicture();
    const second = env.enterPictureInPicture();
    assert.equal(first, second);
    assert.equal(env.pipRequestCount(), 1);
    assert.equal(env.document.contains(env.video), true);
    env.resolvePipRequest();
    await first;
    assert.ok(env.pipDocument().contains(env.video));
});

test('closing or disabling a pending window does not strand the video', async () => {
    for (const closeByUser of [true, false]) {
        const env = loadWithPip({ deferPipRequest: true });
        env.tick();
        const opening = env.enterPictureInPicture();
        if (closeByUser) env.closePipWindow();
        else env.toggleMenuItem('Enable for PiP (plex)');
        env.resolvePipRequest();
        await opening;
        assert.equal(env.document.contains(env.video), true);
        assert.equal(env.pipWindow(), null);
        assert.equal(env.pipPlaceholder(), null);
    }
});

test('a rejected request leaves the page intact and surfaces the error', async () => {
    const env = loadWithPip({ pipRequestError: new Error('activation denied') });
    env.tick();
    await env.enterPictureInPicture();
    assert.equal(env.document.contains(env.video), true);
    assert.equal(env.pipPlaceholder(), null);
    assert.ok(env.logs.some(entry => entry.join(' ').includes('activation denied')));
});

test('restoration survives removal of the placeholder', async () => {
    const env = loadWithPip();
    const after = env.createElement('div');
    env.body.appendChild(after);
    env.tick();
    await env.enterPictureInPicture();
    env.pipPlaceholder().remove();
    env.closePipWindow();
    assert.deepEqual(env.body.children, [env.video, after]);
    assert.equal(env.video.controls, false);
});

test('page replacement stops the stale player instead of inserting it into the new page', async () => {
    const env = loadWithPip();
    const container = env.createElement('section');
    env.body.appendChild(container);
    container.appendChild(env.video);
    env.tick();
    await env.enterPictureInPicture();
    container.remove();
    env.tick();
    assert.equal(env.pipWindow(), null);
    assert.equal(env.video.paused, true);
    assert.equal(env.video.parentNode, container);
    assert.equal(env.document.contains(env.video), false);
    assert.ok(env.logs.some(entry => entry.join(' ').includes('page removed the original player')));
});

test('a player reclaimed by the page is not moved back to a stale location', async () => {
    const env = loadWithPip();
    const destination = env.createElement('section');
    env.body.appendChild(destination);
    env.tick();
    await env.enterPictureInPicture();
    destination.appendChild(env.video);
    env.tick();
    assert.equal(env.pipWindow(), null);
    assert.equal(env.video.parentNode, destination);
    assert.equal(env.video.controls, false);
    assert.equal(env.pipPlaceholder(), null);
});

test('original media identity, source, playback position and inline styles survive repeated moves', async () => {
    const env = loadWithPip();
    env.video.src = 'blob:existing-media-source';
    env.video.currentTime = 125;
    env.video.setAttribute('style', 'width: 900px; left: 42px;');
    const video = env.video;
    env.tick();
    for (let round = 0; round < 3; round++) {
        await env.enterPictureInPicture();
        assert.equal(env.pipDocument().querySelector('video'), video);
        env.closePipWindow();
        assert.equal(env.document.querySelector('video'), video);
        assert.equal(video.src, 'blob:existing-media-source');
        assert.equal(video.currentTime, 125);
        assert.equal(video.getAttribute('style'), 'width: 900px; left: 42px;');
        assert.equal(video.controls, false);
    }
});

test('editable descendants and shadow input events do not consume speed keys', async () => {
    const env = loadWithPip();
    env.tick();
    await env.enterPictureInPicture();
    const editable = env.createElement('div');
    editable.setAttribute('contenteditable', '');
    const text = env.createElement('span');
    editable.appendChild(text);
    env.pipDocument().body.appendChild(editable);
    assert.equal(env.pipKeydown('3', text).defaultPrevented, false);
    const host = env.createElement('div');
    const input = env.createElement('input');
    env.pipDocument().body.appendChild(host);
    assert.equal(env.pipKeydown('3', host, input).defaultPrevented, false);
    assert.equal(env.video.playbackRate, 1);
});

test('the original controls outside PiP still follow the playback-speed setting', async () => {
    const env = loadWithPip();
    const { controls } = env.addPlexPlayer();
    env.tick();
    await env.enterPictureInPicture();
    env.toggleMenuItem('Playback Speed (plex)');
    env.tick();
    assert.equal(controls.querySelector('#playback-speed-btn-speedup'), null);
    env.toggleMenuItem('Playback Speed (plex)');
    env.tick();
    assert.ok(controls.querySelector('#playback-speed-btn-speedup'));
});
