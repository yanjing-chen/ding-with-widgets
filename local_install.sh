#!/bin/bash

rm -rf ~/.local/share/gnome-shell/extensions/ding-with-widgets@yanjing_chen.qq.com/*
rm -rf .build
mkdir .build
meson setup --prefix=$HOME/.local/ --localedir=share/gnome-shell/extensions/ding-with-widgets@yanjing_chen.qq.com/locale .build
ninja -C .build install
rm -rf .build
