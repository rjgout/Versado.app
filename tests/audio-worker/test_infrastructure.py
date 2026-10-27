"""Werkelijke Compose-/containerproef, uitsluitend eigen tijdelijke hostmappen en lokale Docker."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
COMPOSE = ROOT / 'deploy/audio-worker/compose.yml'
IMAGE = 'versado-audio-worker:isolated-test'


def docker(*args, **kwargs):
    env = {k: v for k, v in os.environ.items() if k not in (
        'DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_TLS', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH')}
    env.update(AUDIO_WORKER_UID='10001', AUDIO_WORKER_GID='10001', AUDIO_WORKER_IMAGE=IMAGE)
    try:
        return subprocess.run(['docker', '--host=unix:///var/run/docker.sock', *args], env=env,
                              capture_output=True, text=True, check=True, **kwargs)
    except subprocess.CalledProcessError as error:
        print(error.stderr)
        raise


class InfrastructureTest(unittest.TestCase):
    def test_compose_has_no_live_or_privileged_path(self):
        config = json.loads(docker('compose', '-f', str(COMPOSE), '--profile', 'manual', 'config', '--format', 'json').stdout)
        worker = config['services']['audio-worker']
        self.assertEqual(worker['deploy']['replicas'], 0)
        self.assertEqual(worker['profiles'], ['manual'])
        self.assertEqual(worker['command'], ['status'])
        self.assertEqual(worker['network_mode'], 'none')
        self.assertTrue(worker['read_only'])
        self.assertEqual(worker['cap_drop'], ['ALL'])
        self.assertEqual(worker['pids_limit'], 64)
        self.assertEqual(worker['mem_limit'], '536870912')
        self.assertEqual(len(worker['volumes']), 3)
        self.assertTrue(next(v for v in worker['volumes'] if v['target'] == '/jobs')['read_only'])
        self.assertTrue(all(not v['bind'].get('create_host_path', False) for v in worker['volumes']))
        self.assertFalse(set(worker) & {'ports', 'secrets', 'env_file', 'networks', 'privileged'})
        self.assertEqual(set(worker['environment']), {'WORKER_STORAGE_BUDGET_BYTES'})
        self.assertFalse(any('/data/audio' in v['source'] or 'docker.sock' in v['source'] for v in worker['volumes']))

    def test_real_image_runs_without_network_or_writes_and_rejects_generation(self):
        docker('build', '-t', IMAGE, '-f', str(ROOT / 'deploy/audio-worker/Dockerfile'), str(ROOT))
        with tempfile.TemporaryDirectory(prefix='versado-worker-test-') as tmp:
            root = Path(tmp)
            folders = [root / p for p in ['jobs', 'work', 'outbox']]
            for folder in folders:
                folder.mkdir(mode=0o777)
                folder.chmod(0o777)
            (folders[0] / 'no-generation.txt').write_text('Geen audiogeneratieopdracht')
            before = sorted(str(p.relative_to(root)) for p in root.rglob('*'))
            mounts = sum((['--mount', f'type=bind,src={folder},dst=/{folder.name}' + (',readonly' if folder.name == 'jobs' else '')] for folder in folders), [])
            args = ['run', '--rm', '--network=none', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--pids-limit=64', '--memory=512m', '--cpus=1', *mounts, IMAGE]
            result = json.loads(docker(*args, 'status').stdout)
            self.assertFalse(result['generationEnabled'])
            self.assertFalse(result['packageDeliveryEnabled'])
            self.assertEqual(result['uid'], 10001)
            self.assertFalse(result['folders']['/jobs']['writable'])
            self.assertEqual(before, sorted(str(p.relative_to(root)) for p in root.rglob('*')))
            with self.assertRaises(subprocess.CalledProcessError) as root_error:
                docker('run', '--rm', '--network=none', '--read-only', '--user=0:0', IMAGE, 'status')
            self.assertEqual(root_error.exception.returncode, 2)
            self.assertEqual(docker(*args, 'contract').stdout.strip(), (ROOT / 'src/lib/audio/contract.ts').read_text().strip())
            with self.assertRaises(subprocess.CalledProcessError) as error:
                docker(*args, 'generate')
            self.assertEqual(error.exception.returncode, 2)
            self.assertEqual(before, sorted(str(p.relative_to(root)) for p in root.rglob('*')))


if __name__ == '__main__':
    unittest.main()
