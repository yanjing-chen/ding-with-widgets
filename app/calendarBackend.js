#!/usr/bin/env -S gjs -m

/* DING with Widgets: Evolution Data Server calendar writer
 * SPDX-License-Identifier: GPL-3.0-only
 */
'use strict';

import ECal from 'gi://ECal?version=2.0';
import EDataServer from 'gi://EDataServer?version=1.2';
import ICalGLib from 'gi://ICalGLib?version=3.0';

function reply(value) {
    print(JSON.stringify(value));
}

function main() {
    const event = JSON.parse(ARGV[0] ?? '{}');
    const title = typeof event.title === 'string' ? event.title.trim() : '';
    const start = Math.trunc(Number(event.start) || 0);
    const end = Math.trunc(Number(event.end) || 0);
    if (!title || start <= 0 || end <= start)
        throw new Error('日程标题或时间无效');

    const registry = EDataServer.SourceRegistry.new_sync(null);
    const source = registry.ref_default_calendar() ?? registry.ref_builtin_calendar();
    if (!source)
        throw new Error('没有可写入的默认系统日历');

    const client = ECal.Client.connect_sync(
        source,
        ECal.ClientSourceType.EVENTS,
        2,
        null
    );
    if (!client)
        throw new Error('无法连接 Evolution Data Server');

    const utc = ICalGLib.Timezone.get_utc_timezone();
    const startTime = ICalGLib.Time.new_from_timet_with_zone(start, false, utc);
    const endTime = ICalGLib.Time.new_from_timet_with_zone(end, false, utc);
    const component = ICalGLib.Component.new_vevent();
    component.set_summary(title);
    component.set_dtstart(startTime);
    component.set_dtend(endTime);
    if (typeof event.location === 'string' && event.location.trim())
        component.set_location(event.location.trim());

    const result = client.create_object_sync(
        component,
        ECal.OperationFlags?.NONE ?? 0,
        null
    );
    let uid = '';
    let successful = true;
    if (Array.isArray(result)) {
        successful = result[0] !== false;
        uid = typeof result[1] === 'string' ? result[1] : '';
    } else if (typeof result === 'string') {
        uid = result;
    } else if (result === false) {
        successful = false;
    }
    if (!successful)
        throw new Error('系统日历没有接受该日程');
    reply({ok: true, uid});
}

try {
    main();
    // ECal/ICalGLib objects can be finalized in an unsafe order while the GJS
    // runtime is shutting down. Exit immediately after printing the result so
    // a successful write is not followed by a teardown-time SIGSEGV.
    imports.system.exit(0);
} catch (error) {
    reply({ok: false, error: error.message});
    imports.system.exit(1);
}
