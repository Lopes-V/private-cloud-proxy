#!/usr/bin/env python3
"""Read-only account/size check. Requires DIGITALOCEAN_TOKEN via secure environment.
Never creates resources or enables billing; a successful check is not cost authorization.
"""
import argparse
import json
import os
import urllib.error
import urllib.parse
import urllib.request

BASE='https://api.digitalocean.com'
SIZE='s-1vcpu-512mb-10gb'


def approved_size(size, region):
    return (size.get('slug')==SIZE and size.get('available') is True
            and region in size.get('regions',[]) and size.get('memory')==512
            and size.get('disk')==10 and size.get('vcpus')==1
            and size.get('price_monthly')==4 and size.get('transfer',0)>=.5)


def get(path, token):
    url=urllib.parse.urljoin(BASE,path)
    parsed=urllib.parse.urlsplit(url)
    if parsed.scheme!='https' or parsed.netloc!='api.digitalocean.com':
        raise ValueError('Untrusted API destination')
    req=urllib.request.Request(url,headers={'Authorization':'Bearer '+token,'Accept':'application/json'})
    with urllib.request.urlopen(req,timeout=20) as response:
        return json.load(response)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--region',default='nyc3')
    args=parser.parse_args()
    token=os.environ.get('DIGITALOCEAN_TOKEN')
    if not token: parser.exit(2,'No DIGITALOCEAN_TOKEN binding; no API calls made. Do not send tokens in chat.\n')
    try:
        account=get('/v2/account',token)['account']
        if account.get('status')!='active':raise ValueError('Account is not active')
        path='/v2/sizes?per_page=200'
        while path:
            data=get(path,token)
            for size in data['sizes']:
                if approved_size(size,args.region):
                    print(json.dumps({'size':SIZE,'region':args.region,'usd_monthly_base':4,'memory_mib':512,'disk_gib':10,'included_transfer_tb':size['transfer'],'paid':True,'created_resources':False,'notes':'Availability is not a reservation. Taxes, domain, excess transfer and unassigned reserved IPv4 excluded. Explicit budget approval still required.'},indent=2))
                    return 0
            path=data.get('links',{}).get('pages',{}).get('next')
        raise ValueError('Exact $4 size/region unavailable or pricing/resources changed; stop, do not substitute another size.')
    except urllib.error.HTTPError as exc:
        parser.exit(1,f'API HTTP {exc.code}; no resource created.\n')
    except (ValueError,OSError,KeyError) as exc:
        parser.exit(1,f'Preflight failed ({type(exc).__name__}); inspect account/region without exposing credentials. No resource created.\n')


if __name__=='__main__': raise SystemExit(main())
