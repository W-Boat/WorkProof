"""Collect installed distribution notices without granting commercial clearance.

No downloads, package imports, model execution, or absolute paths in the manifest.
"""
import argparse
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import sysconfig

MAX_FILE = 4 * 1024 * 1024
MAX_TOTAL = 64 * 1024 * 1024
MAX_CANDIDATES = 10000


def roots():
    return tuple(dict.fromkeys(Path(sysconfig.get_path(key)).resolve() for key in ('purelib', 'platlib')))


def notice_name(relative):
    parts = relative.parts
    name = relative.name.upper()
    named = bool(re.match(r'^(LICENSE|LICENCE|NOTICE|COPYING|COPYRIGHT)(?:$|[.\-_])', name))
    return named or any(part.endswith('.dist-info') and i + 1 < len(parts) and parts[i + 1].lower() == 'licenses' for i, part in enumerate(parts))


def safe_source(base, relative):
    # RECORD paths can legitimately refer outside site-packages: never collect those.
    if relative.is_absolute() or any(part in ('', '.', '..') for part in relative.parts) or '\\' in str(relative):
        raise ValueError('OUTSIDE_DISTRIBUTION_ROOT')
    path = base.joinpath(*relative.parts)
    cursor = base
    for part in relative.parts:
        cursor = cursor / part
        if cursor.is_symlink():
            raise ValueError('SYMLINK_REJECTED')
    resolved = path.resolve(strict=True)
    if not resolved.is_relative_to(base) or not resolved.is_file():
        raise ValueError('OUTSIDE_DISTRIBUTION_ROOT')
    return path


def collect(destination):
    destination = destination.absolute()
    allowed = roots()
    if any(destination.resolve().is_relative_to(base) for base in allowed):
        raise ValueError('OUTPUT_MUST_BE_OUTSIDE_SITE_PACKAGES')
    destination.mkdir(parents=False, exist_ok=False)
    packages = []
    total = 0
    seen = set()
    candidates = 0
    # Inspect metadata only: distribution entry points are never imported.
    for base in allowed:
        for distribution in importlib.metadata.distributions(path=[str(base)]):
            name = distribution.metadata.get('Name', 'UNKNOWN')
            version = distribution.version
            identity = (name, version, str(distribution.locate_file('')))
            if identity in seen:
                continue
            seen.add(identity)
            item = {'name': name, 'version': version, 'files': [], 'issues': []}
            packages.append(item)
            records = distribution.files
            if records is None:
                item['issues'].append({'reason': 'DISTRIBUTION_FILE_LIST_MISSING'})
                continue
            matched = False
            for record in records:
                relative = PurePosixPath(str(record))
                if not notice_name(relative):
                    continue
                matched = True
                candidates += 1
                # Reject rather than silently claiming collection is complete.
                if candidates > MAX_CANDIDATES:
                    raise ValueError('NOTICE_CANDIDATE_LIMIT')
                invalid_path = relative.is_absolute() or '..' in relative.parts or '\\' in str(relative) or ':' in str(relative)
                entry = {'source': '[rejected path]' if invalid_path else str(relative)}
                try:
                    if invalid_path:
                        raise ValueError('OUTSIDE_DISTRIBUTION_ROOT')
                    source = safe_source(base, relative)
                    size = source.stat().st_size
                    if size > MAX_FILE:
                        raise ValueError('FILE_SIZE_LIMIT')
                    if total + size > MAX_TOTAL:
                        raise ValueError('TOTAL_SIZE_LIMIT')
                    # O_NOFOLLOW closes the final-component symlink race on platforms supporting it.
                    descriptor = os.open(source, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0))
                    with os.fdopen(descriptor, 'rb') as stream:
                        if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode):
                            raise ValueError('NOT_A_REGULAR_FILE')
                        data = stream.read(MAX_FILE + 1)
                    if len(data) != size or len(data) > MAX_FILE:
                        raise ValueError('SOURCE_CHANGED_OR_SIZE_LIMIT')
                    digest = hashlib.sha256(data).hexdigest()
                    archive = f'files/{len(packages):05d}/{len(item["files"]):05d}.txt'
                    output = destination / archive
                    output.parent.mkdir(parents=True, exist_ok=True)
                    with output.open('xb') as stream:
                        stream.write(data)
                    total += len(data)
                    item['files'].append(dict(entry, archive=archive, bytes=len(data), sha256=digest))
                except (OSError, ValueError) as error:
                    reason = str(error) if isinstance(error, ValueError) else 'SOURCE_UNREADABLE'
                    item['issues'].append(dict(entry, reason=reason))
            if not matched:
                item['issues'].append({'reason': 'NO_NOTICE_FILES_IN_DISTRIBUTION_RECORD'})
    manifest = {'schema': 'workproof-python-notices/1', 'commercial_clearance': False,
                'scope': 'Installed distribution RECORD notice files within current interpreter site-packages only',
                'limits': {'fileBytes': MAX_FILE, 'totalBytes': MAX_TOTAL, 'candidates': MAX_CANDIDATES},
                'bytes': total, 'packages': packages,
                'limitations': ['Metadata is not a complete binary component inventory.',
                                'No model weights, training data rights or model lineage are verified.',
                                'Missing notices require review; metadata license tags are not substituted.']}
    with (destination / 'manifest.json').open('x', encoding='utf-8') as stream:
        json.dump(manifest, stream, indent=2, ensure_ascii=False)
    return len(packages), sum(len(package['files']) for package in packages)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    try:
        packages, files = collect(args.output)
    except (OSError, ValueError):
        # Do not disclose installation paths. Partial directories are preserved for review.
        print('Notice collection did not finish; review the output directory and choose a new empty destination.')
        return 1
    print(f'Collected {files} notice files across {packages} distributions; commercial clearance remains unverified.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
