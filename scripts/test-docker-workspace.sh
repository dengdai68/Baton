#!/usr/bin/env bash
# Run from the checkout on a Linux Docker host with curl, openssl and jq.
set -euo pipefail
cd "$(dirname "$0")/.."
umask 077
scratch=$(mktemp -d)
name=baton-qa-$(basename "$scratch" | tr '[:upper:].' '[:lower:]-')
server=$name-server
relay=$name-relay
root=/home/node/.baton
network=$name-net
cleanup() {
  docker rm -f "$server" "$relay" >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
  docker volume rm "$name-http" "$name-https" "$name-cloud" >/dev/null 2>&1 || true
  docker image rm "$server" "$relay" >/dev/null 2>&1 || true
  rm -r "$scratch"
}
trap cleanup EXIT
docker build -f server/Dockerfile -t "$server" .
docker build -f relay/Dockerfile -t "$relay" relay
docker network create "$network" >/dev/null
echo "PASS both images built"

openssl rand -hex 24 > "$scratch/password"
openssl req -x509 -newkey rsa:2048 -nodes -days 2 -subj /CN=Baton-QA-CA \
  -keyout "$scratch/ca.key" -out "$scratch/ca.crt" 2>/dev/null
chmod 644 "$scratch/ca.crt"
for host in workspace.test relay.test; do
  mkdir -m 750 "$scratch/$host"
  openssl req -new -newkey rsa:2048 -nodes -subj "/CN=$host" \
    -keyout "$scratch/$host/key.pem" -out "$scratch/request" 2>/dev/null
  echo "subjectAltName=DNS:$host" > "$scratch/ext"
  openssl x509 -req -days 2 -in "$scratch/request" -CA "$scratch/ca.crt" -CAkey "$scratch/ca.key" \
    -CAcreateserial -extfile "$scratch/ext" -out "$scratch/$host/cert.pem" 2>/dev/null
  chmod 640 "$scratch/$host/"*.pem
done
group=(--group-add "$(id -g)")
tls=(-v "$scratch/workspace.test:/tls:ro")
admin() { docker exec "$server" node server/workspace-admin.mjs relay "$root" "$@"; }
operator_cli() {
  docker exec -i "$server" node cli/main.mjs --endpoint-file "$root/desktop-endpoint.json" \
    --session-file "$root/cli-session.json" "$@"
}
operator_login() {
  operator_cli auth login --username operator --password-stdin < "$scratch/password" >/dev/null
}
start_server() {
  docker run -d --name "$server" --network "$network" --network-alias workspace.test "${group[@]}" \
    "${volume[@]}" "${service_tls[@]}" -v "$scratch/ca.crt:/ca.crt:ro" -e NODE_EXTRA_CA_CERTS=/ca.crt \
    -p 127.0.0.1::9443 "$server" >/dev/null
  local published
  published=$(docker port "$server" 9443/tcp)
  direct=(curl -fsS --max-time 10 --noproxy '*' --cacert "$scratch/ca.crt" --connect-to "workspace.test:9443:$published")
  url="$protocol://workspace.test:9443"
  for ((i=0;i<60;i++)); do
    if "${direct[@]}" "$url/healthz" 2>/dev/null | jq -e '.status=="ready"' >/dev/null; then return; fi
    sleep 1
  done
  docker logs --tail 10 "$server" >&2
  return 1
}
for protocol in http https; do
  volume=(-v "$name-$protocol:/home/node")
  service_tls=()
  config=()
  if [[ $protocol == https ]]; then service_tls=("${tls[@]}"); config=(/tls/cert.pem /tls/key.pem); fi
  docker run --rm "${group[@]}" "${volume[@]}" "${service_tls[@]}" "$server" init "$root" local \
    "$protocol://workspace.test:9443" 9443 0.0.0.0 "${config[@]}" >/dev/null
  docker run --rm -i "${volume[@]}" "$server" operator "$root" operator < "$scratch/password"
  start_server
  jq -Rs '{name:"operator",password:rtrimstr("\n"),bearer:true}' "$scratch/password" | \
    "${direct[@]}" -H 'Content-Type: application/json' --data-binary @- "$url/login" > "$scratch/login"
  jq -er '.token | "Authorization: Bearer "+.' "$scratch/login" > "$scratch/header"
  "${direct[@]}" -H @"$scratch/header" "$url/api/settings/current-workspace" | jq -e '.username=="operator"' >/dev/null
  status=$("${direct[@]}" --no-fail -o /dev/null -w '%{http_code}' -H @"$scratch/header" "$url/api/account/relay")
  [[ $status == 403 ]]
  if admin status >/dev/null 2>&1; then echo "Unexpected operator access before login" >&2; exit 1; fi
  operator_login
  team=$(echo '{"name":"Volume proof","memberAgentIds":[]}' | operator_cli teams create --file - --json | jq -er 'first(..|objects|select(.name=="Volume proof")|.id)')
  docker rm -f "$server" >/dev/null
  start_server
  operator_login
  operator_cli teams get "$team" --json | jq -e --arg id "$team" 'any(..|objects; .id==$id and .name=="Volume proof")' >/dev/null
  "${direct[@]}" -H @"$scratch/header" "$url/api/settings/current-workspace" | jq -e '.username=="operator"' >/dev/null
  echo "PASS $protocol login, authenticated API, remote management denied, business record and session survive container recreation"
  if [[ $protocol == http ]]; then docker rm -f "$server" >/dev/null; fi
