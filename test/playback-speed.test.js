const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUserscript } = require('./harness');

test('quick-set keys jump straight to a preset speed', () => {
    const env = loadUserscript({ hostname: 'app.plex.tv' });
    env.keydown('3');
    env.tick();
    assert.equal(env.video.playbackRate, 2);

    env.keydown('9');
    env.tick();
    assert.equal(env.video.playbackRate, 10);

    env.keydown('1');
    env.tick();
    assert.equal(env.video.playbackRate, 1);
});

test('cycle keys step one speed at a time', () => {
    const env = loadUserscript({ hostname: 'app.plex.tv' });
    env.keydown('.');
    env.tick();
    assert.equal(env.video.playbackRate, 1.2);

    env.keydown(',');
    env.tick();
    assert.equal(env.video.playbackRate, 1);

    env.keydown('<');
    env.tick();
    assert.equal(env.video.playbackRate, 0.8);

    env.keydown('>');
    env.tick();
    assert.equal(env.video.playbackRate, 1);
});

test('cycling stops at the ends of the list', () => {
    const env = loadUserscript({ hostname: 'app.plex.tv' });
    for (let i = 0; i < 30; i++) env.keydown('.');
    env.tick();
    assert.equal(env.video.playbackRate, 20);

    for (let i = 0; i < 30; i++) env.keydown(',');
    env.tick();
    assert.equal(env.video.playbackRate, 0.5);
});

test('a handled key is kept away from the page', () => {
    const env = loadUserscript({ hostname: 'app.plex.tv' });
    const handled = env.keydown('3');
    assert.equal(handled.defaultPrevented, true);
    assert.equal(handled.propagationStopped, true);

    const ignored = env.keydown('q');
    assert.equal(ignored.defaultPrevented, false);
});

test('shortcuts without a local video neither consume keys nor change the selected speed', () => {
    for (const userscript of [true, false]) {
        const env = loadUserscript({
            hostname: 'app.plex.tv',
            userscript,
            withVideo: false,
            stored: { 'playbackSpeed:plex': true },
        });
        for (const key of ['1', '2', '3', '4', '5', '6', '7', '8', '9', ',', '.', '<', '>']) {
            const event = env.keydown(key);
            assert.equal(event.defaultPrevented, false, key);
            assert.equal(event.propagationStopped, false, key);
            assert.equal(env.document.querySelector('#playback-speed-prompt'), null, key);
        }

        env.body.appendChild(env.video);
        env.tick();
        assert.equal(env.video.playbackRate, 1);
    }
});

test('shortcuts follow video insertion and removal without waiting for a loop tick', () => {
    const env = loadUserscript({ hostname: 'www.youtube.com', withVideo: false });
    env.body.appendChild(env.video);
    const handled = env.keydown('3');
    assert.equal(handled.defaultPrevented, true);
    assert.equal(handled.propagationStopped, true);
    assert.equal(env.document.querySelector('#playback-speed-prompt').innerText, 'Speed: 2x');
    env.document.querySelector('#playback-speed-prompt').remove();

    env.video.remove();
    const ignored = env.keydown('4');
    assert.equal(ignored.defaultPrevented, false);
    assert.equal(ignored.propagationStopped, false);
    assert.equal(env.document.querySelector('#playback-speed-prompt'), null);

    env.body.appendChild(env.video);
    env.tick();
    assert.equal(env.video.playbackRate, 2);
});

test('saved settings retain menus but never activate video-free speed controls', () => {
    const env = loadUserscript({
        hostname: 'app.plex.tv',
        withVideo: false,
        stored: { 'playbackSpeed:plex': true },
    });
    const controlBar = env.addPlexControlBar();
    env.tick();
    assert.equal(env.menuLabels().length, 3);
    const speedMenu = env.menuItem('Playback Speed (plex): Enabled');
    assert.ok(speedMenu);
    assert.equal(controlBar.children.length, 0);
    assert.equal(env.keydown('3').defaultPrevented, false);

    env.body.appendChild(env.video);
    assert.equal(env.keydown('3').defaultPrevented, true);
    env.document.querySelector('#playback-speed-prompt').remove();
    env.tick();
    assert.equal(env.video.playbackRate, 2);
    assert.equal(controlBar.children.length, 2);

    env.video.remove();
    controlBar.querySelector('#playback-speed-btn-speedup').click();
    controlBar.querySelector('#playback-speed-btn-slowdown').click();
    const ignored = env.keydown('4');
    assert.equal(ignored.defaultPrevented, false);
    assert.equal(ignored.propagationStopped, false);
    assert.equal(env.document.querySelector('#playback-speed-prompt'), null);
    env.tick(3);
    assert.equal(controlBar.children.length, 0);
    assert.equal(env.menuItem('Playback Speed (plex): Enabled'), speedMenu);

    env.body.appendChild(env.video);
    env.tick();
    assert.equal(controlBar.children.length, 2);
    assert.equal(env.video.playbackRate, 2);
});

