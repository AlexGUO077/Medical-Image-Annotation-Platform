"""Private case inventory for a local, same-batch restoration drill."""
import json
from pathlib import Path
from uuid import UUID


def case_ids(values):
    if not isinstance(values, list) or not values:
        raise ValueError('Supply a nonempty list of case UUIDs')
    ids = [str(UUID(value)) for value in values if isinstance(value, str)]
    if len(set(ids)) != len(values):
        raise ValueError('Case UUIDs must be distinct')
    return sorted(ids)


def read_selection(path):
    if path.is_symlink() or not path.is_file() or path.stat().st_mode & 0o077:
        raise ValueError('The local case selection must be a private file')
    return case_ids(json.loads(path.read_text()))


def sql(instance, query):
    return instance.compose('exec', '-T', 'postgres', 'psql', '-XAtq', '-v', 'ON_ERROR_STOP=1',
                            '-U', 'miap_owner', '-d', 'miap_synthetic', '-c', query).strip()


def check_sources(instance, teaching=False):
    allowed = "('synthetic','teacher_provided_teaching')" if teaching else "('synthetic')"
    for table in ('cases', 'tasks'):
        unknown = sql(instance, f'SELECT count(*) FROM public.{table} WHERE source IS NULL OR source NOT IN {allowed}')
        if unknown != b'0':
            raise ValueError('Source outside the allowed deployment scope')


def require_local(instance):
    if instance.values.get('DEPLOY_ALLOW_TEACHING') != 'true':
        raise ValueError('Enable local teaching in the private instance configuration')
    config = json.loads(instance.compose('config', '--format', 'json'))
    for service in config['services'].values():
        if service.get('network_mode') == 'host' or any(
            port.get('host_ip') not in ('127.0.0.1', '::1') for port in service.get('ports', [])
        ):
            raise ValueError('Teaching services must use loopback ports')


def inventory(instance, selected):
    ids = case_ids(selected)
    # Only canonical UUIDs reach the SQL array. Report and answer text stay in PostgreSQL.
    literals = ','.join("'" + value + "'" for value in ids)
    query = Path(__file__).with_name('teaching-inventory.sql').read_text()
    records = json.loads(sql(instance, query.replace('/*CASE_UUIDS*/', literals)))
    if len(records) != len(ids):
        raise ValueError('Missing or ineligible teaching case')
    for case in records:
        if not all(case.get(field) for field in ('series', 'report', 'assignments', 'items')):
            raise ValueError('Case requires images, report and both task entries')
        if any(row['frames'] < 1 for row in case['series']):
            raise ValueError('Invalid series frame count')
        if any(not item['sections'] or not item['students'] for item in case['items']):
            raise ValueError('Missing reference sections or assigned students')
    return records


def verify(instance, baseline, *, exact):
    actual = inventory(instance, [case['id'] for case in baseline])
    if exact:
        if actual != baseline:
            raise ValueError('Restored case inventory differs from snapshot')
        return
    for before, now in zip(baseline, actual):
        for key in ('id', 'case_digest', 'series', 'report'):
            if before[key] != now[key]:
                raise ValueError('Case or report differs from baseline')
        for key in ('assignments', 'items'):
            if any(row not in now[key] for row in before[key]):
                raise ValueError('Baseline task or reference changed')
        attempts = {a['id']: a for a in now['attempts']}
        for old in before['attempts']:
            current = attempts.get(old['id'])
            if not current or current['version'] < old['version'] or current['item'] != old['item'] or current['student'] != old['student']:
                raise ValueError('Missing or older student attempt')
            if old['state'] == 'submitted' and current != old:
                raise ValueError('Frozen submission differs from baseline')
            if current['version'] == old['version'] and current['answer'] != old['answer']:
                raise ValueError('Saved answer differs from baseline')