done

pin=$(admin status | jq -er '.pin | select(test("^[0-9a-f]{64}$"))')
jq -n --arg pin "$pin" '{bind:"0.0.0.0",port:8443,cert:"/config/cert.pem",key:"/config/key.pem",allow:[$pin]}' > "$scratch/relay.test/relay.json"
chmod 640 "$scratch/relay.test/relay.json"
docker run -d --name "$relay" --network "$network" --network-alias relay.test "${group[@]}" \
  -p 127.0.0.1::8443 -v "$scratch/relay.test:/config:ro" "$relay" /config/relay.json >/dev/null
if admin set http://relay.test:8443 >/dev/null 2>&1; then echo "Unexpected HTTP Relay origin" >&2; exit 1; fi
admin set https://relay.test:8443 >/dev/null
for ((i=0;i<45;i++)); do
  if admin status | jq -e '.registered' >/dev/null; then break; fi
  sleep 1
done
admin status | jq -e '.registered' >/dev/null
published=$(docker port "$relay" 8443/tcp)
if curl -sS --noproxy '*' --max-time 5 "http://$published/" -o /dev/null 2>/dev/null; then
  echo "Unexpected cleartext response from Relay" >&2; exit 1
fi
echo "PASS HTTPS Relay registered, cleartext rejected"
# A separate ephemeral client receives only the invitation and the public CA.
# Its private key is generated inside its own container.
cp tests/relay-client.mjs "$scratch/relay-client.mjs"
chmod 644 "$scratch/relay-client.mjs"
admin invite | docker run --rm -i --network "$network" --entrypoint node \
  -v "$scratch/ca.crt:/ca.crt:ro" -v "$scratch/relay-client.mjs:/opt/baton/tests/relay-client.mjs:ro" \
  "$server" --input-type=module -e '
  import assert from "node:assert/strict";
  import {readFileSync} from "node:fs";
  import {serviceIdentity} from "./server/relay-account.mjs";
  import {call} from "./tests/relay-client.mjs";
  const invite = new URL(JSON.parse(readFileSync(0,"utf8")).link);
  const target = Object.fromEntries(invite.searchParams);
  const origin = "https://"+target.relay, ca=readFileSync("/ca.crt"), phone=serviceIdentity("/tmp/phone");
  const session = await call(origin,ca,phone,target,"/relay/redeem",{t:target.t,device:"Container phone"});
  assert.equal(session.status,200); assert.equal(session.user,"operator");
  const info=await call(origin,ca,phone,{fp:target.fp,r:session.channel},"/api/settings/current-workspace",null,session.token);
  assert.equal(info.status,200); assert.equal(info.username,"operator");
'
channel=$(admin status | jq -er '.devices[] | select(.label=="Container phone") | .id')
admin remove "$channel" | jq -e '.ok // (.devices|length==0)' >/dev/null
admin status | jq -e '.devices|length==0' >/dev/null
echo "PASS end-to-end pairing, authenticated account read and operator removal"

docker rm -f "$server" >/dev/null
protocol=http
volume=(-v "$name-cloud:/home/node")
service_tls=()
docker run --rm "${volume[@]}" "$server" init "$root" cloud http://workspace.test:9443 9443 0.0.0.0 >/dev/null
docker run --rm -i "${volume[@]}" "$server" operator "$root" operator < "$scratch/password"
docker run --rm -i "${volume[@]}" "$server" member "$root" alice < "$scratch/password"
start_server
jq -Rs '{name:"alice",password:rtrimstr("\n"),bearer:true}' "$scratch/password" | \
  "${direct[@]}" -H 'Content-Type: application/json' --data-binary @- "$url/login" > "$scratch/cloud-login"
jq -er '.token | "Authorization: Bearer "+.' "$scratch/cloud-login" > "$scratch/cloud-header"
"${direct[@]}" -H @"$scratch/cloud-header" "$url/api/settings/current-workspace" | jq -e '.username=="alice"' >/dev/null
operator_login
if admin status >"$scratch/cloud-relay" 2>&1; then echo "Unexpected single-account Relay in cloud mode" >&2; exit 1; fi
grep -q '请在 Mac 登录后管理 Relay' "$scratch/cloud-relay"
echo "PASS cloud member direct login; operator cannot attach the single-account Relay"
