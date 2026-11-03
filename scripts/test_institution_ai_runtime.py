"""Actions/Linux root-only runtime inventory boundary checks; no model inference."""
import json
import os
import pathlib
import sys
import tempfile
import unittest

sys.path.insert(0, '/opt/workproof-ai')
sys.path.append('/opt/workproof')
import ai_runtime as runtime

assert sys.platform.startswith('linux') and os.geteuid()==0 and os.environ.get('GITHUB_ACTIONS')=='true'


class InventoryBoundary(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='workproof-ai-inventory-ci-')
        self.addCleanup(self.temp.cleanup)
        self.base=pathlib.Path(self.temp.name)
        self.previous=runtime.ROOT
        self.addCleanup(setattr,runtime,'ROOT',self.previous)
        runtime.ROOT=self.base
        self.engine='mpu-en-v3'
        cfg={'model':'fixture/model','revision':'a'*40,'files':['weights.bin']}
        registry=self.base/'engines.json'
        registry.write_text(json.dumps({self.engine:cfg}),encoding='utf-8');registry.chmod(0o444)
        self.models=self.base/'models';self.models.mkdir(mode=0o750);os.chown(self.models,0,10001)
        self.folder=self.models/self.engine;self.folder.mkdir(mode=0o750);os.chown(self.folder,0,10001)
        weight=self.folder/'weights.bin';weight.write_bytes(b'non-executable inventory fixture')
        os.chown(weight,0,10001);weight.chmod(0o640)
        digest=runtime.hash_file(weight,model=True)['sha256']
        receipt=self.folder/'workproof-model.json'
        receipt.write_text(json.dumps({'model':cfg['model'],'revision':cfg['revision'],'sha256':{'weights.bin':digest}}))
        os.chown(receipt,0,10001);receipt.chmod(0o640)

    def test_selected_inventory_rejects_extra_engine(self):
        before=runtime.model_inventory(self.models,[self.engine])
        self.assertEqual(set(before),{self.engine})
        extra=self.models/'unselected-engine';extra.mkdir(mode=0o750);os.chown(extra,0,10001)
        with self.assertRaises(ValueError):runtime.model_inventory(self.models,[self.engine])

    def test_parent_symlink_cannot_supply_weights(self):
        link=self.base/'alias';link.symlink_to(self.models,target_is_directory=True)
        with self.assertRaises(OSError):runtime.hash_file(link/self.engine/'weights.bin',model=True)

    def test_changed_weights_rejected_against_model_receipt(self):
        runtime.model_inventory(self.models,[self.engine])
        (self.folder/'weights.bin').write_bytes(b'changed')
        with self.assertRaises(ValueError):runtime.model_inventory(self.models,[self.engine])

    def test_linked_weight_rejected(self):
        os.link(self.folder/'weights.bin',self.base/'linked-weight')
        with self.assertRaises(ValueError):runtime.model_inventory(self.models,[self.engine])

    def test_receipt_engine_inventory_and_json_are_strict(self):
        value={'format':runtime.FORMAT,'status':'prepared','active':True,
               'baseImageId':'sha256:'+'a'*64,'aiImageId':'sha256:'+'b'*64,
               'sourceCommit':'c'*40,'runtimeSha256':'d'*64,'preparedAt':1,
               'engines':runtime.model_inventory(self.models,[self.engine])}
        self.assertEqual(runtime.validate_receipt(json.dumps(value)),value)
        for field,replacement in [('active',1),('runtimeSha256','bad'),('preparedAt',False),('engines',{})]:
            with self.subTest(field=field),self.assertRaises(ValueError):
                runtime.validate_receipt(json.dumps({**value,field:replacement}))
        raw=json.dumps(value)
        with self.assertRaises(ValueError):runtime.validate_receipt(raw[:-1]+',"active":false}')
        unknown={**value,'engines':{'unselected-engine':value['engines'][self.engine]}}
        with self.assertRaises(ValueError):runtime.validate_receipt(json.dumps(unknown))


if __name__=='__main__':unittest.main()
