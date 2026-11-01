# Office package npm license supplements

Collected 2026-11-02 from official npm registry and upstream GitHub repositories. No packages were installed or executed. Scope: the seven exact root `package-lock.json` versions listed in `inventory.json`; not a whole-product clearance.

Every published tarball was downloaded into memory. Its SHA-512 matched both the lockfile integrity and exact-version npm metadata. SHA-256 and registry/tarball URLs are recorded per package. All seven archives lacked files named LICENSE, LICENCE, COPYING or NOTICE. Registry metadata is an SPDX declaration, not a substitute for missing copyright notices.

Five packages have upstream license text supplements linked to their npm gitHead or exact upstream version tag, with immutable commit URLs and SHA-256. These files were retrieved verbatim, not reconstructed. For Tauri both MIT and Apache-2.0 alternatives are retained. Resolving an upstream version tag is evidence of that source license, not cryptographic proof that a binary was built from that commit. npm signature/provenance attestations were not independently verified.

Two exact-version gaps remain: `client-only@0.0.1` and `react-remove-scroll-bar@2.3.8`. Their metadata declares MIT, but this audit did not establish the exact-version copyright/license text. See the explicit gap in each metadata record. Do not insert a guessed attribution or mark them cleared solely on SPDX metadata.

The supplemented permissive licenses allow commercial use subject to their terms, including applicable license/copyright retention. This directory alone does not establish compliance for bundled native/transitive dependencies, patents, trademarks, redistributed binaries, or all delivered artifacts. Packaging must retain these texts and complete unresolved notices before claiming that every redistributed dependency is covered.
