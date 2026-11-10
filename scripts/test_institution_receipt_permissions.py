"""Actions-only ordinary-role receipt lifecycle through existing admin APIs."""
import json
import os
import re
import secrets
import urllib.error
import urllib.request


def verify_receipt_permissions(origin, admin_token, proof, project):
    assert os.environ.get('GITHUB_ACTIONS') == 'true'
    assert re.fullmatch(r'workproof-server-ci-[0-9a-f]{12}', project)
    assert origin == 'http://127.0.0.1:18082'
    permission = 'workproof:receipt:issue'

    def request(path, token=None, data=None, method=None, consent=False):
        headers={'Content-Type':'application/json'}
        if token:headers['Authorization']='Bearer '+token
        if consent:headers['X-WorkProof-Receipt-Consent']='true'
        if data is not None and not isinstance(data,bytes):data=json.dumps(data).encode()
        try:
            response=urllib.request.urlopen(urllib.request.Request(origin+path,data=data,headers=headers,method=method),timeout=15)
        except urllib.error.HTTPError as error:response=error
        with response:return response.status,response.read(256*1024+1)

    def success(path, token=None, data=None, method=None, consent=False):
        status,raw=request(path,token,data,method,consent)
        assert status==200 and len(raw)<=256*1024,'Permission fixture API failed'
        value=json.loads(raw)
        assert value['code']==200,'Permission fixture operation was refused'
        return value.get('data')

    def nodes(tree):
        for row in tree:
            yield row
            yield from nodes(row.get('children') or [])

    tree=list(nodes(success('/api/system/menus/tree',admin_token)))
    dashboards=[r for r in tree if r.get('path')=='/dashboard']
    assert len(dashboards)==1
    dashboard=int(dashboards[0]['id'])
    # Register exactly the same button node an administrator can create in Menus.vue.
    menu=success('/api/system/menus',admin_token,{'parentId':dashboard,'type':'btn',
        'name':'CI 接收回执签发','icon':'','path':'','component':'','permission':permission,
        'sort':99,'visible':1,'status':1})['id']
    suffix=secrets.token_hex(6)
    role=success('/api/system/roles',admin_token,{'name':'CI 接收回执角色','code':'receipt_ci_'+suffix,
        'dataScope':'SELF','status':1,'menuIds':[dashboard]})['id']
    username='receipt_'+suffix;password=secrets.token_urlsafe(24)
    user=success('/api/system/users',admin_token,{'username':username,'nickname':'CI 接收回执用户',
        'password':password,'phone':'','email':username+'@example.com','deptId':6,'status':1,
        'roleIds':[role],'postIds':[]})['id']

    def login():
        captcha=success('/api/auth/captcha')
        return success('/api/auth/login',data={'username':username,'password':password,
            'captchaUuid':captcha['uuid'],'captcha':captcha['code']})['token']

    def denied(token):
        assert request('/api/workproof/receipts/capabilities',token)[0]==403
        assert request('/api/workproof/receipts',token,proof,consent=True)[0]==403
        permissions=success('/api/auth/me',token)['permissions']
        assert permission not in permissions and '*' not in permissions

    initial=login()
    denied(initial)
    success('/api/auth/logout',initial,data={})
    success('/api/system/roles/'+str(role),admin_token,{'menuIds':[dashboard,menu]},method='PUT')
    granted=login()
    me=success('/api/auth/me',granted)
    assert permission in me['permissions'] and '*' not in me['permissions']
    assert 'super_admin' not in me['roles']
    assert not any(p.startswith('system:') for p in me['permissions'])
    assert success('/api/workproof/receipts/capabilities',granted)['configured'] is True
    assert request('/api/workproof/receipts',granted,proof)[0]==400,'Consent must remain mandatory for ordinary roles'
    receipt=success('/api/workproof/receipts',granted,proof,consent=True)
    assert receipt['payload']['purpose']=='server-received'
    assert request('/api/system/menus',granted,{'name':'must-not-create'})[0]==403,'Signing role could escalate permissions'
    # Backend resolves permissions from current DB state on each request. Verify
    # revocation against the previously authorized token, then also a fresh login.
    success('/api/system/roles/'+str(role),admin_token,{'menuIds':[dashboard]},method='PUT')
    denied(granted)
    success('/api/auth/logout',granted,data={})
    revoked=login();denied(revoked)
    success('/api/auth/logout',revoked,data={})
    # Delete only the exact newly created fixture IDs using the same public APIs.
    success('/api/system/users/'+str(user),admin_token,method='DELETE')
    success('/api/system/roles/'+str(role),admin_token,method='DELETE')
    success('/api/system/menus/'+str(menu),admin_token,method='DELETE')
    print('PASS: ordinary role denied, explicitly granted, consented receipt issued, escalation denied, existing/fresh tokens denied after revocation')
    return receipt
