/**
 * Displayed build identity — shown in the page footers so you can always tell
 * exactly what's deployed.
 *
 * APP_VERSION tracks package.json — bump both together on feature releases.
 * APP_BUILD is the short git SHA injected at Docker build time via the
 * NEXT_PUBLIC_APP_VERSION build-arg (see Dockerfile + docker-publish.yml);
 * the 7-char slice matches the `sha-xxxxxxx` GHCR image tags. Local builds
 * without the env var report "dev".
 */
export const APP_VERSION = "v0.4.0";
export const APP_BUILD = (process.env.NEXT_PUBLIC_APP_VERSION ?? "dev").slice(0, 7);
