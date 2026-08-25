#!/usr/bin/env bash
set -euo pipefail

DEVICE_ID="${IOS_DEVICE_ID:-00008150-001668D61181401C}"
BUNDLE_ID="${IOS_BUNDLE_ID:-com.alexkubica.fitnesscoach}"
BACKEND_URL="${FITNESS_BACKEND_URL:-https://fitness-ten-fawn.vercel.app}"
USER_ID="${FITNESS_HEALTH_USER_ID:-user_alex}"
KEYCHAIN_SERVICE="${FITNESS_AUTH_PRIVATE_JWK_KEYCHAIN_SERVICE:-fitness-auth-private-jwk}"
OAUTH_LOGIN_CODE_KEYCHAIN_SERVICE="${FITNESS_OAUTH_LOGIN_CODE_KEYCHAIN_SERVICE:-fitness-oauth-private-login-code}"
OAUTH_CLIENT_ID="${FITNESS_HEALTH_OAUTH_CLIENT_ID:-fitness-ios-bootstrap}"
OAUTH_REDIRECT_URI="${FITNESS_HEALTH_OAUTH_REDIRECT_URI:-fitnesscoach://oauth/callback}"
OAUTH_SCOPE="${FITNESS_HEALTH_OAUTH_SCOPE:-health:sync meal:write coach:write}"
AUTH_MODE="${FITNESS_IOS_AUTH_MODE:-oauth}"
TTL_SECONDS="${FITNESS_HEALTH_SYNC_TOKEN_TTL_SECONDS:-3600}"
INSTALL_BEFORE_LAUNCH="${FITNESS_IOS_INSTALL_BEFORE_LAUNCH:-1}"
PROJECT_PATH="${FITNESS_IOS_PROJECT_PATH:-apps/ios/FitnessCoach.xcodeproj}"
SCHEME="${FITNESS_IOS_SCHEME:-FitnessCoach}"
CONFIGURATION="${FITNESS_IOS_CONFIGURATION:-Debug}"
DERIVED_DATA_PATH="${FITNESS_IOS_DERIVED_DATA_PATH:-DerivedData/FitnessCoachDevice}"
APP_PATH="$DERIVED_DATA_PATH/Build/Products/$CONFIGURATION-iphoneos/FitnessCoach.app"
BUILD_DESTINATION="${FITNESS_IOS_BUILD_DESTINATION:-generic/platform=iOS}"
DEVICE_CONNECT_TIMEOUT="${FITNESS_IOS_DEVICE_CONNECT_TIMEOUT:-60}"
RESOLVED_DEVICE_ID="$DEVICE_ID"
RESOLVED_DEVICE_NAME="$DEVICE_ID"

print_device_recovery() {
  cat >&2 <<EOF
CoreDevice could not keep a usable connection to the iPhone.

Recovery:
- Unlock the iPhone and keep the screen awake.
- Prefer USB for this install if wireless install is flaky.
- If using wireless, keep the Mac and iPhone on the same Wi-Fi and disable VPN/hotspot routing.
- Reopen Xcode > Window > Devices and Simulators and wait for the phone to appear connected.
- Rerun this script after 'xcrun devicectl list devices' shows the phone.

You can omit IOS_DEVICE_ID and let the script use the default hardware UDID, or pass either the hardware UDID or CoreDevice identifier.
EOF
}

require_device_available() {
  local devices_json
  devices_json="$(mktemp -t fitness-devices.XXXXXX.json)"

  if ! xcrun devicectl list devices --json-output "$devices_json" >/dev/null; then
    rm -f "$devices_json"
    echo "Could not list CoreDevice devices with devicectl." >&2
    exit 1
  fi

  local device_status
  if ! device_status="$(
    DEVICE_ID="$DEVICE_ID" DEVICES_JSON="$devices_json" node --input-type=module <<'NODE'
import fs from "node:fs";

const requestedDeviceId = process.env.DEVICE_ID ?? "";
const devicesJsonPath = process.env.DEVICES_JSON;

if (!devicesJsonPath) {
  throw new Error("DEVICES_JSON is required.");
}

const devices = JSON.parse(fs.readFileSync(devicesJsonPath, "utf8")).result?.devices ?? [];
const matchesIdentifier = (device, value) => {
  const values = [
    device.identifier,
    device.hardwareProperties?.udid,
    device.hardwareProperties?.serialNumber,
    String(device.hardwareProperties?.ecid ?? ""),
    device.deviceProperties?.name,
    ...(device.connectionProperties?.potentialHostnames ?? []),
  ].filter(Boolean);

  return values.includes(value);
};

const device = devices.find((candidate) => matchesIdentifier(candidate, requestedDeviceId));

if (!device) {
  console.log("missing");
  process.exit(0);
}

const identifier = device.identifier;
const udid = device.hardwareProperties?.udid ?? "";
const tunnelState = device.connectionProperties?.tunnelState ?? "unknown";
const pairingState = device.connectionProperties?.pairingState ?? "unknown";
const name = device.deviceProperties?.name ?? device.identifier ?? requestedDeviceId;

console.log(JSON.stringify({ identifier, udid, name, tunnelState, pairingState }));
NODE
  )"; then
    rm -f "$devices_json"
    echo "Could not parse CoreDevice device list." >&2
    exit 1
  fi

  rm -f "$devices_json"

  if [[ "$device_status" == "missing" ]]; then
    echo "Device $DEVICE_ID is not currently visible to devicectl." >&2
    print_device_recovery
    exit 1
  fi

  local resolved_device_id resolved_udid tunnel_state pairing_state device_name
  IFS=$'\t' read -r resolved_device_id resolved_udid device_name tunnel_state pairing_state <<<"$(
    DEVICE_STATUS="$device_status" node --input-type=module <<'NODE'
