#!/bin/sh

DING_WIDGETS=0
if [ -d ~/.local/share/gnome-shell/extensions/ding-with-widgets@yanjing_chen.qq.com ]; then
        DING_WIDGETS=1
fi

if [ ${DING_WIDGETS} = "1" ]; then
        ./install-local-test.sh
fi
./kill.py
