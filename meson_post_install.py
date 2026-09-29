#!/usr/bin/python3

import os
import subprocess
import sys

prefix = os.environ['MESON_INSTALL_DESTDIR_PREFIX']
schemadir = os.path.join(prefix, 'share', 'glib-2.0', 'schemas')

extension_uuid = sys.argv[1]
extension_name = sys.argv[2]


if (extension_uuid != 'ding-with-widgets@yanjing_chen.qq.com') or (extension_name != 'DING with Widgets'):
    metadata_path = os.path.join(prefix, 'share/gnome-shell/extensions', extension_uuid, 'metadata.json')
    with open(metadata_path, "r") as metadata_file:
        metadata_contents = metadata_file.read()
    metadata_contents = metadata_contents.replace('"ding-with-widgets@yanjing_chen.qq.com"', f'"{extension_uuid}"')
    metadata_contents = metadata_contents.replace('"DING with Widgets"', f'"{extension_name}"')
    with open(metadata_path, "w") as metadata_file:
        metadata_file.write(metadata_contents)

# Packaging tools define DESTDIR and this isn't needed for them
if 'DESTDIR' not in os.environ:
    print('Compiling GSettings schemas...')
    subprocess.check_call(['glib-compile-schemas', '--strict', schemadir])
    if prefix.startswith('/usr'):
        print('Reloading apparmor rules...')
        subprocess.call(['systemctl', 'reload', 'apparmor'])
