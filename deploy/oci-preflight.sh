#!/bin/sh
# Read-only. Run in authenticated Oracle Cloud Shell. Never provisions resources.
set -eu
[ "$#" = 3 ] || { echo 'Usage: oci-preflight.sh TENANCY_OCID COMPARTMENT_OCID REGION' >&2; exit 2; }
tenancy=$1
compartment=$2
region=$3
command -v oci >/dev/null
out=$(mktemp -d)
chmod 700 "$out"
oci --region "$region" iam region-subscription list --tenancy-id "$tenancy" --all > "$out/regions.json"
python3 - "$out/regions.json" "$region" <<'PY'
import json,sys
regions=json.load(open(sys.argv[1]))['data']
home=[r['region-name'] for r in regions if r['is-home-region']]
if home != [sys.argv[2]]:
 raise SystemExit('STOP: select the tenancy home region before considering Always Free.')
print('Home region confirmed:',home[0])
PY
oci --region "$region" iam availability-domain list --compartment-id "$tenancy" --all > "$out/domains.json"
oci --region "$region" compute shape list --compartment-id "$compartment" --all > "$out/shapes.json"
oci --region "$region" compute instance list --compartment-id "$compartment" --all > "$out/instances.json"
oci --region "$region" limits value list --compartment-id "$tenancy" --service-name compute --all > "$out/compute-limits.json"
python3 - "$out" <<'PY'
import json,sys
from pathlib import Path
p=Path(sys.argv[1]); shapes=json.loads((p/'shapes.json').read_text())['data']
print('Eligible-shape candidates listed:',sorted({s['shape'] for s in shapes if s['shape'] in ('VM.Standard.A1.Flex','VM.Standard.E2.1.Micro')}))
print('Read-only reports:',p)
print('NOT confirmed: physical capacity, free account balance, usage in other compartments, image eligibility, pricing or traffic remaining.')
print('Do not launch before checking those items in the Console. This script creates no resources.')
PY
