project('ding',
  version: '50',
  license: 'GPL3',
  meson_version: '>=1.1'
)

gnome = import ('gnome')
i18n = import('i18n')

prefix = get_option('prefix')
datadir = join_paths (prefix, get_option('datadir'))
schema_dir = join_paths(datadir, 'glib-2.0', 'schemas')

extension_uuid = get_option('extension_uuid')
extension_name = get_option('extension_name')

extension_root_dir = join_paths(prefix, 'share', 'gnome-shell', 'extensions', extension_uuid)

install_data([
    'emulateX11WindowType.js',
    'extension.js',
    'metadata.json',
    'prefs.js',
    'visibleArea.js'
  ],
  install_dir: extension_root_dir
)

subdir(
  'app'
)
install_subdir(
  'widgets',
  install_dir: join_paths(extension_root_dir, 'app')
)
subdir(
  'po'
)
subdir(
  'schemas'
)
subdir(
  'apparmor'
)

meson.add_install_script('meson_post_install.py', extension_uuid, extension_name)
