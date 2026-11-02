# WorkProof Blender extension

Structure checkpoints additionally commit to object parenting, world transforms,
data identity, and modifier identities/order/type/visibility. Only the
domain-separated `workproof-blender-structure-v1-sha256` digest is transmitted;
the structure, pointer identities and coordinates stay in transient main-thread
memory. The Rust event chain and final artifact hashing still use BLAKE3.
Pointers identify state within one running session, not persistent identities.
This detects same-count edits and same-type modifier reordering but does not
reconstruct a full graph, capture arbitrary modifier parameters, or fingerprint
same-count mesh coordinate changes. Limits are 50000 objects, 200000 modifiers
and 16 MiB serialized structure; exceeding them pauses recording. These are
input limits, not an operating-system memory sandbox. Idle viewport polling
does not traverse this structure. Real Blender/collector Actions acceptance is
required for each implementation revision.

This Blender extension distribution is provided under the GNU General Public
License, version 3 or (at your option) any later version. See `COPYING` for the
full terms. You may use it commercially, modify it, and redistribute it under
those terms; recipients retain the rights the GPL grants them.

Copyright (c) 2026 WorkProof contributors.

The original WorkProof source is also available under the MIT permission grant
in `MIT-LICENSE.txt`; that grant and its copyright notice are preserved. The
Blender extension package selects GPL-3.0-or-later as stated in its manifest.
Do not use the MIT alternative to claim that a distributed Blender API add-on
has been cleared for proprietary distribution.

This archive includes the complete editable Python source and its manifest.
It includes no Blender binaries, Office.js, WPS SDK, third-party Python packages,
or local credentials. It communicates with the separately installed WorkProof
collector using a documented local HTTP API. Licenses for the collector and
other product components must be evaluated separately.

Install using Blender's extension installation from disk (Blender 4.2 or later).
Open View3D > Sidebar > WorkProof and explicitly start recording a saved project.
The extension collects aggregate mesh statistics, undo/redo, saves and sampling
gaps. Visible viewport rotation, pan, zoom and perspective are sampled once per
second on the main thread. Only a cumulative count of changed sampling intervals
is exported, never rotations, positions, camera settings or pixels. Changes during
pause, new viewports and closed viewports do not increment this count. Multiple
movements within an interval may be missed or combined; the count is not an exact
number of gestures or evidence of human authorship. Full modifier parameters are
not collected. Export
saves the current `.blend` and creates a `.blend.wproof` alongside it.

A valid signature establishes integrity and file binding, not human identity,
trusted time or the absence of AI. This package has not been submitted to, or
approved by, the Blender Extensions platform. Platform publication has further
requirements beyond the license manifest.

Sources:
- https://github.com/W-Boat/WorkProof/tree/codex/workproof-mvp/apps/blender/workproof
- https://www.blender.org/about/license/
- https://extensions.blender.org/terms-of-service/
- GPLv3 text: https://www.gnu.org/licenses/gpl-3.0.txt
