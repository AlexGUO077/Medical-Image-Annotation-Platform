"""Failure-path checks complement the real Docker/HTTPS restoration drill."""
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import Mock, patch

import manage
import teaching_set


class BackupSafetyTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.batch = self.root / '20261008T000000Z-01234567'
        self.batch.mkdir()
        (self.batch / 'postgres.dump').write_bytes(b'synthetic-test-dump')
        for name in ['orthanc.tar', 'minio.tar']:
            with tarfile.open(self.batch / name, 'w') as archive:
                member = tarfile.TarInfo('./synthetic.bin')
                member.size = 4
                archive.addfile(member, io.BytesIO(b'test'))
        self.manifest()

    def tearDown(self):
        self.temporary.cleanup()

    def manifest(self):
        (self.batch / 'manifest.json').write_text(json.dumps({
            'format': 1, 'complete': True, 'project': 'miap-synthetic-test',
            'files': {name: manage.checksum(self.batch / name) for name in manage.FILES},
        }))

    def test_valid_batch_and_corrupt_dump(self):
        self.assertEqual(manage.verify_batch(self.batch)['project'], 'miap-synthetic-test')
        (self.batch / 'postgres.dump').write_bytes(b'corrupted')
        with self.assertRaisesRegex(ValueError, 'checksum'):
            manage.verify_batch(self.batch)

    def test_incomplete_batch_cannot_be_restored(self):
        partial = self.root / '.partial-20261008T000000Z-01234567'
        self.batch.rename(partial)
        with self.assertRaisesRegex(ValueError, 'published'):
            manage.verify_batch(partial)

    def test_teaching_data_stays_local_and_requires_loopback_and_explicit_opt_in(self):
        instance = Mock(values={'DEPLOY_ALLOW_TEACHING': 'true'})
        with self.assertRaisesRegex(ValueError, 'local storage'):
            manage.backup(instance, self.root / 'out', remote_sync=True)
        instance.compose.assert_not_called()
        instance.compose.return_value = b'{"services":{"nginx":{"ports":[{"host_ip":"0.0.0.0"}]}}}'
        with self.assertRaisesRegex(ValueError, 'loopback'):
            teaching_set.require_local(instance)
        instance.values = {}
        with self.assertRaisesRegex(ValueError, 'Enable local teaching'):
            teaching_set.require_local(instance)

    def test_teaching_inventory_is_bound_to_the_backup_and_separate_from_default_restore(self):
        catalog = self.batch / 'teaching-set.json'
        catalog.write_text('[]')
        instance = Mock(values={k: 'synthetic-only' for k in manage.KEYS})
        file = self.batch / 'manifest.json'
        manifest = json.loads(file.read_text())
        manifest.update(teaching_set_sha256=manage.checksum(catalog),
                        key_fingerprints={k: manage.hashlib.sha256(v.encode()).hexdigest() for k, v in instance.values.items()})
        file.write_text(json.dumps(manifest))
        with self.assertRaisesRegex(ValueError, 'matching synthetic'):
            manage.restore(instance, self.batch)
        instance.compose.assert_not_called()
        catalog.write_text('[{}]')
        with self.assertRaisesRegex(ValueError, 'inventory'):
            manage.verify_batch(self.batch)

    def test_reuse_allows_new_work_and_verifies_preexisting_answers(self):
        attempt = dict(id='attempt', item='item', student='student', state='in_progress', version=2, answer='hashA')
        frozen = dict(attempt, id='frozen', state='submitted')
        case = dict(id='case', case_digest='case-hash', series=[], report='report-hash',
                    assignments=[], items=[], attempts=[attempt, frozen])
        updated = dict(case, attempts=[dict(attempt, version=3, answer='hashB'), frozen])
        with patch.object(teaching_set, 'inventory', return_value=[updated]):
            teaching_set.verify(None, [case], exact=False)
            with self.assertRaisesRegex(ValueError, 'differs'):
                teaching_set.verify(None, [case], exact=True)
        updated['attempts'][1] = dict(frozen, answer='changed')
        with patch.object(teaching_set, 'inventory', return_value=[updated]):
            with self.assertRaisesRegex(ValueError, 'Frozen submission'):
                teaching_set.verify(None, [case], exact=False)

    def test_tar_traversal_and_links_rejected_even_with_matching_checksum(self):
        for name, kind in [('../outside', tarfile.REGTYPE), ('/absolute', tarfile.REGTYPE),
                           ('link', tarfile.SYMTYPE), ('hardlink', tarfile.LNKTYPE)]:
            with self.subTest(name=name):
                with tarfile.open(self.batch / 'orthanc.tar', 'w') as archive:
                    member = tarfile.TarInfo(name)
                    member.type = kind
                    member.linkname = '/outside' if kind in [tarfile.SYMTYPE, tarfile.LNKTYPE] else ''
                    archive.addfile(member)
                self.manifest()
                with self.assertRaisesRegex(ValueError, 'Unsafe archive'):
                    manage.verify_batch(self.batch)

    def test_failed_stop_never_dumps_and_restores_original_running_services(self):
        class FailedStop:
            project = 'miap-synthetic-test'
            calls = []

            def containers(self):
                return {name: (name, name != 'minio') for name in ['server', 'postgres', 'orthanc', 'minio']}

            def compose(self, *args, **kwargs):
                self.calls.append(args)
                if args[0] == 'stop':
                    raise RuntimeError('synthetic stop failure')

        instance = FailedStop()
        with patch.object(manage, 'run') as docker:
            with self.assertRaises(RuntimeError):
                manage.backup(instance, self.root / 'backups')
            docker.assert_not_called()
        self.assertEqual(instance.calls[-1], ('up', '-d', '--wait', '--wait-timeout', '360', 'server', 'orthanc'))
        self.assertTrue(all(p.name.startswith('.partial-') for p in (self.root / 'backups').iterdir()))

    def test_existing_restore_target_untouched(self):
        class Existing:
            marker = {'restoration_keys': True}
            values = {key: 'synthetic-test-key' for key in manage.KEYS}

            def resources(self):
                return ['existing-volume']

            def compose(self, *args, **kwargs):
                raise AssertionError('Must not mutate an existing target')

        fingerprints = {key: manage.hashlib.sha256(value.encode()).hexdigest() for key, value in Existing.values.items()}
        with patch.object(manage, 'verify_batch', return_value={'key_fingerprints': fingerprints}):
            with self.assertRaisesRegex(ValueError, 'unused instance'):
                manage.restore(Existing(), self.batch)

    def test_wrong_recovery_keys_rejected_before_docker(self):
        class WrongKeys:
            values = {key: 'wrong-synthetic-key' for key in manage.KEYS}

            def resources(self):
                raise AssertionError('Keys must be checked before touching Docker')

        with self.assertRaisesRegex(ValueError, 'keys do not match'):
            manage.restore(WrongKeys(), self.batch)

    def test_success_keeps_thirty_dumps_without_deleting_object_archives(self):
        class Running:
            project = 'miap-synthetic-test'
            values = {key: 'synthetic-test-key' for key in manage.KEYS}
            active = True

            def containers(self):
                return {name: (name, self.active or name == 'postgres') for name in ['server', 'postgres', 'orthanc', 'minio']}

            def compose(self, *args, **kwargs):
                if args[0] == 'stop':
                    self.active = False
                elif args[0] == 'up':
                    self.active = True
                elif args[0] == 'exec':
                    kwargs['output'].write(b'synthetic-dump')

        destination = self.root / 'retention'
        destination.mkdir(mode=0o700)
        prior = []
        for index in range(30):
            folder = destination / f'20250101T000000Z-{index:08x}'
            folder.mkdir()
            (folder / 'manifest.json').write_text(json.dumps({'format': 1, 'complete': True, 'project': 'miap-synthetic-test'}))
            (folder / 'postgres.dump').write_bytes(b'synthetic-old-dump')
            (folder / 'orthanc.tar').write_bytes(b'synthetic-old-images')
            prior.append(folder)

        def copy_archive(command, **kwargs):
            with tarfile.open(fileobj=kwargs['output'], mode='w|') as archive:
                member = tarfile.TarInfo('./synthetic')
                member.size = 1
                archive.addfile(member, io.BytesIO(b'x'))
            return b''

        instance = Running()
        with patch.object(manage, 'run', side_effect=copy_archive):
            completed = manage.backup(instance, destination)
        self.assertTrue(instance.active)
        manage.verify_batch(completed)
        self.assertEqual(len(list(destination.glob('*/postgres.dump'))), 30)
        self.assertFalse((prior[0] / 'postgres.dump').exists())
        self.assertTrue(all((folder / 'orthanc.tar').exists() for folder in prior))


if __name__ == '__main__':
    unittest.main()
