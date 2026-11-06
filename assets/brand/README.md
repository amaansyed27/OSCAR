# OSCAR brand assets

[oscar-orb.svg](oscar-orb.svg) is the canonical OSCAR Orb source and represents
OSCAR's actual intended appearance. The owner-provided SVG is preserved unchanged,
including its blue shell, offset yellow face, red eye and curved wink.

Use this SVG wherever a scalable Orb is appropriate. Future interfaces and visual
variants must use or derive from this source rather than independently recreating
the Orb. Derived versions must not silently change its core visual identity.
General interface color tokens do not override the colors in this artwork.

The existing `oscar-logo.png`, `favicon.ico`, `favicon-16x16.png`,
`favicon-32x32.png`, `apple-touch-icon.png`, `android-chrome-192x192.png` and
`android-chrome-512x512.png` remain available for raster-only compatibility,
platform icons, thumbnails and previews. These legacy files predate this SVG;
they are not asserted to be newly exported or pixel-identical derivatives.
Future raster exports should derive from the canonical SVG.

OSCAR Mobile's native `oscar_orb.png` is a deterministic Chromium 2x render of this
unchanged SVG, including its filter/shadow. [Render receipt](../../mobile/orb-render.json)
binds source and output digests; [the maintainer tool](../../scripts/render_mobile_orb.py)
regenerates it. The APK packages the original SVG too. This is a format conversion,
not new branding, geometry or an accepted expressive-avatar implementation.

This asset establishes visual identity; it does not establish implemented UI,
Android behavior, manual acceptance or any Gate B completion claim.
