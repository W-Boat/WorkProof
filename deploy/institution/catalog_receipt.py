"""Strict V3 preparation provenance shared by startup, backup and restore."""
import json
import os
import re
import stat

FORMAT = 'workproof-catalog-preparation/1'
PREPARED = 'catalog.json'
PENDING = '.catalog-preparing.json'
FIELDS = {'format', 'status', 'sourceCommit', 'imageId', 'migrationSha256',
          'schemaSha256', 'backupSha256', 'startedAt', 'completedAt'}


def _unique(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('Duplicate preparation key')
        result[key] = value
    return result


def validate(data, pending=False):
    def invalid(value):
        raise ValueError('Nonfinite preparation value')
    value = json.loads(data, object_pairs_hook=_unique, parse_constant=invalid)
    if type(value) is not dict or set(value) != FIELDS or value['format'] != FORMAT:
        raise ValueError('Unknown preparation record')
    if value['status'] != ('applying' if pending else 'prepared'):
        raise ValueError('Invalid preparation status')
    for key in ('migrationSha256', 'schemaSha256', 'backupSha256'):
        if not isinstance(value[key], str) or not re.fullmatch('[0-9a-f]{64}', value[key]):
            raise ValueError('Invalid preparation digest')
    if (not isinstance(value['sourceCommit'], str) or not re.fullmatch('[0-9a-f]{40}', value['sourceCommit']) or
            not isinstance(value['imageId'], str) or not re.fullmatch('sha256:[0-9a-f]{64}', value['imageId']) or
            type(value['startedAt']) is not int or value['startedAt'] < 0):
        raise ValueError('Invalid preparation provenance')
    if pending:
        if value['completedAt'] is not None:
            raise ValueError('Pending preparation cannot be completed')
    elif type(value['completedAt']) is not int or value['completedAt'] < value['startedAt']:
        raise ValueError('Invalid completion time')
    return value


def read(path, pending=False):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, 'rb') as source:
        info = os.fstat(source.fileno())
        if (not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_uid != (0 if pending else 10001) or
                info.st_gid != info.st_uid or stat.S_IMODE(info.st_mode) != 0o600 or info.st_size > 16384):
            raise ValueError('Preparation record permissions rejected')
        return validate(source.read(16385), pending)
