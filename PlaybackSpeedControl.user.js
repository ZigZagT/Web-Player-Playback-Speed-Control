// ==UserScript==
// @name         Playback Speed Control
// @namespace    https://github.com/ZigZagT
// @version      3.0.2
// @downloadURL  https://raw.githubusercontent.com/ZigZagT/Web-Player-Playback-Speed-Control/master/PlaybackSpeedControl.user.js
// @updateURL    https://raw.githubusercontent.com/ZigZagT/Web-Player-Playback-Speed-Control/master/PlaybackSpeedControl.user.js
// @description  Add playback speed, natural volume, and Picture-in-Picture controls to web players
// @author       ZigZagT
// @include      /^https?://[^/]*plex[^/]*/
// @include      /^https?://[^/]*:32400/
// @include      *://app.plex.tv/**
// @include      *://plex.tv/**
// @include      *://*.youtube.com/**
// @match        *://*/*
// @run-at       document-start
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @grant        unsafeWindow
// @grant        GM_addElement
// @grant        GM_getResourceText
// @resource     VideoPlayer https://cdn.jsdelivr.net/npm/media-chrome@4.19.2/dist/iife/all.js#sha256=HChAADcyv3F66rsriT4C1R4vUmJNZBiAfzhjK7xuwzE=
// @resource     DOMPurify https://cdn.jsdelivr.net/npm/dompurify@3.4.16/dist/purify.min.js#sha256=LJCptG1kY/JgOKKbaG6CvJHeAf2snVIp58/js2ATTqI=
// @license MIT
// ==/UserScript==

