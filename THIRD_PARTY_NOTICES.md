# Third-Party Notices

This file records the principal upstream code, references, and network data services used by **DING with Widgets**. It supplements, and does not replace, the copyright notices already present in individual files and Git history.

## Desktop Icons NG (DING)

- Project: <https://gitlab.com/rastersoft/desktop-icons-ng>
- Principal author: Sergio Costas (Rastersoft)
- Earlier code: Carlos Soriano
- License: GNU General Public License version 3 only

DING with Widgets is a modified derivative of DING. The original copyright notices, source history, and GPL license are retained. The full GPL text is included in `COPYING`.

## GTK4 Desktop Icons NG (DING)

- Project: <https://gitlab.com/smedius/desktop-icons-ng>
- Maintainer: smedius and contributors
- License: GNU General Public License version 3

The GTK4 DING project was studied as an architectural and interaction reference for integrating HTML-based desktop widgets. DING with Widgets uses its own bundled Widget implementation and visual design.

## Canonical packaging contributions

The inherited `debian/` packaging files contain contributions copyright Canonical Ltd., as recorded in `debian/copyright`, and are distributed under GPL-3.

## chinese-calendar

- Project: <https://github.com/tigertall/chinese-calendar>
- Copyright: Copyright (c) 2026 tiger
- License: MIT
- Data endpoint used: <https://tigertall.github.io/chinese-calendar/data/holidays_cn.json>

The calendar Widget downloads and locally caches the project's public mainland-China holiday data. Lunar-date and solar-term presentation in this project is implemented locally with JavaScript internationalization and local calculations.

## Open-Meteo

- Service: <https://open-meteo.com/>
- Terms: <https://open-meteo.com/en/terms>
- APIs used: Forecast API and Geocoding API

The weather Widget uses Open-Meteo for forecasts and city lookup. The world-clock Widget uses the Geocoding API to resolve a city to its IANA time zone. Open-Meteo attribution remains visible in the weather Widget. Open-Meteo's data license and API-use conditions are governed by its own current terms.

Open-Meteo's geocoding documentation identifies GeoNames as the source of location data. Attribution to Open-Meteo and GeoNames is shown in the weather and world-clock Widgets.

## Trademarks and visual references

The phrase “inspired by the visual style of macOS” describes a general visual direction only. No Apple source code, icons, fonts, screenshots, or other proprietary assets are distributed with this project. Mac and macOS are trademarks of Apple Inc. This project is not affiliated with or endorsed by Apple, GNOME, Canonical, Open-Meteo, or any upstream project listed above.
