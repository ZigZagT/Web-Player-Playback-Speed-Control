const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUserscript } = require('./harness');

// The curve spreads the slider over a 55 dB range, so half travel lands far
// below half amplitude: 10^((0.5 * 55 - 55) / 20).
const HALF_TRAVEL_AMPLITUDE = 0.0421697;

function assertClose(actual, expected, tolerance = 1e-5) {
    assert.ok(
        Math.abs(actual - expected) <= tolerance,
        `expected ${actual} to be within ${tolerance} of ${expected}`,
    );
}

test('plex: the volume curve is applied on the first loop tick', () => {
    const env = loadUserscript({ hostname: 'app.plex.tv' });
    assert.equal(env.slots.playbackSpeedControlNaturalVolumeControl, undefined);

    env.tick();
    assert.equal(env.slots.playbackSpeedControlNaturalVolumeControl, 'userscript');
});

test('half slider travel becomes a fraction of the amplitude', () => {
    const env = loadUserscript({ hostname: 'app.plex.tv' });
    env.tick();

    env.video.volume = 0.5;
    assertClose(env.nativeVolume(), HALF_TRAVEL_AMPLITUDE);
    assertClose(env.video.volume, 0.5);
});

test('the endpoints are left alone', () => {
    const env = loadUserscript({ hostname: 'app.plex.tv' });
    env.tick();

    env.video.volume = 1;
    assert.equal(env.nativeVolume(), 1);

    env.video.volume = 0;
    assert.equal(env.nativeVolume(), 0);
});

test('turning the feature off restores the player own volume handling', () => {
    const env = loadUserscript({ hostname: 'app.plex.tv' });
    env.tick();

    env.toggleMenuItem('Natural Volume (plex)');
    env.tick();
    assert.equal(env.slots.playbackSpeedControlNaturalVolumeControl, undefined);

    env.video.volume = 0.5;
    assert.equal(env.nativeVolume(), 0.5);
    assert.equal(env.video.volume, 0.5);
});

test('other sites keep their own volume handling until opted in', () => {
    const env = loadUserscript({ hostname: 'example.com' });
    env.tick();
    env.video.volume = 0.5;
    assert.equal(env.nativeVolume(), 0.5);

    env.toggleMenuItem('Natural Volume (example.com)');
    env.tick();
    env.video.volume = 0.5;
    assertClose(env.nativeVolume(), HALF_TRAVEL_AMPLITUDE);
});

// YouTube caps video.volume below 1.0 for loud content, so the curve anchors
// its top end to that cap instead of double-attenuating.
test('youtube: the curve anchors to the loudness cap', () => {
    const env = loadUserscript({ hostname: 'www.youtube.com' });
    const loudnessCap = Math.pow(10, -6 / 20);
    env.wrapInYouTubePlayer(6);
    env.tick();

    env.video.volume = 1;
    assertClose(env.nativeVolume(), loudnessCap);

    env.video.volume = 0.25;
    assert.ok(env.nativeVolume() < loudnessCap);
    assertClose(env.video.volume, 0.25);
});

test('youtube: an unnormalized video uses the full range', () => {
    const env = loadUserscript({ hostname: 'www.youtube.com' });
    env.wrapInYouTubePlayer(0);
    env.tick();

    env.video.volume = 1;
    assert.equal(env.nativeVolume(), 1);

    env.video.volume = 0.5;
    assertClose(env.nativeVolume(), HALF_TRAVEL_AMPLITUDE);
});

test('static-script mode marks the override as its own', () => {
    const env = loadUserscript({ hostname: 'app.plex.tv', userscript: false });
    env.tick();
    assert.equal(env.slots.playbackSpeedControlNaturalVolumeControl, 'static');
});
