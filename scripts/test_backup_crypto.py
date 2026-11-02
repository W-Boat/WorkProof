"""Real container crypto acceptance. Run only against the packaged backup_crypto module.
No database is read or restored. Passwords travel through API bytes or child stdin only.
"""
import importlib.util
import os
import pathlib
import secrets
import signal
import stat
import subprocess
import sys
import tempfile
from unittest import mock

MODULE = pathlib.Path('/opt/workproof/backup_crypto.py')
assert os.name == 'posix' and MODULE.is_file(), 'Run inside the packaged Linux server image'
spec = importlib.util.spec_from_file_location('workproof_backup_crypto', MODULE)
crypto = importlib.util.module_from_spec(spec)
spec.loader.exec_module(crypto)


def failure_child():
    import resource
    password = sys.stdin.buffer.readline().rstrip(b'\r\n')
    signal.signal(signal.SIGXFSZ, signal.SIG_IGN)
    resource.setrlimit(resource.RLIMIT_FSIZE, (128 * 1024, 128 * 1024))
    try:
        crypto.decrypt_file(pathlib.Path(sys.argv[2]), pathlib.Path(sys.argv[3]), password)
    except crypto.BackupCryptoError:
        return 88
    return 89


if len(sys.argv) > 1 and sys.argv[1] == '--failure-child':
    sys.exit(failure_child())


