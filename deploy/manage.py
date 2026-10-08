#!/usr/bin/env python3
"""Local synthetic deployment only. No shell execution, cron installation or cloud defaults."""
from __future__ import annotations

import argparse
import base64
from contextlib import contextmanager
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import secrets
import subprocess
import sys
import tarfile
import tempfile

ROOT = Path(__file__).resolve().parent
STORES = {'orthanc': '/var/lib/orthanc/db', 'minio': '/data'}
MIDDLEWARE = ['postgres', 'orthanc', 'minio', 'redis', 'elasticsearch']
KEYS = ['MFA_ENCRYPTION_KEY', 'MASK_MAP_ENCRYPTION_KEY', 'DICOM_UID_SECRET']
FILES = ['postgres.dump', 'orthanc.tar', 'minio.tar']


def run(command, *, env=None, output=None, input_file=None):
    result = subprocess.run(command, env=env, stdin=input_file, stdout=output or subprocess.PIPE,
                            stderr=subprocess.PIPE, check=False)
    if result.returncode:
        # Commands and stderr may include credentials. Keep them out of shared logs.
        raise RuntimeError(f'{command[0]} operation failed (exit {result.returncode})')
    return result.stdout or b''


def write_private(path, text):
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, 'w') as target:
        target.write(text)


def private_config(directory):
    directory = directory.resolve()
    marker = json.loads((directory / 'instance.json').read_text())
    if marker.get('format') != 1 or not re.fullmatch(r'miap-synthetic-[a-z0-9-]{1,40}', marker.get('project', '')):
        raise ValueError('Not an owned synthetic instance')
    path = directory / '.env'
    if path.is_symlink() or path.stat().st_mode & 0o077 or directory.stat().st_mode & 0o077:
        raise ValueError('Instance directory and environment must be private')
    values = {}
    for line in path.read_text().splitlines():
        key, value = line.split('=', 1)
        if not re.fullmatch(r'[A-Z][A-Z0-9_]*', key) or '\x00' in value or '\r' in value:
            raise ValueError('Invalid private configuration')
        values[key] = value
    if values.get('DEPLOY_INSTANCE_DIR') != str(directory):
        raise ValueError('Instance directory differs from generated configuration')
    for name in ['DEPLOY_HTTP_PORT', 'DEPLOY_HTTPS_PORT']:
        if not values[name].isdigit() or not 1024 <= int(values[name]) <= 65535:
            raise ValueError('Invalid loopback port')
    return marker, values


