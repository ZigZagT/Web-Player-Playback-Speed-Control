// ==UserScript==
// @name         Plex Playback Speed Controls
// @version      1.0
// @description  Plex Web Player Speed Control Widgets and Keyboard Shortcuts
// @author       ZigZagT
// @match        https://app.plex.tv/*
// @icon         data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==
// @grant        none
// ==/UserScript==

(function() {
    'use strict';
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

    function prompt(txt) {
        const existingPrompt = document.querySelector("#playback-speed-prompt");
        if (existingPrompt) {
            document.body.removeChild(existingPrompt);
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
            try {
                document.body.removeChild(prompt);
            } catch (e) {}
        }, 2000);
    }

    function getNextCycleSpeed(direction, currentSpeed) {
        let newSpeed = currentSpeed;
        for (const speed of cycleSpeeds) {
            if (direction === 'left') {
                if (speed < currentSpeed) {
                    newSpeed = speed;
                } else {
                    break;
                }
            } else if (direction === 'right') {
                if (speed > currentSpeed) {
                    newSpeed = speed;
                    break;
                }
            } else {
                console.error(`invalid change speed direction ${direction}`)
                break;
            }
        }
        return newSpeed;
    }

    function keyboardUpdateSpeed(e) {
        const currentSpeed = document.querySelector("video").playbackRate;
        let newSpeed = currentSpeed;
        console.log({currentSpeed, key: e.key});
        if (e.key in quickSetSpeeds) {
            newSpeed = quickSetSpeeds[e.key];
        } else if (["<", ","].includes(e.key)) {
            newSpeed = getNextCycleSpeed('left', currentSpeed);
        } else if ([">", "."].includes(e.key)) {
            newSpeed = getNextCycleSpeed('right', currentSpeed);
        } else {
            return;
        }
        console.log({newSpeed});
        document.querySelector("video").playbackRate = newSpeed;
        prompt(`Speed: ${newSpeed}x`);
    }

    function btnSpeedUpFn() {
        const currentSpeed = document.querySelector("video").playbackRate;
        let newSpeed = getNextCycleSpeed('right', currentSpeed);
        console.log({newSpeed});
        document.querySelector("video").playbackRate = newSpeed;
        prompt(`Speed: ${newSpeed}x`);
    };

    function btnSlowdownFn() {
        const currentSpeed = document.querySelector("video").playbackRate;
        let newSpeed = getNextCycleSpeed('left', currentSpeed);
        console.log({newSpeed});
        document.querySelector("video").playbackRate = newSpeed;
        prompt(`Speed: ${newSpeed}x`);
};

    function addPlaybackButtonControls() {
        const container = document.querySelector('[class*="PlayerControls-buttonGroupRight"]');
        if (container == null) {
            return;
        }
        if (container.querySelector('#playback-speed-btn-slowdown')) {
            return;
        }

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

        const btnSlowDown = document.createElement('button');
        btnSlowDown.id = 'playback-speed-btn-slowdown';
        btnSlowDown.style = btnStyle;
        btnSlowDown.innerHTML = '🐢';
        btnSlowDown.addEventListener('click', btnSlowdownFn);

        const btnSpeedUp = document.createElement('button');
        btnSpeedUp.id = 'playback-speed-btn-speedup';
        btnSpeedUp.style = btnStyle;
        btnSpeedUp.innerHTML = '🐇';
        btnSpeedUp.addEventListener('click', btnSpeedUpFn);

        container.prepend(btnSlowDown, btnSpeedUp);
    }

    function scheduleLoopFrame() {
        setTimeout(() => {
            requestAnimationFrame(() => {
                addPlaybackButtonControls();
                scheduleLoopFrame();
            });
        }, 500);
    };

    console.log('setup playback speed controls');
    window.addEventListener("keydown", keyboardUpdateSpeed);
    scheduleLoopFrame();
})();
