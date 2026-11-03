"""Strict V4 provenance; successful V3 receipt bytes are an explicit dependency."""
import json
import os
import re
import stat
import catalog_receipt

FORMAT = 'workproof-jobs-preparation/1'
PREPARED = 'jobs.json'
PENDING = '.jobs-preparing.json'
SPOOL = '/var/lib/workproof/jobs'
FIELDS = catalog_receipt.FIELDS | {'catalogReceiptSha256','spoolPath'}


def validate(data, pending=False):
    def invalid(value):
        raise ValueError('Invalid jobs JSON')
    value = json.loads(data,object_pairs_hook=catalog_receipt._unique,parse_constant=invalid)
    if type(value) is not dict or set(value) != FIELDS or value['format'] != FORMAT or value['spoolPath'] != SPOOL:
        raise ValueError('Invalid jobs record')
    if not isinstance(value['catalogReceiptSha256'],str) or not re.fullmatch('[0-9a-f]{64}',value['catalogReceiptSha256']):
        raise ValueError('Invalid catalog dependency')
    base = {key:item for key,item in value.items() if key in catalog_receipt.FIELDS}
    base['format'] = catalog_receipt.FORMAT
    catalog_receipt.validate(json.dumps(base),pending)
    return value


def read(path,pending=False):
    fd = os.open(path,os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd,'rb') as source:
        info = os.fstat(source.fileno())
        if (not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_uid != (0 if pending else 10001) or
                info.st_gid != info.st_uid or stat.S_IMODE(info.st_mode) != 0o600 or info.st_size > 16384):
            raise ValueError('Jobs receipt permissions rejected')
        return validate(source.read(16385),pending)
