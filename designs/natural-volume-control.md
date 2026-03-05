## problem

web apps like plex implemented volume slider as a linear slider. this is wrong.

human perceived volume is non-linear.

related discussions:
- https://github.com/whatwg/html/issues/5501
- https://www.dr-lex.be/info-stuff/volumecontrols.html

reference implementation of a good volume slider mapping:
- https://github.com/discord/perceptual/blob/master/src/index.ts

we add a natual volume controls option on supported sites.
