"""Linux Actions-only coordinator guard tests. Does not operate on a deployment."""
import copy
import importlib.util
import pathlib
import unittest

path = pathlib.Path(__file__).resolve().parents[1] / 'deploy/institution/backup_coordinator.py'
spec = importlib.util.spec_from_file_location('backup_coordinator', path)
coordinator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(coordinator)


class Guards(unittest.TestCase):
    def test_stopped_fingerprint_detects_restart_and_replacement(self):
        original = {'Id': 'a', 'Image': 'b', 'RestartCount': 0, 'Mounts': [],
                    'State': {'Running': False, 'Restarting': False, 'Paused': False,
                              'StartedAt': 'start', 'FinishedAt': 'finish'}}
        fingerprint = coordinator.stopped(original)
        for key, value in [('Id', 'replacement'), ('Image', 'replacement'), ('RestartCount', 1)]:
            changed = copy.deepcopy(original)
            changed[key] = value
            self.assertNotEqual(fingerprint, coordinator.stopped(changed))
        for key in ['Running', 'Restarting', 'Paused']:
            changed = copy.deepcopy(original)
            changed['State'][key] = True
            with self.assertRaises(coordinator.CoordinatorError):
                coordinator.stopped(changed)

    def test_mount_identity_rejects_binds_duplicates_and_argument_injection(self):
        mount = {'Destination': '/private/config', 'Type': 'volume', 'Name': 'project_app_config'}
        self.assertEqual(coordinator.volume({'Mounts': [mount]}, '/private/config'), 'project_app_config')
        for mounts in [[], [mount, mount], [{**mount, 'Type': 'bind'}],
                       [{**mount, 'Name': 'foo,readonly=false'}]]:
            with self.assertRaises(coordinator.CoordinatorError):
                coordinator.volume({'Mounts': mounts}, '/private/config')


if __name__ == '__main__':
    unittest.main()
