"""Check the actual Office ZIP against its complete SHA256 manifest, including hidden files."""
import hashlib
import pathlib
import sys
import zipfile

def verify(archive):
    with zipfile.ZipFile(archive) as package:
        entries = [entry for entry in package.infolist() if not entry.is_dir()]
        names = [entry.filename for entry in entries]
        if len(names) != len(set(names)):
            raise ValueError('Duplicate archive member')
        for name in names:
            path = pathlib.PurePosixPath(name)
            if path.is_absolute() or '..' in path.parts or chr(92) in name or (path.parts and ':' in path.parts[0]):
                raise ValueError('Unsafe archive member: ' + name)
        manifest = package.read('SHA256SUMS.txt').decode('utf-8-sig')
        expected = {}
        for line in manifest.splitlines():
            if not line.strip():
                continue
            digest, name = line.split('  ', 1)
            if name in expected or len(digest) != 64 or any(c not in '0123456789abcdef' for c in digest):
                raise ValueError('Invalid manifest entry: ' + name)
            expected[name] = digest
        if set(names) != set(expected) | {'SHA256SUMS.txt'}:
            raise ValueError('Archive/manifest file set mismatch: ' + str(sorted(set(names) ^ (set(expected) | {'SHA256SUMS.txt'}))))
        for name, digest in expected.items():
            with package.open(name) as stream:
                actual = hashlib.file_digest(stream, 'sha256').hexdigest()
            if actual != digest:
                raise ValueError('Archive content mismatch: ' + name)
        print('Verified actual ZIP and all', len(expected), 'manifest file hashes:', archive)

if __name__ == '__main__':
    verify(sys.argv[1])
