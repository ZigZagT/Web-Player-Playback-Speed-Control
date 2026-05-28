# Web Player Playback Speed Control

[Github](https://github.com/ZigZagT/Web-Player-Playback-Speed-Control) · [Greasy Fork](https://greasyfork.org/en/scripts/451667)

A userscript that adds playback-speed controls and a perceptually-correct volume curve to web video players. It supports Plex and YouTube out of the box, and an opt-in perceptual volume curve for any other site with an HTML5 `<video>`.


## Supported sites & features

| Feature                                | Plex               | YouTube            | Any other site            |
| -------------------------------------- | :----------------: | :----------------: | :-----------------------: |
| Playback speed — keyboard              | ✅                  | ✅                  | —                         |
| Playback speed — on-screen buttons     | ✅                  | —                  | —                         |
| Natural Volume Control                 | ✅ (on by default)  | ✅ (on by default)  | ✅ (opt-in per origin)     |
| Skip Auto-Play countdown               | ✅ (on by default)  | —                  | —                         |

Per-feature toggles for the current site are available from the Tampermonkey menu when installed as a userscript.


## Features

### Playback speed control

There are multiple ways to alter the playback speed:

1. **On-screen buttons** (Plex only) — turtle and rabbit icons in the control strip slow down / speed up by one step.

   <img width="398" alt="Plex control strip with turtle and rabbit speed buttons" src="https://user-images.githubusercontent.com/7879714/191167267-9430ec1f-2815-49cf-8904-b5aa73809ef9.png">

2. **Cycle keys** — `<` or `,` slow down by one step; `>` or `.` speed up by one step. The cycle list is:
    - 0.5, 0.8, 1, 1.2, 1.4, 1.6, 1.8, 2, 2.5, 3, 3, 5, 4, 5, 6, 7, 8, 9, 10, 15, 20

3. **Quick-set keys** — number keys 1–9 jump directly to a preset speed:

| `number key` | `mapped to speed` |
| ------------ | ----------------- |
| 1            | 1                 |
| 2            | 1.5               |
| 3            | 2                 |
| 4            | 3                 |
| 5            | 4                 |
| 6            | 5                 |
| 7            | 7                 |
| 8            | 8                 |
| 9            | 10                |

Keyboard shortcuts are ignored while typing in input fields, textareas, or contenteditable elements.

### Natural Volume Control

Web players (Plex, YouTube, and most sites) wire their volume slider linearly to `HTMLMediaElement.volume`. Human hearing is logarithmic, so a linear slider feels overwhelmingly loud at the top and nearly silent for most of its travel. This script replaces the curve with a dB-linear mapping so equal slider movements produce equal-sounding loudness changes — the same fix Discord applies to its own volume sliders.

Design notes and references: [`designs/natural-volume-control.md`](designs/natural-volume-control.md).

### Tampermonkey menu

When installed as a userscript, the Tampermonkey menu shows toggles relevant to the current site. Changing a toggle prompts to reload the page so the change takes effect. Settings persist across sessions.


## Sites

### Plex

This script predates [Plex's own playback-speed support, announced on May 15 2024](https://forums.plex.tv/t/video-playback-speed-controls/877681), and still offers a few things Plex's native controls don't.

#### Feature comparison with native Plex clients support

|                                             |                                                                                     This Script                                                                                     |                       Native Plex                        |
| ------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------: | :------------------------------------------------------: |
| More speed options to choose from           | ✅ <br> (cycle through with `,.<>` keys: 0.5, 0.8, 1, 1.2, 1.4, 1.6, 1.8, 2, 2.5, 3, 3, 5, 4, 5, 6, 7, 8, 9, 10, 15, 20 <br> hot key with number keys: 1, 1.5, 2, 3, 4, 5, 7, 8, 10) | ❌ <br> (0.5x, 0.75x, Normal, 1.25x, 1.5x, 1.75x, and 2x) |
| Keyboard shortcuts                          |                                        ✅ <br> (cycle through with `,.<>` keys or hot key with number keys, on top of mouse clicking buttons)                                        |               ❌ <br> (mouse clicking only)               |
| Does not require plex-pass                  |                                                                                          ✅                                                                                          |                            ❌                             |
| Support browser clients (incl. iOS devices) |                                                                                          ✅                                                                                          |                            ✅                             |
| Support non-browser clients                 |                                                                                          ❌                                                                                          |                            ✅                             |
| Perceptual (dB-linear) volume slider        |                                                                                          ✅                                                                                          |                            ❌                             |
| Auto-skip "Play Next" countdown             |                                                                                          ✅                                                                                          |                            ❌                             |

#### Skip Auto-Play countdown

When Plex shows the auto-play countdown at the end of an episode, the script auto-clicks "Play Next" if Plex's own auto-play checkbox is on. Toggle from the Tampermonkey menu: "Skip Auto Play Countdown: Enabled / Disabled".

### YouTube

YouTube applies per-video loudness normalization that caps `video.volume` below 1.0 for loud content. The Natural Volume curve detects this cap (via `loudnessDb` from YouTube's player API) and anchors its endpoints to the cap, so the slider still reaches "as loud as YouTube will allow" without double-attenuating.

Playback speed on YouTube uses the same keyboard bindings as Plex; on-screen buttons are not injected on YouTube to avoid clashing with YouTube's own speed UI.

### Any other site

Natural Volume Control can be enabled on any other site from the Tampermonkey menu — look for `Natural Volume (<origin>)`. The setting is stored per-origin, so enabling it on one site does not affect another. A warning is shown the first time you enable it on a site that hasn't been tested; if you hit any audio issues, disable it from the same menu.

Playback-speed shortcuts are not active on generic sites.


## Runtime modes

The script runs in two modes:

- **Userscript** (Tampermonkey / Userscripts extension) — full feature set on all supported sites, settings persisted, menu toggles available.
- **Static script** (injected into Plex `index.html`) — Plex features only, with defaults hardcoded (no settings UI). If a userscript instance is running on the same page, the static instance steps aside automatically.


## How to install

### Automated Install and Update in Plex Server

This is the best option if you load the Plex web client off your Plex server from many different devices & browser profiles. It runs the script in **static-script mode** — Plex features only, no settings UI. Use a userscript install alongside it if you also want YouTube support or per-feature toggles.

The following steps assume the Plex server is deployed with the `linuxserver/plex` docker image. Installation for other deployment options should be similar.

Install and update may be automated as follows:

1. Create a bash script on the server host. For docker deployment, this script will be mounted into plex container as a startup script.

```bash
# inject_PlaybackSpeedControl.sh
cd /usr/lib/plexmediaserver/Resources/Plug-ins-*/WebClient.bundle/Contents/Resources
wget -O "js/PlaybackSpeedControl.js" "https://raw.githubusercontent.com/ZigZagT/Web-Player-Playback-Speed-Control/master/PlaybackSpeedControl.user.js"
sed -i 's#</head>#<script src="/web/js/PlaybackSpeedControl.js"></script></head>#' index.html
```

2. Add execution permission to `inject_PlaybackSpeedControl.sh`.

```bash
chmod a+x inject_PlaybackSpeedControl.sh
```

3. Mount `inject_PlaybackSpeedControl.sh` script into container as start up script:

```yaml
# docker-compose.yaml
services:
  plex:
    image: linuxserver/plex
    tmpfs:
      - /tmp
    volumes:
      # ... other volumes ...
      - /path/to/inject_PlaybackSpeedControl.sh:/etc/cont-init.d/99-inject_PlaybackSpeedControl.sh
    devices:
      - /dev/dri:/dev/dri
    restart: always
```

This method keeps the scripts up-to-date whenever the plex server restarts.


### Manual Install in Plex Server

The automated script mentioned above essentially performs the following tasks:

1. Locate the WebClient directory in your Plex Server installation. This path varies depends on the server setup. Taking the [plex server docker image provided by linuxserver.io](https://docs.linuxserver.io/images/docker-plex) as example, with image `linuxserver/plex:1.40.0` the WebClient bundle is located at `/usr/lib/plexmediaserver/Resources/Plug-ins-c29d4c0c8/WebClient.bundle/Contents/Resources`.
2. Save the `PlaybackSpeedControl.user.js` file into the `js` folder.
3. Rename the downloaded file, and remove `.user` part from the file extension. Otherwise some browser user script extensions may mistakenly hijack the script request.
4. Edit `index.html` file, add a script tag that points to the script file. The path shuold be prefixed with `/web`. For example, if script file is stored at `js/PlaybackSpeedControl.js`, the `<script>` tag should be `<script src="/web/js/PlaybackSpeedControl.js"></script>`

The script will not update automatically with this installation.


### Install as userscript in Desktop Chrome / Firefox

Works for all supported sites (Plex, YouTube, and any site you opt in to Natural Volume on).

1. Install [Tampermonkey](https://chrome.google.com/webstore/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo?hl=en) or any equivalent user script extension in your browser;
2. Open [this link](https://raw.githubusercontent.com/ZigZagT/Web-Player-Playback-Speed-Control/master/PlaybackSpeedControl.user.js) in your browser. The user script extension should automatically prompt for installation.
3. Future script updates may be checked and installed automatically by user script extension.


### Install as userscript in Safari (macOS Desktop or iOS/iPadOS Safari)

Works for all supported sites.

1. Install the [Userscripts](https://itunes.apple.com/us/app/userscripts/id1463298887) Safari extension from App Store.
2. Enable the extension following its instruction. Make sure you have the `Save Location` setting configured.
3. Open [this link](https://raw.githubusercontent.com/ZigZagT/Web-Player-Playback-Speed-Control/master/PlaybackSpeedControl.user.js) in Safari, and save the file to the `Save Location` of your choice.
4. Future script updates may be checked and installed automatically by the Userscripts app.
