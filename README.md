# Plex Web Player Playback Speed Control and Keyboard Shortcuts

[Github][4]

[Greasy Fork][5]

## Install in Plex Server (Manual)
1. Locate the WebClient directory in your Plex Server installation. This path varies depends on the server setup. Taking the [plex server docker image provided by linuxserver.io][6] as example, with image `linuxserver/plex:1.40.0` the WebClient bundle is located at `/usr/lib/plexmediaserver/Resources/Plug-ins-c29d4c0c8/WebClient.bundle/Contents/Resources`.
2. Save the `Plex Playback Speed.user.js` file into the `js` folder.
3. Rename the downloaded file, remove `.user` part from the file extension. Otherwise user script extensions in users browser may mistakenly hijack the script request.
4. Edit `index.html` file, add a script tag that points to the downloaded script file. The path shuold be prefixed with `/web`. For example, if script file is stored at `js/PlexPlaybackSpeed.js`, the `<script>` tag should be `<script src="/web/js/PlexPlaybackSpeed.js"></script>`

The script will not update automatically with this installation.

## Automated Install and Update in Plex Server (with `linuxserver/plex` docker deployment)
Install and update may be automated as follows:
1. Create a script on the docker host:
```bash
# inject_Plex_Playback_Speed_controls.sh
cd /usr/lib/plexmediaserver/Resources/Plug-ins-*/WebClient.bundle/Contents/Resources
wget -O "js/PlexPlaybackSpeed.js" "https://gist.githubusercontent.com/ZigZagT/b992bda82b5f7a2c9d214110273d3f3c/raw/Plex%2520Playback%2520Speed.user.js"
sed -i 's#</head>#<script src="/web/js/PlexPlaybackSpeed.js"></script></head>#' index.html
```
2. Add execution permission to `inject_Plex_Playback_Speed_controls.sh`.
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

The latest script will be installed whenever the container restarts.

## Install in Desktop Chrome / Firefox
1. Install [Tampermonkey][2] or any equivalent user script extension in your browser;
2. Open [this link][1] in your browser. The user script extension should automatically prompt for installation.
3. Future script updates may be checked and installed automatically by user script extension.


## Install in Safari (macOS Desktop or iOS/iPadOS Safari)
1. Install the [Userscripts][3] Safari extension from App Store.
2. Enable the extension following its instruction. Make sure you have the `Save Location` setting configured.
3. Open [this link][1] in Safari, and save the file to the `Save Location` of your choice.
4. Future script updates may be checked and installed automatically by the Userscripts app.

## Usage

1. Use the turtle and rabbit icons in the control strip to slowdown / speedup

<img width="398" alt="Screen Shot 2022-09-19 at 9 24 10 PM" src="https://user-images.githubusercontent.com/7879714/191167267-9430ec1f-2815-49cf-8904-b5aa73809ef9.png">

2. Use `<` or `>` keys on the keyboard to decrease / increase speeds.

3. Use number keys (1-9) to quickly set a preset speeds.

## Troubleshoot

### Web player is laggy, sometime stuck

Try disable the `Direct Play` option and leave `Direct Stream` enabled in the `Plex Web - Debug` settings.

<img width="228" alt="image" src="https://user-images.githubusercontent.com/7879714/191168287-d1b7a12a-6aa2-4d49-afba-8cf32271f670.png">

[1]: https://gist.githubusercontent.com/ZigZagT/b992bda82b5f7a2c9d214110273d3f3c/raw/Plex%2520Playback%2520Speed.user.js
[2]: https://chrome.google.com/webstore/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo?hl=en
[3]: https://itunes.apple.com/us/app/userscripts/id1463298887
[4]: https://gist.github.com/ZigZagT/b992bda82b5f7a2c9d214110273d3f3c
[5]: https://greasyfork.org/en/scripts/451667-plex-playback-speed
[6]: https://docs.linuxserver.io/images/docker-plex
