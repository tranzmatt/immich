# Immich Exact Duplicates

Read-only companion UI for finding byte-for-byte duplicate assets using checksums Immich has already computed.

## Run

Create an Immich API key with asset-read access, then provide it through the environment (never through the browser):

```bash
docker build -t immich-exact-duplicates .
docker run --rm -p 3210:3210 \
  -e IMMICH_URL=http://immich-server:2283 \
  -e IMMICH_API_KEY \
  -e APP_USERNAME \
  -e APP_PASSWORD \
  immich-exact-duplicates
```

### LAN-ready Compose

Copy the example without committing the resulting secrets file, fill it in locally, and start the service:

```bash
cp .env.example .env
# Edit .env locally. Do not paste its secrets into chat or commit it.
docker compose up -d --build
docker compose ps
```

The Compose port mapping binds to `0.0.0.0`, so other devices on the LAN can reach this host. On the current host, the expected URL is:

```text
http://192.168.50.110:3210
```

If the host address changes, use its current LAN address with port `3210`. Permit TCP port 3210 in the host firewall for the local subnet if a firewall is enabled; do not expose it on the public internet. The companion has its own Basic-auth login, but production LAN use should still be placed behind HTTPS where practical.

To display the optional Immich Utilities entry, build the Immich web image with:

```bash
PUBLIC_EXACT_DUPLICATES_URL=http://192.168.50.110:3210
```

The link opens in a new tab, so no cross-origin browser access or CORS configuration is required.

Build the Immich web app with `PUBLIC_EXACT_DUPLICATES_URL` set to the externally reachable companion URL to show an **Exact duplicates** entry under Utilities. If the variable is unset, Immich is unchanged.

## Current scope

- Read-only; it never changes or deletes an asset.
- Filters videos or images.
- Uses existing exact SHA-1 checksums for Immich-managed assets.
- Groups external-library assets by file size, then reads and hashes only size-collision candidates with BLAKE3.
- Mounts the configured external libraries read-only and defaults to two concurrent hash processes to limit network-storage load.
- Uses HTTP Basic authentication in front of the companion UI. Put it behind HTTPS in production.