test('typing in a form field is never treated as a shortcut', () => {
    const env = loadUserscript({ hostname: 'app.plex.tv' });

    for (const tag of ['input', 'textarea']) {
        const event = env.keydown('3', env.createElement(tag));
        assert.equal(event.defaultPrevented, false);
    }

    const editable = env.createElement('div');
    editable.attributes.contenteditable = '';
    assert.equal(env.keydown('3', editable).defaultPrevented, false);

    env.tick();
    assert.equal(env.video.playbackRate, 1);
});

test('the chosen speed survives the player resetting it', () => {
    const env = loadUserscript({ hostname: 'app.plex.tv' });
    env.keydown('3');
    env.tick();
    assert.equal(env.video.playbackRate, 2);

    env.video.playbackRate = 1;
    env.tick();
    assert.equal(env.video.playbackRate, 2);
});

test('a speed change is shown on screen', () => {
    const env = loadUserscript({ hostname: 'app.plex.tv' });
    env.keydown('3');
    assert.equal(env.document.querySelector('#playback-speed-prompt').innerText, 'Speed: 2x');
});

test('other sites ignore the keys until the site is opted in', () => {
    const env = loadUserscript({ hostname: 'example.com' });
    const ignored = env.keydown('3');
    env.tick();
    assert.equal(ignored.defaultPrevented, false);
    assert.equal(env.video.playbackRate, 1);

    env.toggleMenuItem('Playback Speed (example.com)');
    const handled = env.keydown('3');
    env.tick();
    assert.equal(handled.defaultPrevented, true);
    assert.equal(env.video.playbackRate, 2);
});

test('turning the feature off stops the script holding the speed', () => {
    const env = loadUserscript({ hostname: 'app.plex.tv' });
    env.keydown('3');
    env.tick();
    assert.equal(env.video.playbackRate, 2);

    env.toggleMenuItem('Playback Speed (plex)');
    env.video.playbackRate = 1;
    env.keydown('4');
    env.tick();
    assert.equal(env.video.playbackRate, 1);
});

test('plex gets speed buttons in the control strip', () => {
    const env = loadUserscript({ hostname: 'app.plex.tv' });
    const controlBar = env.addPlexControlBar();
    env.tick();

    assert.deepEqual(controlBar.children.map((button) => button.id), [
        'playback-speed-btn-slowdown',
        'playback-speed-btn-speedup',
    ]);
    assert.deepEqual(controlBar.children.map((button) => button.innerHTML), ['\u{1F422}', '\u{1F407}']);
});

test('the speed buttons change the speed', () => {
    const env = loadUserscript({ hostname: 'app.plex.tv' });
    const controlBar = env.addPlexControlBar();
    env.tick();

    controlBar.querySelector('#playback-speed-btn-speedup').click();
    env.tick();
    assert.equal(env.video.playbackRate, 1.2);

    controlBar.querySelector('#playback-speed-btn-slowdown').click();
    env.tick();
    assert.equal(env.video.playbackRate, 1);
});

test('the speed buttons are taken down and put back with the feature', () => {
    const env = loadUserscript({ hostname: 'app.plex.tv' });
    const controlBar = env.addPlexControlBar();
    env.tick();
    assert.equal(controlBar.children.length, 2);

    env.toggleMenuItem('Playback Speed (plex)');
    env.tick();
    assert.equal(controlBar.children.length, 0);

    env.toggleMenuItem('Playback Speed (plex)');
    env.tick();
    assert.equal(controlBar.children.length, 2);
});

test('plex speed buttons require a video and ignore clicks immediately after its removal', () => {
    const env = loadUserscript({ hostname: 'app.plex.tv', withVideo: false });
    const controlBar = env.addPlexControlBar();
    env.tick();
    assert.equal(controlBar.children.length, 0);

    env.body.appendChild(env.video);
    env.tick();
    assert.equal(controlBar.children.length, 2);

    env.video.remove();
    controlBar.querySelector('#playback-speed-btn-speedup').click();
    controlBar.querySelector('#playback-speed-btn-slowdown').click();
    assert.equal(env.document.querySelector('#playback-speed-prompt'), null);
    env.tick();
    assert.equal(controlBar.children.length, 0);

    env.body.appendChild(env.video);
    env.tick();
    assert.equal(controlBar.children.length, 2);
    assert.equal(env.video.playbackRate, 1);
});

test('plex speed buttons ignore clicks immediately after the feature is disabled', () => {
    const env = loadUserscript({ hostname: 'app.plex.tv' });
    const controlBar = env.addPlexControlBar();
    env.tick();

    env.toggleMenuItem('Playback Speed (plex)');
    controlBar.querySelector('#playback-speed-btn-speedup').click();
    controlBar.querySelector('#playback-speed-btn-slowdown').click();
    assert.equal(env.document.querySelector('#playback-speed-prompt'), null);
    env.tick();
    assert.equal(controlBar.children.length, 0);
    assert.equal(env.video.playbackRate, 1);
});

test('only plex gets the on-screen buttons', () => {
    for (const hostname of ['www.youtube.com', 'example.com']) {
        const env = loadUserscript({
            hostname,
            stored: { 'playbackSpeed:example.com': true },
        });
        const controlBar = env.addPlexControlBar();
        env.keydown('3');
        env.tick();

        assert.equal(controlBar.children.length, 0, hostname);
        assert.equal(env.video.playbackRate, 2, hostname);
    }
});
