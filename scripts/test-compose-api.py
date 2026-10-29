#!/usr/bin/env python3
"""Synthetic HTTPS API fixtures for test-compose-integration.sh, never production data."""
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import subprocess
import sys
from urllib.parse import urlsplit
from uuid import uuid4


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


require(os.environ.get('GITHUB_ACTIONS') == 'true'
        and os.environ.get('STAR_STUDY_CI_INTEGRATION') == '1', 'CI-only API fixture')
root = Path(os.environ['STAR_STUDY_CI_ROOT']).resolve()
state = Path(os.environ['STAR_STUDY_CI_STATE']).resolve()
require(root.parent == Path('/opt') and root.name.startswith('starstudy-ci.'), 'Invalid CI source fixture')
require(state.parent == Path('/var/tmp') and state.name.startswith('starstudy-ci-backups.'), 'Invalid CI state fixture')
values = dict(line.split('=', 1) for line in root.joinpath('.env').read_text(encoding='utf-8').splitlines()
              if line and not line.startswith('#'))
base = values['PUBLIC_URL']
parsed = urlsplit(base)
auth_file = state / 'auth.json'
expected_file = state / 'expected-data.json'
auth = json.loads(auth_file.read_text(encoding='utf-8')) if auth_file.exists() else {}


def api(route, method='GET', payload=None, expected=200):
    headers = state / 'api-headers.txt'
    body = state / 'api-body.json'
    command = ['curl', '--noproxy', '*', '--silent', '--show-error', '--max-time', '20',
               '--connect-timeout', '5', '--cacert', str(state / 'test-ca.crt'),
               '--resolve', f'{parsed.hostname}:{parsed.port}:127.0.0.1',
               '--request', method, '--dump-header', str(headers), '--output', str(body),
               '--write-out', '%{http_code}', '--header', 'Content-Type: application/json',
               '--header', f'Origin: {parsed.scheme}://{parsed.netloc}']
    if auth:
        command += ['--header', 'Cookie: ' + auth['cookie'],
                    '--header', 'X-CSRF-Token: ' + auth['csrf'],
                    '--header', 'X-Star-Study-Account: ' + auth['id']]
    if payload is not None:
        request_file = state / 'api-request.json'
        request_file.write_text(json.dumps(payload), encoding='utf-8')
        command += ['--data-binary', '@' + str(request_file)]
    command += [base + '/api/platform' + route]
    response = subprocess.run(command, check=True, capture_output=True, text=True)
    require(response.stdout == str(expected), f'Unexpected API status for {method} {route}: {response.stdout}')
    return json.loads(body.read_text(encoding='utf-8')), headers.read_text(encoding='utf-8')


def entity():
    stamp = datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')
    return {'id': str(uuid4()), 'createdAt': stamp, 'updatedAt': stamp}


def task(subject, title):
    return dict(entity(), subjectId=subject, date='2027-01-01', title=title, chapter='',
                courseName='', courseUrl='', exercises='', estimatedMinutes=30,
                status='todo', notes='', knowledgePointIds=[], priority=1)


def canonical(data):
    return {key: sorted(records, key=lambda record: record['id']) for key, records in data.items()}


mode = sys.argv[1]
if mode == 'seed':
    result, headers = api('/setup', 'POST', {
        'email': 'docker-ci@example.test', 'password': 'synthetic-docker-ci-password',
        'name': 'Docker CI fixture', 'setupToken': values['SETUP_TOKEN'],
    })
    cookie = next(line.partition(':')[2].strip() for line in headers.splitlines()
                  if line.lower().startswith('set-cookie:'))
    require(f'Path={parsed.path}/' in cookie and '; Secure' in cookie,
            'High-port HTTPS login cookie lost its prefix or Secure attribute')
    auth = {'cookie': cookie.split(';')[0], 'csrf': result['csrf'], 'id': result['user']['id']}
    auth_file.write_text(json.dumps(auth), encoding='utf-8')
    current, _ = api('/data')
    data = current['backup']['data']
    subject = data['subjects'][0]['id']
    study_task = task(subject, 'Synthetic persistent learning task')
    study_task['status'] = 'completed'
    study_task['completedAt'] = study_task['updatedAt']
    data['tasks'].append(study_task)
    data['sessions'].append(dict(entity(), taskId=study_task['id'], state='ended',
                                 segments=[{'startedAt': 1000000, 'endedAt': 1060000}]))
    data['mistakes'].append(dict(
        entity(), subjectId=subject, knowledgePointIds=[], question='Synthetic question',
        wrongAnswer='A', correctAnswer='B', reason='CI persistence fixture',
        reviewDate='2027-01-02', mastery='weak', taskIds=[study_task['id']],
        images=[{'type': 'image/png', 'data':
                 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6T0AAAAASUVORK5CYII='}],
    ))
    api('/data', 'PUT', {'baseVersion': current['version'], 'backup': current['backup']})
    saved, _ = api('/data')
    require(len(saved['backup']['data']['sessions']) == 1, 'Timer fixture was not persisted')
    require(len(saved['backup']['data']['mistakes'][0]['images']) == 1, 'Image fixture was not persisted')
    expected_file.write_text(json.dumps(canonical(saved['backup']['data'])), encoding='utf-8')
    print('Real prefixed HTTPS setup, Secure cookie, session, learning task and image seed: passed.')
elif mode == 'mutate':
    current, _ = api('/data')
    data = current['backup']['data']
    data['tasks'].append(task(data['subjects'][0]['id'], 'This task must disappear on explicit restore'))
    api('/data', 'PUT', {'baseVersion': current['version'], 'backup': current['backup']})
    mutated, _ = api('/data')
    require(len(mutated['backup']['data']['tasks']) == 2, 'Pre-restore mutation did not occur')
elif mode == 'verify':
    current, _ = api('/data')
    require(canonical(current['backup']['data']) == json.loads(expected_file.read_text(encoding='utf-8')),
            'Database/session/image/configuration records differ from the saved real API snapshot')
    print('Real API data equals saved snapshot, including image bytes and learning-session segments.')
else:
    raise RuntimeError('Unknown CI API fixture action')
