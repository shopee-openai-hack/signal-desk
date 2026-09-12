"""Verify the submitted Railway deployment itself, then its database readiness."""
import json
import subprocess
import sys
import time
import urllib.request

service, environment, url, receipt = sys.argv[1:]
with open(receipt) as f:
    deployment_id = json.load(f)["deploymentId"]
if not url.startswith('https://'):
    raise SystemExit('APP_URL must use HTTPS')
cmd=['npx','--yes','@railway/cli@5.52.1','deployment','list','--service',service,'--environment',environment,'--limit','1','--json']
for _ in range(48):
    r=subprocess.run(cmd,capture_output=True,text=True,check=True,timeout=30)
    deployments=json.loads(r.stdout)
    if not deployments: raise SystemExit('No deployment found')
    latest=deployments[0]
    if latest['id'] != deployment_id: raise SystemExit('Deployment changed during verification; inspect Railway')
    state=latest['status']
    if state in {'FAILED','CRASHED','REMOVED','SKIPPED'}: raise SystemExit(f'Deployment failed: {state}')
    if state=='SUCCESS':
        with urllib.request.urlopen(url.rstrip('/')+'/healthz',timeout=15) as response:
            payload=json.load(response)
        if payload.get('status')!='ok' or payload.get('database')!='ok':
            raise SystemExit('Database readiness failed')
        print(f'Verified deployment {deployment_id}, database ready')
        break
    time.sleep(5)
else: raise SystemExit('Deployment verification timed out')