const status = JSON.parse(process.env.DEVICE_STATUS ?? "{}");
console.log([
  status.identifier,
  status.udid,
  status.name,
  status.tunnelState,
  status.pairingState,
].join("\t"));
NODE
  )"

  RESOLVED_DEVICE_ID="$resolved_device_id"
  RESOLVED_DEVICE_NAME="$device_name"

  if [[ "$tunnel_state" == "unavailable" ]]; then
    echo "Device '$device_name' ($DEVICE_ID) is paired but currently unavailable to CoreDevice." >&2
    print_device_recovery
    exit 1
  fi

  if [[ "$pairing_state" != "paired" ]]; then
    echo "Device '$device_name' ($DEVICE_ID) is not paired; current pairing state is '$pairing_state'." >&2
    exit 1
  fi

  if [[ "$DEVICE_ID" != "$RESOLVED_DEVICE_ID" && "$DEVICE_ID" != "$resolved_udid" ]]; then
    echo "Resolved requested device '$DEVICE_ID' to '$device_name' ($RESOLVED_DEVICE_ID)." >&2
  fi
}

prepare_device_connection() {
  echo "Preparing CoreDevice connection to '$RESOLVED_DEVICE_NAME' ($RESOLVED_DEVICE_ID)..."

  if ! xcrun devicectl device info lockState \
    --device "$RESOLVED_DEVICE_ID" \
    --timeout "$DEVICE_CONNECT_TIMEOUT" \
    >/dev/null; then
    echo "Could not prepare CoreDevice services for '$RESOLVED_DEVICE_NAME' within ${DEVICE_CONNECT_TIMEOUT}s." >&2
    print_device_recovery
    exit 1
  fi
}

if [[ "$INSTALL_BEFORE_LAUNCH" == "1" ]]; then
  echo "Building latest iOS app with destination '$BUILD_DESTINATION'..."
  xcodebuild build \
    -quiet \
    -project "$PROJECT_PATH" \
    -scheme "$SCHEME" \
    -configuration "$CONFIGURATION" \
    -destination "$BUILD_DESTINATION" \
    -derivedDataPath "$DERIVED_DATA_PATH" \
    -allowProvisioningUpdates

  if [[ ! -d "$APP_PATH" ]]; then
    echo "Built app not found at $APP_PATH" >&2
    exit 1
  fi

  require_device_available
  prepare_device_connection

  echo "Installing latest iOS app on '$RESOLVED_DEVICE_NAME' ($RESOLVED_DEVICE_ID)..."
  if ! xcrun devicectl device install app \
    --device "$RESOLVED_DEVICE_ID" \
    --quiet \
    "$APP_PATH"; then
    print_device_recovery
    exit 1
  fi
fi

REFRESH_TOKEN=""

if [[ "$AUTH_MODE" == "oauth" ]]; then
  LOGIN_CODE="$(security find-generic-password -w -s "$OAUTH_LOGIN_CODE_KEYCHAIN_SERVICE" 2>/dev/null || true)"

  if [[ -z "$LOGIN_CODE" ]]; then
    echo "OAuth login code was not found in Keychain item $OAUTH_LOGIN_CODE_KEYCHAIN_SERVICE" >&2
    exit 1
  fi

  TOKEN_RESPONSE="$(
      BACKEND_URL="$BACKEND_URL" \
      OAUTH_CLIENT_ID="$OAUTH_CLIENT_ID" \
      OAUTH_REDIRECT_URI="$OAUTH_REDIRECT_URI" \
      OAUTH_LOGIN_CODE="$LOGIN_CODE" \
      OAUTH_SCOPE="$OAUTH_SCOPE" \
      node --input-type=module <<'NODE'
import { createHash, randomBytes } from "node:crypto";

const backendURL = process.env.BACKEND_URL;
const clientId = process.env.OAUTH_CLIENT_ID;
const redirectUri = process.env.OAUTH_REDIRECT_URI;
const loginCode = process.env.OAUTH_LOGIN_CODE;
const scope = process.env.OAUTH_SCOPE;

