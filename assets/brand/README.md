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

The current desktop app uses this SVG for static Orb images and an inline
source-derived version for the empty-state face animation. The canonical file
remains unchanged. Reduced motion preserves the static winking expression.

Android rendering receipts and maintainer tools from the legacy repository are
not present here. No Android build or device verification is claimed by these
assets.

This asset establishes visual identity; it does not establish owner UI approval
or acceptance of future desktop/mobile features.
