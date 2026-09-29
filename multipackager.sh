#!/bin/sh

rm -rf _build
meson setup _build --prefix=/usr -Dextension_uuid=ding-with-widgets@yanjing_chen.qq.com -Dextension_name="DING with Widgets"
ninja -C _build
DESTDIR=$1 ninja -C _build install