def main():
    password = secrets.token_hex(24).encode('ascii')
    with tempfile.TemporaryDirectory(prefix='workproof-crypto-acceptance-') as temporary:
        directory = pathlib.Path(temporary)
        directory.chmod(0o700)
        calls = 0

        def private(file):
            info = file.stat()
            assert stat.S_IMODE(info.st_mode) == 0o600, 'Output was not private'
            assert info.st_uid == os.getuid()

        def no_partial():
            assert not list(directory.glob('.workproof-crypto-*.partial')), 'Temporary plaintext was retained'

        def rejected(operation, source, target, secret=password, **kwargs):
            nonlocal calls
            existed = target.exists()
            was_link = target.is_symlink()
            before = target.read_bytes() if existed and target.is_file() else None
            try:
                operation(source, target, secret, **kwargs)
            except crypto.BackupCryptoError:
                calls += 1
            else:
                raise AssertionError('Unsafe or unauthenticated operation succeeded')
            if existed:
                assert target.read_bytes() == before, 'Existing output changed'
            elif was_link:
                assert target.is_symlink(), 'Existing dangling link changed'
            else:
                assert not target.exists(), 'Failed operation published plaintext'
            no_partial()

        ciphertext = None
        large_source = None
        # Real GCM, including the empty-file tag and multiple streamed chunks.
        for index, data in enumerate([b'', bytes(range(256)) * 17, '中文、换行\n与表情🙂'.encode('utf-8'), os.urandom(3 * 1024 * 1024 + 513)]):
            source = directory / ('source-' + str(index))
            encrypted = directory / ('encrypted-' + str(index))
            restored = directory / ('restored-' + str(index))
            source.write_bytes(data)
            crypto.encrypt_file(source, encrypted, password)
            crypto.decrypt_file(encrypted, restored, password)
            assert restored.read_bytes() == data
            private(encrypted); private(restored); no_partial()
            if index == 3:
                ciphertext, large_source = encrypted, source
        second = directory / 'second-encryption'
        crypto.encrypt_file(large_source, second, password)
        first_bytes, second_bytes = ciphertext.read_bytes(), second.read_bytes()
        assert first_bytes != second_bytes
        # Header bytes 24:40 and 40:52 are the fixed-size salt and nonce.
        assert first_bytes[24:40] != second_bytes[24:40]
        assert first_bytes[40:52] != second_bytes[40:52]
        rejected(crypto.decrypt_file, ciphertext, directory/'wrong-password', secrets.token_hex(24).encode())
        for index, position in enumerate([0, 8, 12, 24, 40, 52, 60, len(first_bytes)//2, len(first_bytes)-1]):
            changed = bytearray(first_bytes); changed[position] ^= 1
            damaged = directory / ('damaged-' + str(index)); damaged.write_bytes(changed)
            rejected(crypto.decrypt_file, damaged, directory/('rejected-' + str(index)))
        for index, length in enumerate([0, 59, 60, 75, len(first_bytes)//2, len(first_bytes)-1]):
            truncated = directory/('truncated-' + str(index)); truncated.write_bytes(first_bytes[:length])
            rejected(crypto.decrypt_file, truncated, directory/('truncated-output-' + str(index)))
        appended=directory/'appended';appended.write_bytes(first_bytes+b'X')
        rejected(crypto.decrypt_file, appended, directory/'appended-output')
        for operation, source in [(crypto.encrypt_file, large_source),(crypto.decrypt_file,ciphertext)]:
            existing = directory / ('existing-' + operation.__name__); existing.write_bytes(b'preserve this output')
            rejected(operation, source, existing)
            link = directory/('output-link-' + operation.__name__); link.symlink_to(existing)
            rejected(operation, source, link)
            dangling=directory/('dangling-' + operation.__name__);dangling.symlink_to(directory/'absent-target')
            rejected(operation, source, dangling)
            source_link=directory/('input-link-' + operation.__name__);source_link.symlink_to(source)
            rejected(operation, source_link, directory/('from-link-' + operation.__name__))
            rejected(operation, directory, directory/('from-directory-' + operation.__name__))
        fifo=directory/'input-fifo';os.mkfifo(fifo)
        parent_link=directory/'parent-link';parent_link.symlink_to(directory,target_is_directory=True)
        wide=directory/'wide-parent';wide.mkdir();wide.chmod(0o755)
        for operation, source in [(crypto.encrypt_file,large_source),(crypto.decrypt_file,ciphertext)]:
            rejected(operation,fifo,directory/('from-fifo-'+operation.__name__))
            rejected(operation,source,parent_link/('from-parent-link-'+operation.__name__))
            rejected(operation,source,wide/('from-wide-parent-'+operation.__name__))
        assert not list(wide.iterdir())
        # An O_EXCL collision must preserve the pre-existing file, even though its name is internal.
        collision=directory/('.workproof-crypto-'+'0'*32+'.partial')
        collision.write_bytes(b'preserve pre-existing temporary');collision.chmod(0o600)
        for operation, source in [(crypto.encrypt_file,large_source),(crypto.decrypt_file,ciphertext)]:
            target=directory/('collision-output-'+operation.__name__)
            with mock.patch.object(crypto.secrets,'token_hex',return_value='0'*32):
                try:operation(source,target,password)
                except crypto.BackupCryptoError:pass
                else:raise AssertionError('Existing temporary collision was accepted')
            assert collision.read_bytes()==b'preserve pre-existing temporary' and not target.exists()
        collision.unlink();no_partial()
        rejected(crypto.encrypt_file, large_source, directory/'limited-input', max_bytes=1024)
        rejected(crypto.decrypt_file, ciphertext, directory/'limited-output', max_bytes=1024)
        # Real kernel file-size limit injects a write failure while actual GCM decryption runs.
        failed_output=directory/'write-failure-output'
        child=subprocess.run([sys.executable,__file__,'--failure-child',str(ciphertext),str(failed_output)],input=password+b'\n',capture_output=True,timeout=90)
        assert child.returncode==88, 'Kernel write failure did not produce a controlled crypto refusal'
        assert not failed_output.exists();no_partial()
        # Exercise the public CLI, including stdin-only password and no plaintext on stdout.
        cli_encrypted=directory/'cli-encrypted';cli_plain=directory/'cli-plain'
        for action, source, target in [('encrypt',large_source,cli_encrypted),('decrypt',cli_encrypted,cli_plain)]:
            result=subprocess.run([sys.executable,str(MODULE),action,'--input',str(source),'--output',str(target)],input=password+b'\n',capture_output=True,timeout=90)
            assert result.returncode==0, 'Packaged crypto CLI failed'
            assert not result.stdout, 'CLI unexpectedly wrote content to stdout'
            private(target)
        assert cli_plain.read_bytes()==large_source.read_bytes();no_partial()
        print('PASS: real GCM byte roundtrips, randomized salt/nonce, '+str(calls)+' refusals, private atomic output, kernel write failure and stdin-only CLI')


if __name__ == '__main__':
    main()
