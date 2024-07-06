# Plex Web Player Playback Speed Control and Keyboard Shortcuts

[Github](https://gist.github.com/ZigZagT/b992bda82b5f7a2c9d214110273d3f3c)

[Greasy Fork](https://greasyfork.org/en/scripts/451667-plex-playback-speed)


## How is this different from native Plex clients?

This script was created way before [plex announced support for playback speed controls on May 15 2024](https://forums.plex.tv/t/video-playback-speed-controls/877681). Besides, this script supports a few neat features that may make your life a little bit easier. Keep reading :)


### Feature comparison with native Plex clients support

|                                             |                                                                                     This Script                                                                                     |                       Native Plex                        |
| ------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------: | :------------------------------------------------------: |
| More speed options to choose from           | ✅ <br> (cycle through with `,.<>` keys: 0.5, 0.8, 1, 1.2, 1.4, 1.6, 1.8, 2, 2.5, 3, 3, 5, 4, 5, 6, 7, 8, 9, 10, 15, 20 <br> hot key with number keys: 1, 1.5, 2, 3, 4, 5, 7, 8, 10) | ❌ <br> (0.5x, 0.75x, Normal, 1.25x, 1.5x, 1.75x, and 2x) |
| Keyboard shortcuts                          |                                        ✅ <br> (cycle through with `,.<>` keys or hot key with number keys, on top of mouse clicking buttons)                                        |               ❌ <br> (mouse clicking only)               |
| Does not require plex-pass                  |                                                                                          ✅                                                                                          |                            ❌                             |
| Support browser clients (incl. iOS devices) |                                                                                          ✅                                                                                          |                            ✅                             |
| Support non-browser clients                 |                                                                                          ❌                                                                                          |                            ✅                             |


## How to use

There're multiple ways to alter the playback speeds:

1. Use the turtle and rabbit icons in the control strip to slowdown / speedup

<img width="398" alt="Screen Shot 2022-09-19 at 9 24 10 PM" src="https://user-images.githubusercontent.com/7879714/191167267-9430ec1f-2815-49cf-8904-b5aa73809ef9.png">

2. Use `<` or `>` or `,` or `.` keys on the keyboard to decrease / increase speeds. This control cycles through the following speeds:
    - 0.5, 0.8, 1, 1.2, 1.4, 1.6, 1.8, 2, 2.5, 3, 3, 5, 4, 5, 6, 7, 8, 9, 10, 15, 20

3. Use number keys (1-9) to quickly set a speed. This control maps the numbers with speeds as follows:

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


## How to install

### Automated Install and Update in Plex Server

This is the best option if you load the plex web client off your plex server from many different devices & browser profiles.

The following steps assumes the plex server is deployed with `linuxserver/plex` docker image. Installation for other deployment options should be similar.

Install and update may be automated as follows:

1. Create a bash script on the server host. For docker deployment, this script will be mounted into plex container as a startup script.

```bash
# inject_Plex_Playback_Speed_controls.sh
cd /usr/lib/plexmediaserver/Resources/Plug-ins-*/WebClient.bundle/Contents/Resources
wget -O "js/PlexPlaybackSpeed.js" "https://gist.githubusercontent.com/ZigZagT/b992bda82b5f7a2c9d214110273d3f3c/raw/Plex%2520Playback%2520Speed.user.js"
sed -i 's#</head>#<script src="/web/js/PlexPlaybackSpeed.js"></script></head>#' index.html
```

2. Add execution permission to `inject_Plex_Playback_Speed_controls.sh`.

```bash
chmod a+x inject_Plex_Playback_Speed_controls.sh
```

3. Mount `inject_Plex_Playback_Speed_controls.sh` script into container as start up script:

```yaml
# docker-compose.yaml
services:
  plex:
    image: linuxserver/plex
    tmpfs:
      - /tmp
    volumes:
      # ... other volumes ...
      - /path/to/inject_Plex_Playback_Speed_controls.sh:/etc/cont-init.d/99-inject_Plex_Playback_Speed_controls.sh
    devices:
      - /dev/dri:/dev/dri
    restart: always
```

This method keeps the scripts up-to-date whenever the plex server restarts.


## Manual Install in Plex Server

The automated script mentioned above essentially performs the following tasks:

1. Locate the WebClient directory in your Plex Server installation. This path varies depends on the server setup. Taking the [plex server docker image provided by linuxserver.io](https://docs.linuxserver.io/images/docker-plex) as example, with image `linuxserver/plex:1.40.0` the WebClient bundle is located at `/usr/lib/plexmediaserver/Resources/Plug-ins-c29d4c0c8/WebClient.bundle/Contents/Resources`.
2. Save the `Plex Playback Speed.user.js` file into the `js` folder.
3. Rename the downloaded file, and remove `.user` part from the file extension. Otherwise some browser user script extensions may mistakenly hijack the script request.
4. Edit `index.html` file, add a script tag that points to the script file. The path shuold be prefixed with `/web`. For example, if script file is stored at `js/PlexPlaybackSpeed.js`, the `<script>` tag should be `<script src="/web/js/PlexPlaybackSpeed.js"></script>`

The script will not update automatically with this installation.

## Install as userscript in Desktop Chrome / Firefox
1. Install [Tampermonkey](https://chrome.google.com/webstore/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo?hl=en) or any equivalent user script extension in your browser;
2. Open [this link](https://gist.githubusercontent.com/ZigZagT/b992bda82b5f7a2c9d214110273d3f3c/raw/Plex%2520Playback%2520Speed.user.js) in your browser. The user script extension should automatically prompt for installation.
3. Future script updates may be checked and installed automatically by user script extension.


## Install as userscript in Safari (macOS Desktop or iOS/iPadOS Safari)
1. Install the [Userscripts](https://itunes.apple.com/us/app/userscripts/id1463298887) Safari extension from App Store.
2. Enable the extension following its instruction. Make sure you have the `Save Location` setting configured.
3. Open [this link](https://gist.githubusercontent.com/ZigZagT/b992bda82b5f7a2c9d214110273d3f3c/raw/Plex%2520Playback%2520Speed.user.js) in Safari, and save the file to the `Save Location` of your choice.
4. Future script updates may be checked and installed automatically by the Userscripts app.

## Troubleshoot

### Web player is laggy, sometime stuck

Try disable the `Direct Play` option and leave `Direct Stream` enabled in the `Plex Web - Debug` settings.

<img width="228" alt="image" src="https://user-images.githubusercontent.com/7879714/191168287-d1b7a12a-6aa2-4d49-afba-8cf32271f670.png">