class Instance:
    def __init__(self, directory):
        endpoint = os.environ.get('DOCKER_HOST')
        if not endpoint or os.environ.get('DOCKER_CONTEXT'):
            endpoint = run(['docker', 'context', 'inspect', '--format', '{{.Endpoints.docker.Host}}']).decode().strip()
        if not endpoint.startswith(('unix://', 'npipe://')):
            raise ValueError('This batch permits only a local Docker endpoint')
        self.directory = directory.resolve()
        self.marker, self.values = private_config(directory)
        self.project = self.marker['project']
        self.env = {**os.environ, **self.values}
        self.command = ['docker', 'compose', '--project-name', self.project, '--env-file',
                        str(self.directory / '.env'), '-f', str(ROOT / 'compose.yml')]

    def compose(self, *args, **kwargs):
        return run([*self.command, *args], env=kwargs.pop('env', self.env), **kwargs)

    def resources(self):
        result = []
        for kind in ['container', 'volume', 'network']:
            flags = ['-a', '-q'] if kind == 'container' else ['-q']
            result.extend(run(['docker', kind, 'ls', *flags, '--filter', f'label=com.docker.compose.project={self.project}']).splitlines())
        # TLS is populated before Compose creates its labeled resources.
        result.extend(run(['docker', 'volume', 'ls', '-q', '--filter', f'name=^{self.project}_']).splitlines())
        return result

    @contextmanager
    def locked(self):
        with open(self.directory / '.operation.lock', 'a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            self.compose('config', '--quiet')
            yield

    def containers(self):
        ids = self.compose('ps', '--all', '--quiet').decode().split()
        if not ids:
            return {}
        result = {}
        for item in json.loads(run(['docker', 'inspect', *ids])):
            labels = item['Config']['Labels']
            if labels.get('com.docker.compose.project') != self.project:
                raise ValueError('Unexpected container owner')
            if labels.get('com.docker.compose.oneoff') == 'True':
                continue
            service = labels['com.docker.compose.service']
            if service in result:
                raise ValueError('Unexpected duplicate service')
            result[service] = (item['Id'], item['State']['Running'])
        return result

    def tls(self):
        run(['docker', 'volume', 'create', '--label', f'com.docker.compose.project={self.project}', f'{self.project}_tls'])
        run(['docker', 'run', '--rm', '--network', 'none', '--user', '0',
             '--mount', f'type=bind,source={self.directory / "certs"},target=/source,readonly',
             '--mount', f'type=volume,source={self.project}_tls,target=/target',
             'miap/nginx:wp16', 'sh', '-c',
             'cp /source/fullchain.pem /source/privkey.pem /target/ && chown -R 101:101 /target && chmod 700 /target && chmod 600 /target/*.pem'])

    def provision(self):
        admin = {**self.env, 'POSTGRES_USER': 'miap_owner', 'POSTGRES_PASSWORD': self.values['POSTGRES_OWNER_PASSWORD']}
        overrides = []
        for key in ['POSTGRES_USER', 'POSTGRES_PASSWORD', 'POSTGRES_APP_PASSWORD', 'SEED_ADMIN_PASSWORD', 'ELASTIC_PASSWORD']:
            overrides.extend(['-e', key])
        self.compose('run', '--rm', '--no-deps', *overrides, 'server', 'node', 'bootstrap.cjs', env=admin)
        for bucket in ['miap-mask-maps', 'miap-attachments']:
            self.compose('exec', '-T', 'minio', 'mc', 'mb', '--ignore-existing', f'local/{bucket}')
            self.compose('exec', '-T', 'minio', 'mc', 'anonymous', 'set', 'none', f'local/{bucket}')
        policy = {'Version': '2012-10-17', 'Statement': [
            {'Effect': 'Allow', 'Action': ['s3:ListBucket', 's3:GetBucketLocation'],
             'Resource': ['arn:aws:s3:::miap-mask-maps', 'arn:aws:s3:::miap-attachments']},
            {'Effect': 'Allow', 'Action': ['s3:GetObject', 's3:PutObject', 's3:DeleteObject'],
             'Resource': ['arn:aws:s3:::miap-mask-maps/*', 'arn:aws:s3:::miap-attachments/*']},
        ]}
        with tempfile.TemporaryDirectory() as temporary:
            file = Path(temporary) / 'policy.json'
            file.write_text(json.dumps(policy))
            # Policy contains only bucket names/actions; MinIO's non-root UID must read it.
            file.chmod(0o644)
            container = self.containers()['minio'][0]
            run(['docker', 'cp', str(file), f'{container}:/tmp/miap-policy.json'])
            self.compose('exec', '-T', 'minio', 'mc', 'admin', 'policy', 'create', 'local', 'miap-runtime', '/tmp/miap-policy.json')
        self.compose('exec', '-T', 'minio', 'mc', 'admin', 'user', 'add', 'local', 'miap_runtime', self.values['MINIO_APP_PASSWORD'])
        self.compose('exec', '-T', 'minio', 'mc', 'admin', 'policy', 'attach', 'local', 'miap-runtime', '--user', 'miap_runtime')

    def up(self):
        print('Preparing local TLS volume.', flush=True)
        self.tls()
        print('Starting isolated storage services.', flush=True)
        self.compose('up', '-d', '--wait', '--wait-timeout', '360', *MIDDLEWARE)
        print('Provisioning synthetic runtime accounts.', flush=True)
        self.provision()
        print('Starting application and HTTPS entry.', flush=True)
        self.compose('up', '-d', '--wait', '--wait-timeout', '360', 'server', 'nginx')


def initialize(args):
    if not re.fullmatch(r'miap-synthetic-[a-z0-9-]{1,40}', args.project):
        raise ValueError('Project must start with miap-synthetic-')
    if args.http_port == args.https_port or any(not 1024 <= p <= 65535 for p in [args.http_port, args.https_port]):
        raise ValueError('Use two different unprivileged local ports')
    if any(n <= 0 for n in [args.window, *args.rates]):
        raise ValueError('Frame budgets must be positive')
    directory = args.instance.resolve()
    if any(c in str(directory) for c in '\n\r$,:'):
        raise ValueError('Unsupported instance path')
    directory.mkdir(mode=0o700, parents=True, exist_ok=False)
    values = {key: secrets.token_urlsafe(32) for key in [
        'POSTGRES_OWNER_PASSWORD', 'POSTGRES_APP_PASSWORD', 'JWT_SECRET', 'FRAME_TOKEN_SECRET',
        'DICOM_UID_SECRET', 'ORTHANC_PASSWORD', 'MINIO_ROOT_PASSWORD', 'MINIO_APP_PASSWORD',
        'REDIS_PASSWORD', 'ELASTIC_PASSWORD', 'SEARCH_ELASTIC_PASSWORD', 'SEED_ADMIN_PASSWORD',
    ]}
    values.update({key: base64.b64encode(secrets.token_bytes(32)).decode() for key in KEYS[:2]})
    if args.keys_from:
        _, source = private_config(args.keys_from)
        values.update({key: source[key] for key in KEYS})
    values.update(DEPLOY_INSTANCE_DIR=str(directory), DEPLOY_HTTP_PORT=str(args.http_port),
                  DEPLOY_HTTPS_PORT=str(args.https_port), ORTHANC_USERNAME='miap_orthanc',
                  MINIO_ROOT_USER='miap_owner', FRAME_RATE_WINDOW_SECONDS=str(args.window))
    values.update({f'FRAME_RATE_{name}': str(value) for name, value in zip(['CR', 'DX', 'CT', 'MR', 'US'], args.rates)})
    write_private(directory / '.env', ''.join(f'{key}={value}\n' for key, value in values.items()))
    write_private(directory / 'instance.json', json.dumps({'format': 1, 'project': args.project, 'restoration_keys': bool(args.keys_from)}))
    instance = Instance(directory)
    if instance.resources():
        raise ValueError('Project already has Docker resources; choose a new name')
    certs = directory / 'certs'
    certs.mkdir(mode=0o700)
    run(['openssl', 'req', '-x509', '-newkey', 'rsa:3072', '-nodes', '-days', '30',
         '-keyout', str(certs / 'privkey.pem'), '-out', str(certs / 'fullchain.pem'),
         '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'])
    (certs / 'privkey.pem').chmod(0o600)
    (certs / 'fullchain.pem').chmod(0o644)
    config = (ROOT / 'nginx/nginx.conf').read_text().replace('__HTTPS_PORT__', str(args.https_port))
    (directory / 'nginx.conf').write_text(config)
    (directory / 'nginx.conf').chmod(0o644)
    print('Initialized private synthetic instance; credentials remain in its .env file.')


def checksum(path):
    result = hashlib.sha256()
    with path.open('rb') as source:
        for block in iter(lambda: source.read(1024 * 1024), b''):
            result.update(block)
    return result.hexdigest()


def verify_batch(directory, *, unpublished=False):
    if not unpublished and not re.fullmatch(r'\d{8}T\d{6}Z-[0-9a-f]{8}', directory.name):
        raise ValueError('Not a published complete batch')
    manifest = json.loads((directory / 'manifest.json').read_text())
    if manifest.get('format') != 1 or manifest.get('complete') is not True or set(manifest.get('files', {})) != set(FILES):
        raise ValueError('Incomplete backup manifest')
    for name in FILES:
        path = directory / name
        if path.is_symlink() or not path.is_file() or checksum(path) != manifest['files'][name]:
            raise ValueError('Backup file missing or checksum mismatch')
        if name.endswith('.tar'):
            with tarfile.open(path) as archive:
                for member in archive:
                    path_parts = PurePosixPath(member.name)
                    if path_parts.is_absolute() or '..' in path_parts.parts or not (member.isfile() or member.isdir()):
                        raise ValueError('Unsafe archive entry')
    return manifest


def backup(instance, destination):
    destination.mkdir(mode=0o700, parents=True, exist_ok=True)
    if destination.stat().st_mode & 0o077:
        raise ValueError('Backup root must be private (0700)')
    state = instance.containers()
    if any(service not in state for service in ['server', 'postgres', *STORES]) or not state['postgres'][1]:
        raise ValueError('Deployment is not ready for a consistent backup')
    running = [service for service in ['server', *STORES] if state[service][1]]
    batch = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '-' + secrets.token_hex(4)
    partial = destination / ('.partial-' + batch)
    partial.mkdir(mode=0o700)
    try:
        if 'server' in running:
            instance.compose('stop', '--timeout', '120', 'server')
        stores_running = [service for service in STORES if service in running]
        if stores_running:
            instance.compose('stop', '--timeout', '120', *stores_running)
        stopped = instance.containers()
        if any(stopped[service][1] for service in ['server', *STORES]):
            raise ValueError('Writers did not stop')
        with (partial / 'postgres.dump').open('xb') as output:
            instance.compose('exec', '-T', 'postgres', 'pg_dump', '-U', 'miap_owner', '-d', 'miap_synthetic',
                             '--no-owner', '--no-acl', '-Fc', output=output)
        for service, path in STORES.items():
            with (partial / f'{service}.tar').open('xb') as output:
                run(['docker', 'cp', '-a', f'{state[service][0]}:{path}/.', '-'], output=output)
        manifest = {'format': 1, 'complete': True, 'project': instance.project,
                    'key_fingerprints': {key: hashlib.sha256(instance.values[key].encode()).hexdigest() for key in KEYS},
                    'files': {name: checksum(partial / name) for name in FILES}}
        write_private(partial / 'manifest.json', json.dumps(manifest))
        verify_batch(partial, unpublished=True)
    finally:
        if running:
            instance.compose('up', '-d', '--wait', '--wait-timeout', '360', *running)
    complete = destination / batch
    partial.rename(complete)
    batches = []
    for folder in destination.iterdir():
        if folder.is_symlink() or not re.fullmatch(r'\d{8}T\d{6}Z-[0-9a-f]{8}', folder.name):
            continue
        try:
            saved = json.loads((folder / 'manifest.json').read_text())
            if saved.get('format') == 1 and saved.get('project') == instance.project and saved.get('complete') is True and (folder / 'postgres.dump').is_file():
                batches.append(folder)
        except (OSError, ValueError):
            continue
    for folder in sorted(batches, key=lambda path: path.name)[:-30]:
        (folder / 'postgres.dump').unlink()
    print(f'Complete verified backup: {complete}')
    return complete


def restore(instance, source):
    manifest = verify_batch(source)  # Validate before creating any target resources.
    fingerprints = {key: hashlib.sha256(instance.values[key].encode()).hexdigest() for key in KEYS}
    if manifest.get('key_fingerprints') != fingerprints:
        raise ValueError('Restore keys do not match this batch')
    if not instance.marker.get('restoration_keys') or instance.resources():
        raise ValueError('Restore requires a new, unused instance initialized with --keys-from')
    instance.compose('create', 'postgres', *STORES)
    state = instance.containers()
    for service, path in STORES.items():
        with (source / f'{service}.tar').open('rb') as input_file:
            run(['docker', 'cp', '-a', '-', f'{state[service][0]}:{path}'], input_file=input_file)
    instance.compose('up', '-d', '--wait', '--wait-timeout', '180', 'postgres')
    with (source / 'postgres.dump').open('rb') as input_file:
        instance.compose('exec', '-T', 'postgres', 'pg_restore', '-U', 'miap_owner', '-d', 'miap_synthetic',
                         '--no-owner', '--no-acl', '--single-transaction', '--exit-on-error', input_file=input_file)
    count = instance.compose('exec', '-T', 'postgres', 'psql', '-U', 'miap_owner', '-d', 'miap_synthetic', '-At',
                             '-c', "SELECT count(*) FROM cases WHERE source IS DISTINCT FROM 'synthetic'").strip()
    if count != b'0':
        raise ValueError('Restored data is not synthetic; business services remain stopped')
    instance.up()
    instance.compose('exec', '-T', 'server', 'node', 'dist/modules/search/reconcile-search.js')
    print('Same-batch stores restored. Verify three authenticated previews before accepting the restoration.')


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--instance', required=True, type=Path)
    sub = parser.add_subparsers(dest='operation', required=True)
    init = sub.add_parser('init')
    init.add_argument('--project', required=True)
    init.add_argument('--http-port', type=int, required=True)
    init.add_argument('--https-port', type=int, required=True)
    init.add_argument('--window', type=int, required=True)
    init.add_argument('--rates', type=int, nargs=5, required=True, metavar=('CR', 'DX', 'CT', 'MR', 'US'))
    init.add_argument('--keys-from', type=Path)
    sub.add_parser('up')
    build = sub.add_parser('build')
    build.add_argument('services', nargs='+', choices=[*MIDDLEWARE, 'server', 'nginx'])
    back = sub.add_parser('backup')
    back.add_argument('--destination', required=True, type=Path)
    back.add_argument('--rsync-target', help='Explicit user@host:/absolute/path; preconfigured SSH identity and known_hosts required')
    recovery = sub.add_parser('restore')
    recovery.add_argument('--source', required=True, type=Path)
    args = parser.parse_args()
    if args.operation == 'init':
        initialize(args)
        return
    instance = Instance(args.instance)
    with instance.locked():
        if args.operation == 'up':
            instance.up()
        elif args.operation == 'build':
            instance.compose('build', *args.services)
        elif args.operation == 'backup':
            target = args.rsync_target
            if target and not re.fullmatch(r'[a-zA-Z0-9_][a-zA-Z0-9_.-]*@[a-zA-Z0-9][a-zA-Z0-9.-]*:/[a-zA-Z0-9_/.-]+', target):
                raise ValueError('Use a literal SSH user, host and absolute directory')
            complete = backup(instance, args.destination.resolve())
            if target:
                run(['rsync', '-a', '-e', 'ssh -o BatchMode=yes -o StrictHostKeyChecking=yes', '--', str(complete), target.rstrip('/') + '/'])
                print('Verified batch synchronized to the configured target.')
        elif args.operation == 'restore':
            restore(instance, args.source.resolve())


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, RuntimeError, KeyError, tarfile.TarError) as error:
        # Never include subprocess output, environment values or full commands.
        print(f'Deployment operation failed ({type(error).__name__}); no acceptance recorded.', file=sys.stderr)
        sys.exit(1)
