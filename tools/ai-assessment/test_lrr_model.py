"""Model file boundary fixtures with tiny bytes; never download or load a model."""
import hashlib
import json
import os
import pathlib
import tempfile
import unittest
from unittest.mock import patch
import lrr_model as model


class ModelFiles(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=pathlib.Path(self.temp.name);self.folder=self.root/'model';self.folder.mkdir()
        data=b'non-executable model fixture';(self.folder/'fixture').write_bytes(data)
        self.expected={'format':'workproof-lrr-model/1','model':model.MODEL,'revision':model.REVISION,
            'files':{'fixture':{'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()}}}
        (self.folder/model.RECEIPT).write_text(json.dumps(self.expected),encoding='utf-8')
        self.registry=patch.object(model,'catalogue',return_value=self.expected);self.registry.start();self.addCleanup(self.registry.stop)
        self.names=patch.object(model,'FILES',('fixture',));self.names.start();self.addCleanup(self.names.stop)

    def test_valid_then_modified(self):
        self.assertEqual(model.verify(self.folder),self.expected)
        (self.folder/'fixture').write_bytes(b'other same length or not')
        with self.assertRaises(ValueError):model.verify(self.folder)

    def test_unknown_file_and_receipt_ambiguity(self):
        (self.folder/'unknown').touch()
        with self.assertRaises(ValueError):model.verify(self.folder)
        (self.folder/'unknown').unlink()
        receipt=self.folder/model.RECEIPT
        receipt.write_text(json.dumps(self.expected)[:-1]+',"revision":"wrong"}',encoding='utf-8')
        with self.assertRaises(ValueError):model.verify(self.folder)

    def test_links(self):
        os.link(self.folder/'fixture',self.root/'hardlink')
        with self.assertRaises(ValueError):model.verify(self.folder)
        (self.root/'hardlink').unlink()
        (self.folder/'fixture').rename(self.root/'original')
        (self.folder/'fixture').symlink_to(self.root/'original')
        with self.assertRaises((ValueError,OSError)):model.verify(self.folder)

    def test_no_preparation_overwrite(self):
        before=(self.folder/'fixture').read_bytes()
        with self.assertRaises(ValueError):model.prepare(self.folder)
        self.assertEqual((self.folder/'fixture').read_bytes(),before)


if __name__=='__main__':unittest.main()
