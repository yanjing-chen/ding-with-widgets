prefix = get_option('prefix')
extension_uuid = get_option('extension_uuid')

if prefix.startswith('/usr')
    apparmor_file = configure_file(input: 'desktop-icons-ng.in',
                                   output: extension_uuid,
                                   configuration: {'PREFIX': prefix, 'EXTENSIONUUID': extension_uuid },
                                   install: true,
                                   install_dir: '/etc/apparmor.d')
endif