if (!backendURL || !clientId || !redirectUri || !loginCode || !scope) {
  throw new Error("Missing OAuth launch configuration.");
}

const codeVerifier = randomBytes(32).toString("base64url");
const codeChallenge = createHash("sha256")
  .update(codeVerifier)
  .digest("base64url");
const authorizeBody = new URLSearchParams({
  response_type: "code",
  client_id: clientId,
  redirect_uri: redirectUri,
  resource: backendURL,
  scope,
  state: randomBytes(16).toString("base64url"),
  code_challenge: codeChallenge,
  code_challenge_method: "S256",
  login_code: loginCode,
});
const authorizeResponse = await fetch(new URL("/oauth2/authorize", backendURL), {
  method: "POST",
  headers: {
    "content-type": "application/x-www-form-urlencoded",
  },
  body: authorizeBody,
  redirect: "manual",
});

if (authorizeResponse.status !== 302) {
  throw new Error(`OAuth authorization failed with HTTP ${authorizeResponse.status}.`);
}

const location = authorizeResponse.headers.get("location");

if (!location) {
  throw new Error("OAuth authorization did not return a redirect location.");
}

const code = new URL(location).searchParams.get("code");

if (!code) {
  throw new Error("OAuth authorization redirect did not include a code.");
}

const tokenBody = new URLSearchParams({
  grant_type: "authorization_code",
  client_id: clientId,
  redirect_uri: redirectUri,
  code,
  code_verifier: codeVerifier,
});
const tokenResponse = await fetch(new URL("/oauth2/token", backendURL), {
  method: "POST",
  headers: {
    "content-type": "application/x-www-form-urlencoded",
  },
  body: tokenBody,
});

if (!tokenResponse.ok) {
  throw new Error(`OAuth token exchange failed with HTTP ${tokenResponse.status}.`);
}

process.stdout.write(JSON.stringify(await tokenResponse.json()));
NODE
  )"
  TOKEN_FIELDS="$(
    TOKEN_RESPONSE="$TOKEN_RESPONSE" node --input-type=module <<'NODE'
const response = JSON.parse(process.env.TOKEN_RESPONSE ?? "{}");

if (!response.access_token || !response.refresh_token || !response.expires_in) {
  throw new Error("OAuth token response is missing required fields.");
}

console.log([
  response.access_token,
  response.refresh_token,
  response.scope,
  Math.floor(Date.now() / 1000) + Number(response.expires_in),
].join("\t"));
NODE
  )"
  IFS=$'\t' read -r TOKEN REFRESH_TOKEN TOKEN_SCOPE TOKEN_EXPIRES_AT <<<"$TOKEN_FIELDS"
else
  npm run build -w @fitness/auth >/dev/null

  TOKEN="$(
    FITNESS_AUTH_PRIVATE_JWK_KEYCHAIN_SERVICE="$KEYCHAIN_SERVICE" \
      npm --silent run issue-token -w @fitness/auth -- \
        --profile healthkit \
        --issuer "$BACKEND_URL" \
        --resource "$BACKEND_URL" \
        --scope health:sync \
        --scope meal:write \
        --scope coach:write \
        --ttl-seconds "$TTL_SECONDS" \
        --raw
  )"
  TOKEN_SCOPE="$OAUTH_SCOPE"
  TOKEN_EXPIRES_AT="$(( $(date +%s) + TTL_SECONDS ))"
fi

echo "Launching $BUNDLE_ID with live HealthKit upload enabled..."
require_device_available
prepare_device_connection

if ! DEVICECTL_CHILD_FITNESS_BACKEND_URL="$BACKEND_URL" \
  DEVICECTL_CHILD_ALLOW_LIVE_HEALTH_DATA="1" \
  DEVICECTL_CHILD_ALLOW_HOSTED_HEALTH_BACKEND="1" \
  DEVICECTL_CHILD_FITNESS_HEALTH_USER_ID="$USER_ID" \
  DEVICECTL_CHILD_FITNESS_HEALTH_OAUTH_CLIENT_ID="$OAUTH_CLIENT_ID" \
  DEVICECTL_CHILD_FITNESS_HEALTH_SYNC_TOKEN="$TOKEN" \
  DEVICECTL_CHILD_FITNESS_HEALTH_REFRESH_TOKEN="$REFRESH_TOKEN" \
  DEVICECTL_CHILD_FITNESS_HEALTH_TOKEN_SCOPE="$TOKEN_SCOPE" \
  DEVICECTL_CHILD_FITNESS_HEALTH_TOKEN_EXPIRES_AT="$TOKEN_EXPIRES_AT" \
  xcrun devicectl device process launch \
  --device "$RESOLVED_DEVICE_ID" \
  --terminate-existing \
  "$BUNDLE_ID"; then
  echo "Launch failed. If the error mentions Locked, unlock the iPhone, keep it awake, then rerun with FITNESS_IOS_INSTALL_BEFORE_LAUNCH=0 to skip reinstalling." >&2
  print_device_recovery
  exit 1
fi