/*
Media Chrome expand icon used by the Fit button:
Copyright (c) 2020 Mux, Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/

(function() {
    'use strict';
    const console_log = (...args) => console.log('PlaybackSpeed:', ...args);

    // ─── Site Detection ───

    const isPlex = /plex/i.test(window.location.hostname) || window.location.port === '32400';
    const isYouTube = window.location.hostname.includes('youtube.com');

    function getNormalizedOrigin() {
        if (isPlex) return 'plex';
        if (isYouTube) return 'youtube';
        let hostname = window.location.hostname;
        if (hostname.startsWith('www.')) {
            hostname = hostname.substring(4);
        }
        const port = window.location.port ? ':' + window.location.port : '';
        return hostname + port;
    }
    const normalizedOrigin = getNormalizedOrigin();
    const isKnownSite = normalizedOrigin === 'plex' || normalizedOrigin === 'youtube';

    // ─── Runtime Detection ───

    const isUserscript = (
        typeof GM_registerMenuCommand !== 'undefined' &&
        typeof GM_unregisterMenuCommand !== 'undefined' &&
        typeof GM_getValue !== 'undefined' &&
        typeof GM_setValue !== 'undefined'
    );

    // Userscript managers may expose a sandbox wrapper instead of the page's
    // window. Use the page's own Media Session, Document Picture-in-Picture
    // interface and media prototype so these changes affect the actual player.
    const pageWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
    const mediaPrototype = (pageWindow.HTMLMediaElement || HTMLMediaElement).prototype;

    // ─── Multi-Instance Claiming ───

    // Store shared state in the <html> element's dataset so the userscript
    // sandbox and the page's JavaScript context can both inspect it.
    const slots = document.documentElement.dataset;
    if (isUserscript) {
        if (slots.playbackSpeedControlUserscript) {
            console_log('userscript instance already running, bailing');
            return;
        }
        slots.playbackSpeedControlUserscript = 'active';
    } else {
        if (slots.playbackSpeedControlUserscript) {
            console_log('userscript instance present, bailing');
            return;
        }
        if (slots.playbackSpeedControl) {
            console_log('non-userscript instance already running, bailing');
            return;
        }
        slots.playbackSpeedControl = 'active';
    }

    // ─── Settings ───

    function getSetting(key, defaultValue) {
        if (!isUserscript) return defaultValue;
        return GM_getValue(key, defaultValue);
    }

    function setSetting(key, value) {
        if (!isUserscript) return;
        GM_setValue(key, value);
    }

    // Version 2.2 used different storage keys for each site's volume setting.
    // Read those keys as fallbacks so upgrading preserves saved opt-outs.
    const legacySettingKeys = {
        'naturalVolume:plex': 'plexNaturalVolume',
        'naturalVolume:youtube': 'youtubeNaturalVolume',
    };

    // Features are enabled by default on supported sites and are opt-in
    // elsewhere unless a caller supplies a different default.
    function getFeatureSetting(feature, defaultValue = isKnownSite) {
        const key = `${feature}:${normalizedOrigin}`;
        let fallback = defaultValue;
        if (legacySettingKeys[key]) {
            fallback = getSetting(legacySettingKeys[key], fallback);
        }
        return getSetting(key, fallback);
    }

    // This setting chooses our PiP player. Chrome's separate site permission
    // controls automatic opening; enabling our player does not grant permission.
    // https://developer.chrome.com/blog/automatic-picture-in-picture-media-playback
    let settings = {
        plexSkipAutoPlayCountdown: getSetting('plexSkipAutoPlayCountdown', true),
        playbackSpeed: getFeatureSetting('playbackSpeed'),
        naturalVolume: getFeatureSetting('naturalVolume'),
        pictureInPicture: getFeatureSetting('pictureInPicture', isUserscript && isKnownSite),
    };

    // Static-script mode is supported only on Plex.
    if (!isUserscript && !isPlex) {
        console_log('non-userscript mode only supports Plex, bailing');
        return;
    }

    // ─── Menu Commands (userscript only, scoped to current site) ───

    const menuToggles = [
        { key: 'playbackSpeed', storageKey: `playbackSpeed:${normalizedOrigin}`,
          labelOn: `Playback Speed (${normalizedOrigin}): Enabled \u2713`,
          labelOff: `Playback Speed (${normalizedOrigin}): Disabled \u2717` },
        { key: 'naturalVolume', storageKey: `naturalVolume:${normalizedOrigin}`,
          labelOn: `Natural Volume (${normalizedOrigin}): Enabled \u2713`,
          labelOff: `Natural Volume (${normalizedOrigin}): Disabled \u2717` },
        { key: 'pictureInPicture', storageKey: `pictureInPicture:${normalizedOrigin}`,
          labelOn: `Enable for PiP (${normalizedOrigin}): Enabled \u2713`,
          labelOff: `Enable for PiP (${normalizedOrigin}): Disabled \u2717`,
          warning: `Picture-in-Picture is enabled for ${pageWindow.location.origin}.\n\n`
            + 'This script provides the floating player. Chrome decides when to open it automatically.\n\n'
            + 'To allow automatic Picture-in-Picture:\n'
            + '1. Open Chrome\'s site controls icon beside the address bar.\n'
            + '2. Find "Automatic picture-in-picture". If it says "On (can ask)", turn it Off, then On.\n'
            + '3. Verify "On (allowed)". If there is a dropdown instead, choose Allow.\n'
            + '4. Play a video with sound and switch to another Chrome tab.\n\n'
            + 'This permission applies only to this site address. Other Chrome requirements still apply.\n'
            + 'The script does not change browser permissions or request camera or microphone access.' },
    ];
    if (isPlex) {
        menuToggles.push(
            { key: 'plexSkipAutoPlayCountdown', labelOn: 'Skip Auto Play Countdown: Enabled \u2713', labelOff: 'Skip Auto Play Countdown: Disabled \u2717' },
        );
    }

    // Explain the possible effects when enabling a feature on an untested site.
    if (!isKnownSite) {
        const warnings = {
            playbackSpeed: 'Playback Speed Control uses the number keys 1-9 and the , . < > keys on this site '
                + 'and keeps the player at your selected speed. '
                + 'It has not been tested here and may override the site\'s own keyboard shortcuts or speed controls. '
                + 'If you experience problems, disable this setting from the Userscript menu.',
            naturalVolume: 'Natural Volume changes how this site\'s volume slider controls loudness. '
                + 'It has not been tested here and may not work correctly or could cause audio issues. '
                + 'If you experience problems, disable this setting from the Userscript menu.',
            pictureInPicture: 'Enable for PiP uses this script\'s player when Chrome requests Picture-in-Picture. '
                + 'It moves the site\'s video element into a separate window and returns it when that window closes. '
                + 'Chrome controls automatic entry through a separate permission. '
                + 'It has not been tested here. Moving the video may disrupt the page layout or playback, '
                + 'especially if the site replaces its player. '
                + 'If you experience problems, disable this setting from the Userscript menu.',
        };
        for (const toggle of menuToggles) {
            toggle.warning = warnings[toggle.key] + (toggle.warning ? '\n\n' + toggle.warning : '');
        }
    }

    let lastActivationReason = null;

    // Keep the settings menu available when the site has saved preferences,
    // even without a video. Playback controls still require a video to control.
    function shouldActivateScript({ requireVideo = false } = {}) {
        const hasVideo = getVideo() !== null;
        let active = false;
        let reason = 'no video element or saved settings for this site';
        if (hasVideo) {
            active = true;
            reason = 'video element exists in this frame';
        } else if (menuToggles.some(toggle => {
            const key = toggle.storageKey || toggle.key;
            const legacyKey = legacySettingKeys[key];
            return getSetting(key, undefined) !== undefined ||
                (legacyKey !== undefined && getSetting(legacyKey, undefined) !== undefined);
        })) {
            active = true;
            reason = 'saved settings exist for this site';
        }
        if (reason !== lastActivationReason) {
            console_log(`script ${active ? 'activated' : 'not activated'} (${normalizedOrigin}): ${reason}`);
            lastActivationReason = reason;
        }
        return active && (!requireVideo || hasVideo);
    }

    let menuCommandsRegistered = false;
    let menuLabelsChanged = false;

    function registerMenuCommands() {
        if (!isUserscript) return;

        const shouldRegister = shouldActivateScript();
        if (shouldRegister === menuCommandsRegistered && !menuLabelsChanged) {
            return;
        }

        for (const toggle of menuToggles) {
            if (toggle.cmdId !== undefined) {
                GM_unregisterMenuCommand(toggle.cmdId);
                delete toggle.cmdId;
            }
            if (!shouldRegister) continue;
            const label = settings[toggle.key] ? toggle.labelOn : toggle.labelOff;
            toggle.cmdId = GM_registerMenuCommand(label, () => {
                settings[toggle.key] = !settings[toggle.key];
                menuLabelsChanged = true;
                setSetting(toggle.storageKey || toggle.key, settings[toggle.key]);
                if (toggle.key === 'pictureInPicture') {
                    syncPictureInPicture();
                    syncAutoPictureInPicture();
                } else if (toggle.key === 'playbackSpeed') {
                    syncPipSpeedControls();
                }
                registerMenuCommands();
                if (toggle.warning && settings[toggle.key]) {
                    alert(toggle.warning);
                }
                // Settings are read during each polling cycle and keyboard
                // event, so changing them does not require a page reload.
                // The old reload prompt was needed only for settings that
                // enabled or disabled the entire script at startup.
                console_log(`${toggle.key} is now ${settings[toggle.key] ? 'ENABLED' : 'DISABLED'}`);
            });
        }
        menuCommandsRegistered = shouldRegister;
        menuLabelsChanged = false;
    }

    // ─── Instance Identity ───

    // crypto.randomUUID may be unavailable, particularly on pages without HTTPS.
    function generateInstanceId() {
        if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
        const bytes = new Uint8Array(16);
        crypto.getRandomValues(bytes);
        return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
    }

    const instanceId = generateInstanceId();

    // ─── Common: Playback Speed Control ───

    const cycleSpeeds = [
        0.5, 0.8, 1, 1.2, 1.4, 1.6, 1.8, 2, 2.5, 3, 3, 5, 4, 5, 6, 7, 8, 9, 10, 15, 20
    ];
    const quickSetSpeeds = {
        1: 1,
        2: 1.5,
        3: 2,
        4: 3,
        5: 4,
        6: 5,
        7: 7,
        8: 8,
        9: 10,
    };
    let currentSpeed = 1;

    function prompt(txt) {
        // The PiP rate button already displays the selected speed.
        // Keep the site-styled overlay in the original page only.
        if (getOwnPipWindow()) return;
        const existingPrompt = document.querySelector("#playback-speed-prompt");
        if (existingPrompt) {
            existingPrompt.remove();
        }
        const prompt = document.createElement("div");
        prompt.id = "playback-speed-prompt";
        prompt.innerText = txt;
        document.body.appendChild(prompt);
        prompt.style = `
            position: fixed;
            top: 0;
            left: 0;
            width: 8em;
            height: 2em;
            background-color: rgba(0, 0, 0, 0.5);
            color: white;
            font-size: 2em;
            text-align: center;
            z-index: 99999;
            pointer-events: none;
          `;
        setTimeout(() => {
            prompt.remove();
        }, 2000);
    }

    function setVideoSpeed(speed) {
        currentSpeed = speed;
        syncVideoSpeed();
        syncPipSpeedControls();
    }

    function syncVideoSpeed() {
        if (!shouldActivateScript({ requireVideo: true }) || !settings.playbackSpeed) {
            return;
        }
        const videoElem = getVideo();
        if (videoElem.playbackRate != currentSpeed) {
            videoElem.playbackRate = currentSpeed;
        }
    }

    function getNextCycleSpeed(direction, currentSpeed) {
        let newSpeed = currentSpeed;
        for (const speed of cycleSpeeds) {
            if (direction === 'slowdown') {
                if (speed < currentSpeed) {
                    newSpeed = speed;
                } else {
                    break;
                }
            } else if (direction === 'speedup') {
                if (speed > currentSpeed) {
                    newSpeed = speed;
                    break;
                }
            } else {
                console.error(`invalid speed-change direction: ${direction}`)
                break;
            }
        }
        return newSpeed;
    }

    function keyboardUpdateSpeed(e) {
        if (!shouldActivateScript({ requireVideo: true }) || !settings.playbackSpeed) {
            return;
        }
        const target = e.composedPath ? e.composedPath()[0] : e.target;
        if (target.isContentEditable || target.closest('input, textarea, [contenteditable]')) {
            return;
        }

        let newSpeed = currentSpeed;
        let isEventHandled = false;
        if (e.key in quickSetSpeeds) {
            newSpeed = quickSetSpeeds[e.key];
            isEventHandled = true;
        } else if (["<", ","].includes(e.key)) {
            newSpeed = getNextCycleSpeed('slowdown', currentSpeed);
            isEventHandled = true;
        } else if ([">", "."].includes(e.key)) {
            newSpeed = getNextCycleSpeed('speedup', currentSpeed);
            isEventHandled = true;
        }

        if (isEventHandled) {
            e.preventDefault();
            e.stopImmediatePropagation();
            console_log('setting playback speed to', newSpeed);
            setVideoSpeed(newSpeed);
            prompt(`Speed: ${newSpeed}x`);
        }
    }

    function btnSpeedUpFn() {
        if (!shouldActivateScript({ requireVideo: true }) || !settings.playbackSpeed) {
            return;
        }
        let newSpeed = getNextCycleSpeed('speedup', currentSpeed);
        console_log('setting playback speed to', newSpeed);
        setVideoSpeed(newSpeed);
        prompt(`Speed: ${newSpeed}x`);
    }

    function btnSlowdownFn() {
        if (!shouldActivateScript({ requireVideo: true }) || !settings.playbackSpeed) {
            return;
        }
        let newSpeed = getNextCycleSpeed('slowdown', currentSpeed);
        console_log('setting playback speed to', newSpeed);
        setVideoSpeed(newSpeed);
        prompt(`Speed: ${newSpeed}x`);
    }

    // ─── Common: Natural Volume Control ───

    // Web apps set HTMLMediaElement.volume linearly, but human hearing is
    // logarithmic. Override the volume property with a decibel-linear curve so
    // site sliders produce perceptually uniform loudness steps.
    // Conversion functions from Discord's perceptual library (MIT):
    // https://github.com/discord/perceptual
    const VOLUME_DYNAMIC_RANGE_DB = 55;

    function perceptualToAmplitude(perceptual, normMax = 1) {
        if (perceptual <= 0) return 0;
        if (perceptual >= normMax) return normMax;
        const db = (perceptual / normMax) * VOLUME_DYNAMIC_RANGE_DB - VOLUME_DYNAMIC_RANGE_DB;
        return Math.min(normMax, Math.pow(10, db / 20) * normMax);
    }

    function amplitudeToPerceptual(amplitude, normMax = 1) {
        if (amplitude <= 0) return 0;
        if (amplitude >= normMax) return normMax;
        const db = 20 * Math.log10(amplitude / normMax);
        return Math.min(normMax, Math.max(0, (VOLUME_DYNAMIC_RANGE_DB + db) / VOLUME_DYNAMIC_RANGE_DB) * normMax);
    }

    let nativeVolumeDescriptor = null;
    let volumeOverrideActive = false;
    const volumeLockValue = isUserscript ? 'userscript' : 'static';

    function removeNaturalVolumeOverride() {
        if (!volumeOverrideActive) return;
        if (!nativeVolumeDescriptor) return;
        if (slots.playbackSpeedControlNaturalVolumeControl !== volumeLockValue) {
            console.error('cannot restore native volume: this instance no longer owns the override');
            return;
        }
        Object.defineProperty(mediaPrototype, 'volume', nativeVolumeDescriptor);
        volumeOverrideActive = false;
        nativeVolumeDescriptor = null;
        delete slots.playbackSpeedControlNaturalVolumeControl;
        console_log('natural volume control removed');
    }

    // YouTube applies loudness normalization by capping video.volume below 1.0.
    // For videos inside a YouTube player, we read the normalization factor so
    // our curve anchors at the endpoints: 0→0, normMax→normMax.
    function getNormMaxYoutube(videoElem) {
        const player = videoElem.closest('#movie_player') ||
            (pipSession && pipSession.video === videoElem && pipSession.youtubePlayer);
        if (!player || !player.getPlayerResponse) return 1;
        const loudnessDb = player.getPlayerResponse()?.playerConfig?.audioConfig?.loudnessDb;
        if (loudnessDb == null || loudnessDb <= 0) return 1;
        return Math.pow(10, -loudnessDb / 20);
    }

    function syncNaturalVolume() {
        if (!shouldActivateScript() || !settings.naturalVolume) {
            removeNaturalVolumeOverride();
            return;
        }
        // Do not replace an override already installed by this or another instance.
        if (slots.playbackSpeedControlNaturalVolumeControl || volumeOverrideActive) {
            return;
        }

        // Claim ownership before changing the descriptor so another instance
        // cannot install a competing override if initialization fails.
        slots.playbackSpeedControlNaturalVolumeControl = volumeLockValue;

        nativeVolumeDescriptor = Object.getOwnPropertyDescriptor(mediaPrototype, 'volume');
        Object.defineProperty(mediaPrototype, 'volume', {
            get() {
                const amplitude = nativeVolumeDescriptor.get.call(this);
                const normMax = getNormMaxYoutube(this);
                const perceptual = amplitudeToPerceptual(amplitude, normMax);
                console_log(`volume get: amplitude=${amplitude.toFixed(4)} → perceptual=${perceptual.toFixed(4)} (normMax=${normMax.toFixed(4)})`);
                return perceptual;
            },
            set(perceptual) {
                const normMax = getNormMaxYoutube(this);
                const amplitude = perceptualToAmplitude(perceptual, normMax);
                console_log(`volume set: perceptual=${perceptual.toFixed(4)} → amplitude=${amplitude.toFixed(4)} (normMax=${normMax.toFixed(4)})`);
                nativeVolumeDescriptor.set.call(this, amplitude);
            },
            configurable: true,
            enumerable: true,
        });

        // Mark the override active only after the descriptor is installed,
        // so cleanup does not run against an incomplete installation.
        volumeOverrideActive = true;
        console_log('natural volume control applied');

        // Read the site's original volume and write it through the override
        // so the perceptual curve takes effect immediately.
        const videoElem = getVideo();
        if (videoElem) {
            const siteVolume = nativeVolumeDescriptor.get.call(videoElem);
            videoElem.volume = siteVolume;
        }
    }

    // ─── Common: Picture-in-Picture ───

    const PIP_SLOT_ATTRIBUTE = 'data-playback-speed-pip-slot';
    const PIP_PLAYER_ATTRIBUTE = 'data-playback-speed-pip-player';
    let pipSession = null;

    function configurePipTemplates(pipWindow) {
        if (pipWindow.trustedTypes && !pipWindow.trustedTypes.defaultPolicy) {
            // The PiP window inherits YouTube's Trusted Types requirements,
            // which reject ordinary template strings. Use DOMPurify's documented
            // default policy to sanitize them here without changing the opener's policy.
            // https://github.com/cure53/DOMPurify#what-about-dompurify-and-trusted-types
            pipWindow.trustedTypes.createPolicy('default', {
                createHTML: html => pipWindow.DOMPurify.sanitize(html, {
                    RETURN_TRUSTED_TYPE: false,
                    FORCE_BODY: true,
                    ADD_TAGS: ['slot', 'media-tooltip', 'media-gesture-receiver'],
                    ADD_ATTR: ['part', 'exportparts', 'shadowrootmode'],
                }),
            });
        }
    }

    function getPipContentSize(videoElem, targetScreen) {
        const { videoWidth, videoHeight } = videoElem;
        const { availWidth, availHeight } = targetScreen;
        if (videoWidth <= 0 || videoHeight <= 0) {
            throw new Error('Video dimensions are not available yet; wait for video metadata before sizing Picture-in-Picture');
        }
        if (availWidth <= 0 || availHeight <= 0) {
            throw new Error('Cannot determine the available screen dimensions for Picture-in-Picture');
        }
        // Use the video's natural dimensions rather than the page's player size.
        // Scale down to fit half the available screen width and height without
        // enlarging smaller videos. Round down so neither limit is exceeded.
        // https://developer.mozilla.org/en-US/docs/Web/API/HTMLVideoElement/videoWidth
        const scale = Math.min(1, availWidth / (2 * videoWidth), availHeight / (2 * videoHeight));
        return {
            width: Math.max(1, Math.floor(videoWidth * scale)),
            height: Math.max(1, Math.floor(videoHeight * scale)),
        };
    }

    function resizePipToVideo(session) {
        if (pipSession !== session || session.restored || session.window.closed ||
            !session.controller.contains(session.video)) return;
        const previousSize = session.requestedSize;
        const previousOuterSize = session.requestedOuterSize;
        const previousFrame = session.frameAllowance;
        try {
            const pipWindow = session.window;
            const screen = pipWindow.screen;
            const size = getPipContentSize(session.video, screen);
            let frame = session.frameAllowance;
            // Recomputing the frame allowance after each Fit used Chrome's
            // rounded measurements to calculate the next target. This made
            // height requests alternate between 509 and 510 pixels.
            // Reuse the allowance until the display configuration changes.
            if (!frame || frame.availWidth !== screen.availWidth || frame.availHeight !== screen.availHeight ||
                frame.pixelRatio !== pipWindow.devicePixelRatio) {
                frame = {
                    availWidth: screen.availWidth, availHeight: screen.availHeight,
                    pixelRatio: pipWindow.devicePixelRatio,
                    width: pipWindow.outerWidth - pipWindow.innerWidth,
                    height: pipWindow.outerHeight - pipWindow.innerHeight,
                };
            }
            const outerSize = { width: size.width + frame.width, height: size.height + frame.height };
            session.requestedSize = size;
            session.requestedOuterSize = outerSize;
            session.frameAllowance = frame;
            // resizeTo expects the whole window's dimensions, including its frame.
            // Call it from a new user action: opening the window consumes the
            // earlier activation, and changing videos does not grant a new one.
            // https://developer.chrome.com/docs/web-platform/document-picture-in-picture/#resize-the-pip-window
            if (pipWindow.outerWidth !== outerSize.width || pipWindow.outerHeight !== outerSize.height) {
                pipWindow.resizeTo(outerSize.width, outerSize.height);
            }
        } catch (error) {
            session.requestedSize = previousSize;
            session.requestedOuterSize = previousOuterSize;
            session.frameAllowance = previousFrame;
            console.error(`PlaybackSpeed: could not resize the Picture-in-Picture window to fit the video: ${error.name}: ${error.message}`);
            return;
        }
        logPipLayout(session, 'fit-video-requested');
    }

    // Media Chrome controls the existing media element without replacing the
    // site's source or playback engine. Its components provide the playback
    // controls, while this script continues to handle its speed shortcuts.
    // https://www.media-chrome.org/docs/en/get-started
    function createPipPlayer(pipWindow, onResize) {
        const pipDocument = pipWindow.document;
        const controller = pipDocument.createElement('media-controller');
        // The site manages playback preferences. Do not replace them with
        // Media Chrome's saved settings or automatically seek during live playback.
        // https://www.media-chrome.org/docs/en/components/media-controller
        controller.setAttribute('novolumepref', '');
        controller.setAttribute('nomutedpref', '');
        controller.setAttribute('nosubtitleslangpref', '');
        controller.setAttribute('noautoseektolive', '');
        controller.setAttribute('hotkeys', 'no< no> nof nop');
        // The script handles speed shortcuts. Document PiP does not support
        // fullscreen or nested PiP, so omit those controls and shortcuts.
        // https://wicg.github.io/document-picture-in-picture/#fullscreen
        // Keep the timeline together so responsive styles can place it above
        // compact controls or between volume and speed in a wider player.
        // https://www.media-chrome.org/docs/en/position-controls
        const timeline = pipDocument.createElement('media-control-bar');
        timeline.className = 'pip-timeline';
        timeline.append(
            pipDocument.createElement('media-time-range'),
            pipDocument.createElement('media-time-display'));
        const bar = pipDocument.createElement('media-control-bar');
        for (const tag of ['media-play-button', 'media-mute-button', 'media-volume-range',
            'media-playback-rate-menu-button', 'media-captions-button']) {
            bar.appendChild(pipDocument.createElement(tag));
        }
        bar.insertBefore(timeline, bar.querySelector('media-playback-rate-menu-button'));
        const resizeButton = pipDocument.createElement('media-chrome-button');
        resizeButton.setAttribute('aria-label', 'Resize window to current video');
        // Use Media Chrome's expand icon without adding a fullscreen control.
        // The generic button supplies its icon sizing and colors.
        // https://github.com/muxinc/media-chrome/blob/v4.19.2/src/js/media-fullscreen-button.ts
        const svgNamespace = 'http://www.w3.org/2000/svg';
        const resizeIcon = pipDocument.createElementNS(svgNamespace, 'svg');
        resizeIcon.setAttribute('viewBox', '0 0 26 24');
        resizeIcon.setAttribute('aria-hidden', 'true');
        resizeIcon.setAttribute('focusable', 'false');
        const resizePath = pipDocument.createElementNS(svgNamespace, 'path');
        resizePath.setAttribute('d', 'M16 3v2.5h3.5V9H22V3h-6ZM4 9h2.5V5.5H10V3H4v6Zm15.5 9.5H16V21h6v-6h-2.5v3.5ZM6.5 15H4v6h6v-2.5H6.5V15Z');
        resizeIcon.appendChild(resizePath);
        resizeButton.appendChild(resizeIcon);
        const resizeTooltip = pipDocument.createElement('span');
        resizeTooltip.setAttribute('slot', 'tooltip-content');
        resizeTooltip.textContent = 'Resize window to current video';
        resizeButton.appendChild(resizeTooltip);
        // The library calls handleClick for both mouse and keyboard activation.
        // Use that shared handler to retain its styling, focus behavior and tooltip.
        // https://github.com/muxinc/media-chrome/blob/v4.19.2/src/js/media-chrome-button.ts
        resizeButton.handleClick = onResize;
        bar.appendChild(resizeButton);
        // The playback-rate menu allows direct selection of slower or faster
        // speeds. The all-components bundle includes the menu components.
        // https://www.media-chrome.org/docs/en/components/media-playback-rate-menu
        const rates = pipDocument.createElement('media-playback-rate-menu');
        rates.hidden = true;
        rates.setAttribute('anchor', 'auto');
        rates.setAttribute(
            'rates', [...new Set([...cycleSpeeds, ...Object.values(quickSetSpeeds)])].sort((a, b) => a - b).join(' '));
        // The top slot shares the control bars' built-in visibility lifecycle.
        // Updating the text must not add another hide timer or force controls on.
        // https://www.media-chrome.org/docs/en/components/media-controller
        const speedDisplay = pipDocument.createElement('media-text-display');
        speedDisplay.setAttribute('slot', 'top-chrome');
        speedDisplay.setAttribute('aria-hidden', 'true');
        controller.append(speedDisplay, rates, bar);
        if (!controller.shadowRoot) throw new Error('Media Chrome could not initialize in the Picture-in-Picture document');
        return controller;
    }

    function syncPipSpeedControls() {
        const session = pipSession;
        if (!session || session.restored || !session.controller) return;
        const rate = session.controller.querySelector('media-playback-rate-menu-button');
        const menu = session.controller.querySelector('media-playback-rate-menu');
        const disabled = !settings.playbackSpeed;
        if (rate.disabled !== disabled) rate.disabled = disabled;
        menu.toggleAttribute('disabled', disabled);
        if (disabled) menu.hidden = true;
        updatePipSpeedDisplay(session);
    }

    function updatePipSpeedDisplay(session) {
        if (pipSession !== session || session.restored || !session.controller.contains(session.video)) return;
        const display = session.controller.querySelector('media-text-display');
        const text = `Speed: ${session.video.playbackRate}x`;
        if (display.textContent !== text) display.textContent = text;
    }

    function logPipLayoutGuide() {
        console.groupCollapsed('PlaybackSpeed: %cPiPLayout log fields%c',
            'font-weight: bold; font-size: 1.1em', '');
        console.log('%cMeasurements%c - width x height in browser-reported pixels', 'font-weight: bold', '');
        console.log('Element positions are measured from the viewport\'s top-left corner.');
        console.table({
            'Requested viewport size': { Meaning: "The script's latest content-area target, excluding title bar and borders; not a measurement." },
            'Requested outer window size': { Meaning: "The total window size requested by Fit, including the title bar and borders; '-' before Fit is used." },
            'Measured viewport size': { Meaning: "The browser's integer content-area dimensions, including any scrollbar space." },
            'Reported outer window size': { Meaning: 'Includes title bar and borders; may temporarily report a pending request rather than the final window size.' },
            'Source video size': { Meaning: 'Natural dimensions from video metadata, before display scaling.' },
            'Video element bounds': { Meaning: 'Fractional element size and position; includes any black bars, not just the visible picture.' },
            'Scrollbar space': { Meaning: 'Width reserved for a vertical scrollbar and height reserved for a horizontal scrollbar.' },
            'Page overflow': { Meaning: 'Content extending beyond the usable page area, not the size of a scrollbar.' },
            'Video object-fit': { Meaning: 'How the picture fills its element. contain preserves the whole picture and aspect ratio, leaving bars when needed.' },
            'Device pixel ratio': { Meaning: 'Physical pixels per page pixel, reflecting display scaling and page zoom.' },
        }, ['Meaning']);
        console.log('%cEvent names', 'font-weight: bold');
        console.log('T+0ms is the setup-timer snapshot. Earlier events have negative offsets; absolute timestamps are also retained.');
        console.table({
            'setup-timer': { Meaning: 'Zero-delay snapshot after player setup; resize events can precede it.' },
            'one-second-timer': { Meaning: 'Snapshot scheduled one second after setup; not a guarantee of stable size.' },
            'window-resize': { Meaning: 'Browser resize event; it does not identify what caused the size change.' },
            'loadedmetadata': { Meaning: 'Video metadata became available or changed; no automatic window resize.' },
            'fit-video-requested': { Meaning: 'The Fit button was activated. The requested size is not a confirmed result; Chrome can round or constrain it.' },
        }, ['Meaning']);
        console.log('If the window closes before setup-timer runs, elapsed times are unavailable and snapshots show T unavailable.');
        console.groupEnd();
    }

    function printPipLayout(snapshot, timeOrigin) {
        const elapsed = timeOrigin === null ? null : Math.round(snapshot.time - timeOrigin);
        const relativeTime = elapsed === null ? 'T unavailable (no setup-timer)'
            : `T${elapsed >= 0 ? '+' : ''}${elapsed}ms`;
        console.group(`PlaybackSpeed: %cPiPLayout: ${snapshot.reason} | ${relativeTime} | ${snapshot.timestamp}`, 'font-weight: bold');
        console.table(Object.fromEntries(Object.entries(snapshot.values).map(([field, value]) =>
            [field, { Value: value }])), ['Value']);
        console.groupEnd();
    }

    function logPipLayout(session, reason) {
        if (session.restored || session.window.closed) return;
        const pipWindow = session.window;
        const time = pipWindow.performance.now();
        const timestamp = new Date().toISOString();
        const root = pipWindow.document.documentElement;
        const scroll = pipWindow.document.scrollingElement || root;
        const number = value => Number.isFinite(value) ? String(Math.round(value * 100) / 100) : 'unknown';
        const size = (width, height) => `${number(width)} x ${number(height)}`;
        const difference = (total, available) => Number.isFinite(total) && Number.isFinite(available)
            ? number(Math.max(0, total - available)) : 'unknown';
        const box = session.video.getBoundingClientRect();
        // Record geometry without changing the layout. Exclude media addresses,
        // page titles and raw inline styles from these snapshots.
        const snapshot = {
            reason, time, timestamp,
            values: {
                'Requested viewport size': size(session.requestedSize.width, session.requestedSize.height),
                'Requested outer window size': session.requestedOuterSize
                    ? size(session.requestedOuterSize.width, session.requestedOuterSize.height) : '-',
                'Measured viewport size': size(pipWindow.innerWidth, pipWindow.innerHeight),
                // Chrome can report requested bounds before the resize completes,
                // so this value is not always the final native window size.
                // https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/platform/widget/widget_base.cc
                'Reported outer window size': size(pipWindow.outerWidth, pipWindow.outerHeight),
                'Source video size': size(session.video.videoWidth, session.video.videoHeight),
                'Video element bounds': `${size(box.width, box.height)}; left ${number(box.x ?? box.left)}, top ${number(box.y ?? box.top)}`,
                'Scrollbar space': `vertical width ${difference(pipWindow.innerWidth, root.clientWidth)} px; horizontal height ${difference(pipWindow.innerHeight, root.clientHeight)} px`,
                'Page overflow': `width ${difference(scroll.scrollWidth, scroll.clientWidth)} px; height ${difference(scroll.scrollHeight, scroll.clientHeight)} px`,
                'Video object-fit': pipWindow.getComputedStyle(session.video).objectFit || 'unknown',
                'Device pixel ratio': number(pipWindow.devicePixelRatio),
            },
        };
        if (session.layoutTimeOrigin === null) {
            // Resize events can arrive before the setup timer runs. Keep their
            // original measurements until that timer establishes the time origin.
            if (reason !== 'setup-timer') {
                session.pendingLayoutSnapshots.push(snapshot);
                return;
            }
            session.layoutTimeOrigin = time;
            for (const pending of session.pendingLayoutSnapshots) printPipLayout(pending, time);
            session.pendingLayoutSnapshots.length = 0;
        }
        printPipLayout(snapshot, session.layoutTimeOrigin);
    }

    function loadPipControls(session) {
        const pipWindow = session.window;
        return new Promise((resolve, reject) => {
            let settled = false;
            const finish = error => {
                if (settled) return;
                settled = true;
                pipWindow.clearTimeout(timer);
                pipWindow.removeEventListener('playback-speed-pip-ready', onReady);
                pipWindow.removeEventListener('error', onError);
                session.cancelLoading = null;
                if (error) reject(error);
                else resolve();
            };
            const onError = event => finish(new Error(`Player library failed: ${event.message}`));
            const onReady = () => {
                if (!pipWindow.DOMPurify || !['media-controller', 'media-chrome-button', 'media-text-display', 'media-playback-rate-menu',
                    'media-playback-rate-menu-button'].every(tag => pipWindow.customElements.get(tag))) {
                    finish(new Error('Player libraries did not initialize'));
                    return;
                }
                finish();
            };
            const timer = pipWindow.setTimeout(() => finish(new Error('Player libraries did not load within 10 seconds')), 10000);
            session.cancelLoading = () => finish(new Error('Picture-in-Picture closed while loading controls'));
            pipWindow.addEventListener('playback-speed-pip-ready', onReady, { once: true });
            pipWindow.addEventListener('error', onError);
            try {
                // The manager preloads these resources and verifies their hashes.
                // GM_addElement supports injection under the page's Content
                // Security Policy. Run the libraries in the PiP document so they
                // use that window's event targets and viewport, not the opener's.
                // https://www.tampermonkey.net/documentation.php#api:GM_addElement
                // https://wicg.github.io/document-picture-in-picture/#is-document-picture-in-picture-window
                // The all-components bundle parses templates as it loads,
                // so the sanitizer policy must be installed first.
                // https://github.com/muxinc/media-chrome/blob/v4.19.2/src/js/media-theme-element.ts
                const script = GM_addElement(pipWindow.document.head, 'script', {
                    textContent: GM_getResourceText('DOMPurify') + '\n' +
                        `(${configurePipTemplates.toString()})(window);\n` +
                        GM_getResourceText('VideoPlayer') +
                        '\nwindow.dispatchEvent(new Event("playback-speed-pip-ready"));',
                });
                if (!script) finish(new Error('The userscript manager could not load Picture-in-Picture controls'));
            } catch (error) {
                finish(error);
            }
        });
    }

    function getPipWindow() {
        const api = pageWindow.documentPictureInPicture;
        if (!api) return null;
        return api.window;
    }

    // Only use a PiP window opened by this script instance; leave the page's
    // own PiP windows untouched. The instance ID is stored on the PiP document
    // so ownership can be checked across script contexts.
    function getOwnPipWindow() {
        const pipWindow = getPipWindow();
        if (!pipWindow) return null;
        if (pipWindow.document.documentElement.dataset.playbackSpeedControlPip !== instanceId) return null;
        return pipWindow;
    }

    function getVideo() {
        if (pipSession && pipSession.moved) return pipSession.video;
        return document.querySelector('video');
    }

    function restoreFromPip(session = pipSession) {
        if (!session || session.restored) return;
        session.restored = true;
        if (session.cancelLoading) session.cancelLoading();
        if (session.timer !== undefined) session.window.clearInterval(session.timer);
        if (session.controlsObserver) session.controlsObserver.disconnect();
        session.listeners.abort();
        for (const pending of session.pendingLayoutSnapshots) printPipLayout(pending, session.layoutTimeOrigin);
        session.pendingLayoutSnapshots.length = 0;
        if (session.moved) {
            // Detach the media before disconnecting Media Chrome: its normal
            // disconnect cleanup toggles captions on an attached media element.
            if (session.controller) {
                session.controller.setAttribute('nodefaultstore', '');
                session.controller.mediaStore = null;
                if (session.video.parentNode === session.controller) session.video.remove();
            }
            if (session.video.ownerDocument !== session.window.document) {
                // The site reclaimed its player; do not undo that move.
            } else if (document.contains(session.parent)) {
                const before = session.placeholder.parentNode === session.parent
                    ? session.placeholder
                    : session.nextSibling && session.nextSibling.parentNode === session.parent
                        ? session.nextSibling : null;
                session.parent.insertBefore(session.video, before);
            } else {
                // A navigation/re-render has discarded the original player.
                // Do not inject stale playback into its replacement.
                session.video.pause();
                session.parent.appendChild(session.video);
                console.error('PlaybackSpeed: stopped Picture-in-Picture playback because the page removed the original player');
            }
            session.video.controls = session.controls;
            for (const [attribute, value] of session.mediaAttributes) {
                if (value === null) session.video.removeAttribute(attribute);
                else session.video.setAttribute(attribute, value);
            }
            session.placeholder.remove();
        }
        if (session.controller) session.controller.remove();
        if (pipSession === session) pipSession = null;
        console_log('Picture-in-Picture session ended');
    }

    function unblockPictureInPicture(videoElem) {
        if (videoElem.disablePictureInPicture) {
            videoElem.disablePictureInPicture = false;
        }
        const controlsList = videoElem.getAttribute('controlsList');
        if (controlsList && controlsList.includes('nopictureinpicture')) {
            videoElem.setAttribute('controlsList', controlsList.replace('nopictureinpicture', '').trim());
        }
    }

    function syncPictureInPicture() {
        const session = pipSession;
        if (!settings.pictureInPicture || (session && session.moved &&
            (!document.contains(session.parent) || session.video.ownerDocument !== session.window.document))) {
            restoreFromPip(session);
            if (session && session.window && !session.window.closed) {
                session.window.close();
            }
            return;
        }
        if (!pageWindow.documentPictureInPicture || pageWindow.top !== pageWindow.self) return;
        const videoElem = getVideo();
        if (videoElem && settings.pictureInPicture) unblockPictureInPicture(videoElem);
        if (session && session.moved && !session.restored) {
            try {
                syncVideoSpeed();
                syncPipSpeedControls();
            } catch (error) {
                console.error(`PlaybackSpeed: could not update Picture-in-Picture: ${error.name}: ${error.message}`);
                restoreFromPip(session);
                session.window.close();
            }
        }
    }

    let autoPipHandlerActive = false;
    let pagePipHandler = null;
    let mediaSessionSetActionHandler = null;

    // Media Session does not expose the current action handler. Record page
    // registrations from document-start so disabling the feature can restore
    // the latest observed handler. Forward other actions unchanged, but keep
    // our dispatcher registered when the page calls this wrapped setter.
    function observeMediaSessionHandlers() {
        const mediaSession = pageWindow.navigator && pageWindow.navigator.mediaSession;
        if (!mediaSession || !isUserscript || !pageWindow.documentPictureInPicture ||
            pageWindow.top !== pageWindow.self) return;
        const original = mediaSession.setActionHandler;
        try {
            const wrapper = function(action, handler) {
                if (action === 'enterpictureinpicture') {
                    const validHandler = handler === null || typeof handler === 'function';
                    const result = original.call(this, action, validHandler && autoPipHandlerActive ? enterPictureInPicture : handler);
                    if (validHandler) pagePipHandler = handler;
                    return result;
                }
                return original.call(this, action, handler);
            };
            mediaSession.setActionHandler = wrapper;
            mediaSessionSetActionHandler = original;
        } catch (error) {
            console.error(`PlaybackSpeed: cannot coordinate Picture-in-Picture handlers: ${error.name}: ${error.message}`);
        }
    }

    function enterPictureInPicture(details) {
        if (pipSession) {
            return pipSession.opening;
        }
        if (!settings.pictureInPicture) {
            return Promise.resolve();
        }
        const videoElem = getVideo();
        if (!videoElem || getPipWindow()) {
            return Promise.resolve();
        }
        const api = pageWindow.documentPictureInPicture;
        if (!api || pageWindow.top !== pageWindow.self) {
            console.error('PlaybackSpeed: Document Picture-in-Picture requires a supported top-level Chrome page');
            return Promise.resolve();
        }
        if (typeof GM_addElement !== 'function' || typeof GM_getResourceText !== 'function') {
            console.error('PlaybackSpeed: Picture-in-Picture controls require a userscript manager with GM_addElement and GM_getResourceText');
            return Promise.resolve();
        }
        const session = {
            video: videoElem, parent: videoElem.parentNode, nextSibling: videoElem.nextSibling,
            controls: videoElem.controls,
            mediaAttributes: ['slot', 'tabindex', PIP_PLAYER_ATTRIBUTE].map(name => [name, videoElem.getAttribute(name) ?? null]),
            youtubePlayer: videoElem.closest('#movie_player'),
            listeners: new AbortController(), moved: false, restored: false,
            layoutTimeOrigin: null, pendingLayoutSnapshots: [],
            requestedOuterSize: null, frameAllowance: null,
        };
        pipSession = session;
        console_log(`entering picture-in-picture, reason: ${(details && details.enterPictureInPictureReason) || 'useraction'}`);
        let request;
        try {
            session.requestedSize = getPipContentSize(videoElem, pageWindow.screen);
            // Use Chrome's permission to open the window before asynchronous work.
            // Document PiP cannot hide its title bar because Chrome must identify
            // the controlling site. disallowReturnToOpener hides only the back
            // button, so leave it available for returning to the original tab.
            // https://wicg.github.io/document-picture-in-picture/#origin-visibility
            // https://developer.chrome.com/docs/web-platform/document-picture-in-picture/#hide-the-back-to-tab-button-in-pip-window
            request = api.requestWindow({
                ...session.requestedSize,
                // Use the current video and screen dimensions rather than a
                // previously saved window size. Later resizing is user-controlled.
                // https://developer.chrome.com/docs/web-platform/document-picture-in-picture/#open-pip-to-default-position-and-size
                preferInitialWindowPlacement: true,
            });
        } catch (error) {
            request = Promise.reject(error);
        }
        session.opening = Promise.resolve(request).then(async pipWindow => {
            session.window = pipWindow;
            if (session.restored || !settings.pictureInPicture || pipWindow.closed) {
                restoreFromPip(session);
                if (!pipWindow.closed) pipWindow.close();
                return;
            }
            // Handle pagehide to return the original video before the closing
            // window destroys its document.
            // https://developer.chrome.com/docs/web-platform/document-picture-in-picture/#handle-when-the-pip-window-closes
            pipWindow.addEventListener('pagehide', () => {
                restoreFromPip(session);
            }, { once: true });
            await loadPipControls(session);
            if (session.restored || !settings.pictureInPicture || pipWindow.closed) {
                return;
            }
            if (videoElem.parentNode !== session.parent || !document.contains(videoElem)) {
                throw new Error('The page replaced the player while the window was opening');
            }
            pipWindow.document.documentElement.dataset.playbackSpeedControlPip = instanceId;
            session.controller = createPipPlayer(pipWindow, () => resizePipToVideo(session));
            const layout = pipWindow.document.createElement('style');
            // A full-height inline controller can leave space below its baseline
            // and cause a scrollbar. Use block layout and prevent page overflow;
            // the library still handles the controls and menu styles.
            // https://chrome.dev/document-picture-in-picture-api/style.css
            // The video's existing inline dimensions would override the library's
            // full-size media slot. Override its size without rewriting its attributes.
            // https://github.com/muxinc/media-chrome/blob/v4.19.2/src/js/media-container.ts
            // The library's md breakpoint switches the same controls from a
            // two-row grid to one flex row, without rebuilding or moving them.
            // https://www.media-chrome.org/docs/en/styling
            layout.textContent = `html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; }
                media-controller { display: block; width: 100%; height: 100%; --media-control-padding: 4px; }
                media-controller > media-control-bar {
                    --media-control-bar-display: grid;
                    grid-template-columns: auto auto minmax(60px, 1fr) auto auto auto;
                }
                media-control-bar.pip-timeline {
                    --media-control-bar-display: inline-flex;
                    grid-column: 1 / -1;
                    grid-row: 1;
                    flex: 1;
                    min-width: 0;
                }
                media-volume-range { width: 60px; }
                media-playback-rate-menu-button { margin-left: auto; }
                media-text-display[slot="top-chrome"] { --media-control-padding: 4px 6px; --media-text-content-height: 20px; }
                media-controller[breakpointmd] { --media-control-padding: 10px; }
                media-controller[breakpointmd] > media-control-bar { --media-control-bar-display: inline-flex; }
                media-controller[breakpointmd] media-volume-range { width: 100px; }
                [${PIP_PLAYER_ATTRIBUTE}="${instanceId}"] { width: 100% !important; height: 100% !important; }`;
            pipWindow.document.head.appendChild(layout);
            session.placeholder = document.createElement('span');
            session.placeholder.setAttribute(PIP_SLOT_ATTRIBUTE, instanceId);
            session.parent.insertBefore(session.placeholder, videoElem);
            session.moved = true;
            videoElem.setAttribute(PIP_PLAYER_ATTRIBUTE, instanceId);
            videoElem.controls = false;
            videoElem.setAttribute('slot', 'media');
            session.controller.prepend(videoElem);
            // Media Chrome registers its request handler first. Read the actual
            // playback rate after it handles the request so polling preserves
            // the applied value. Leave event handling and display updates to the library.
            session.controller.addEventListener('mediaplaybackraterequest', () => {
                if (pipSession === session && !session.restored && settings.playbackSpeed &&
                    session.controller.contains(session.video)) {
                    currentSpeed = session.video.playbackRate;
                    updatePipSpeedDisplay(session);
                }
            }, { signal: session.listeners.signal });
            session.video.addEventListener('ratechange', () => updatePipSpeedDisplay(session),
                { signal: session.listeners.signal });
            syncPipSpeedControls();
            pipWindow.document.body.appendChild(session.controller);
            session.controlsObserver = new MutationObserver(() => {
                if (!session.restored && videoElem.controls) videoElem.controls = false;
            });
            session.controlsObserver.observe(videoElem, { attributes: true, attributeFilter: ['controls'] });
            pipWindow.addEventListener('keydown', keyboardUpdateSpeed, { capture: true, signal: session.listeners.signal });
            session.window.addEventListener('resize', () => logPipLayout(session, 'window-resize'),
                { signal: session.listeners.signal });
            session.video.addEventListener('loadedmetadata', () => logPipLayout(session, 'loadedmetadata'),
                { signal: session.listeners.signal });
            session.window.setTimeout(() => logPipLayout(session, 'setup-timer'), 0);
            session.window.setTimeout(() => logPipLayout(session, 'one-second-timer'), 1000);
            session.timer = pipWindow.setInterval(syncPictureInPicture, 500);
            console_log('moved video into Picture-in-Picture', videoElem);
        }).catch(error => {
            if (!session.restored) console.error(`PlaybackSpeed: Picture-in-Picture failed: ${error.name}: ${error.message}`);
            restoreFromPip(session);
            if (session.window && !session.window.closed) session.window.close();
        });
        return session.opening;
    }

    let lastAutoPipState = null;

    function logAutoPipState(state) {
        if (state === lastAutoPipState) return;
        lastAutoPipState = state;
        console_log(`auto picture-in-picture: ${state}`);
    }

    // A page action handler takes precedence over Chrome's BrowserInitiated
    // video-only path. Registering it allows Chrome to request our player;
    // it does not force Chrome to open a window.
    // https://developer.chrome.com/blog/automatic-picture-in-picture-initiated-by-the-browser#implement-your-own-handler
    function syncAutoPictureInPicture() {
        const mediaSession = pageWindow.navigator && pageWindow.navigator.mediaSession;
        if (!mediaSession) {
            logAutoPipState('unavailable: Media Session is not available on this page');
            return;
        }
        if (!pageWindow.documentPictureInPicture) {
            logAutoPipState('unavailable: Document Picture-in-Picture is not available on this page');
            return;
        }
        if (pageWindow.top !== pageWindow.self) {
            logAutoPipState('unavailable: Document Picture-in-Picture must open from the top-level page');
            return;
        }
        if (!mediaSessionSetActionHandler) {
            logAutoPipState('unavailable: could not coordinate the page\'s Media Session handler');
            return;
        }

        const shouldRegister = settings.pictureInPicture && shouldActivateScript({ requireVideo: true });

        if (shouldRegister) {
            try {
                // The page can bypass our observer by calling a previously saved
                // browser method. Since the current handler cannot be read, register
                // ours again each cycle to recover if the page has replaced it.
                mediaSessionSetActionHandler.call(mediaSession, 'enterpictureinpicture', enterPictureInPicture);
            } catch (e) {
                logAutoPipState(`registration refused by the browser: ${e.name}: ${e.message}`);
                return;
            }
            autoPipHandlerActive = true;
            if (!['https:', 'file:'].includes(pageWindow.location.protocol)) {
                logAutoPipState('manual entry only: Chrome requires an HTTPS or file: page for automatic Picture-in-Picture; a secure context alone is not enough');
            } else {
                logAutoPipState('Enable for PiP is active; Chrome controls automatic entry');
            }
            return;
        }

        logAutoPipState(settings.pictureInPicture ? 'idle, no video in this frame' : 'off for this site');
        if (!autoPipHandlerActive) return;
        try {
            mediaSessionSetActionHandler.call(mediaSession, 'enterpictureinpicture', pagePipHandler);
        } catch (e) {
            console.error(`PlaybackSpeed: could not release the Picture-in-Picture handler: ${e.name}: ${e.message}`);
            return;
        }
        autoPipHandlerActive = false;
    }

    // ─── Plex Module ───

    function addPlaybackButtonControls() {
        const btnStyle = `
            align-items: center;
            border-radius: 15px;
            display: flex;
            font-size: 18px;
            height: 30px;
            justify-content: center;
            margin-left: 5px;
            text-align: center;
            width: 30px;
        `;

        const containers = document.querySelectorAll('[class*="PlayerControls-buttonGroupRight"]');
        containers.forEach(container => {
            const existing = container.querySelector('#playback-speed-btn-slowdown');
            if (existing) {
                if (existing.dataset.playbackSpeedOwner === instanceId) {
                    return;
                }
                console_log('removing speed controls owned by', existing.dataset.playbackSpeedOwner);
                existing.remove();
                const existingSpeedUp = container.querySelector('#playback-speed-btn-speedup');
                if (existingSpeedUp) {
                    existingSpeedUp.remove();
                }
            }

            const btnSlowDown = document.createElement('button');
            btnSlowDown.id = 'playback-speed-btn-slowdown';
            btnSlowDown.dataset.playbackSpeedOwner = instanceId;
            btnSlowDown.style = btnStyle;
            btnSlowDown.innerHTML = '🐢';
            btnSlowDown.addEventListener('click', btnSlowdownFn);

            const btnSpeedUp = document.createElement('button');
            btnSpeedUp.id = 'playback-speed-btn-speedup';
            btnSpeedUp.dataset.playbackSpeedOwner = instanceId;
            btnSpeedUp.style = btnStyle;
            btnSpeedUp.innerHTML = '🐇';
            btnSpeedUp.addEventListener('click', btnSpeedUpFn);

            console_log('adding speed controls to', container);
            container.prepend(btnSlowDown, btnSpeedUp);
        })
    }

    // Remove this instance's buttons when speed control is disabled so inactive
    // controls do not remain on the page.
    function removePlaybackButtonControls() {
        for (const btn of document.querySelectorAll(`[data-playback-speed-owner="${instanceId}"]`)) {
            btn.remove();
        }
    }

    let lastAutoPlayedBtn = null;
    function autoPlayNext() {
        if (!shouldActivateScript() || !settings.plexSkipAutoPlayCountdown) {
            return;
        }
        const checkbox = document.querySelector('input#autoPlayCheck');
        if (!checkbox || !checkbox.checked) return;

        const playNextBtn = document.querySelector('button[aria-label="Play Next"]');
        if (!playNextBtn || playNextBtn === lastAutoPlayedBtn) return;

        console_log('auto-clicking Play Next');
        lastAutoPlayedBtn = playNextBtn;
        // Plex listens for pointer and mouse events; calling click() alone is not enough.
        playNextBtn.dispatchEvent(new PointerEvent('pointerdown', {bubbles: true}));
        playNextBtn.dispatchEvent(new MouseEvent('mousedown', {bubbles: true}));
        playNextBtn.dispatchEvent(new PointerEvent('pointerup', {bubbles: true}));
        playNextBtn.dispatchEvent(new MouseEvent('mouseup', {bubbles: true}));
        playNextBtn.click();
    }

    function plexLoopTick() {
        genericLoopTick();
        if (shouldActivateScript({ requireVideo: true }) && settings.playbackSpeed) {
            addPlaybackButtonControls();
        } else {
            removePlaybackButtonControls();
        }
        autoPlayNext();
    }

    // ─── Generic Site Module ───

    function genericLoopTick() {
        syncNaturalVolume();
        syncVideoSpeed();
        syncPictureInPicture();
        syncAutoPictureInPicture();
    }

    // ─── Main Loop ───

    // AbortController lets the non-userscript instance remove its keyboard
    // listener cleanly when a userscript instance takes over.
    const abortController = new AbortController();

    function scheduleLoopFrame() {
        setTimeout(() => {
            requestAnimationFrame(() => {
                // Stop the static-script instance if a userscript takes over.
                // Restore the prototype before releasing ownership so the
                // userscript captures the native descriptor, not our override.
                if (!isUserscript && slots.playbackSpeedControlUserscript) {
                    console_log('userscript instance detected, tearing down');
                    removeNaturalVolumeOverride();
                    abortController.abort();
                    return;
                }

                registerMenuCommands();
                if (isPlex) {
                    plexLoopTick();
                } else {
                    genericLoopTick();
                }
                scheduleLoopFrame();
            });
        }, 500);
    }

    // ─── Registration ───

    logPipLayoutGuide();
    console_log(`registering (${isUserscript ? 'as userscript' : 'static script'}, site: ${normalizedOrigin})`);
    // Capture phase so our handler intercepts events before other handlers
    // https://www.quirksmode.org/js/events_order.html#link4
    // Registered unconditionally; keyboardUpdateSpeed checks the setting so
    // toggling speed control from the menu takes effect without a reload.
    window.addEventListener("keydown", keyboardUpdateSpeed, { capture: true, signal: abortController.signal });
    pageWindow.addEventListener('pagehide', () => {
        const session = pipSession;
        restoreFromPip(session);
        if (session && session.window && !session.window.closed) session.window.close();
    }, { signal: abortController.signal });
    observeMediaSessionHandlers();
    scheduleLoopFrame();
})();
