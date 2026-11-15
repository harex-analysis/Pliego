const repository = 'harex-analysis/Pliego';
const releasesApi = 'https://api.github.com/repos/' + repository + '/releases?per_page=20';
const releasesPage = 'https://github.com/' + repository + '/releases';
const installer = 'Pliego-Setup-x64.exe';

function versionParts(value) {
  if (typeof value !== 'string' || value.trim() !== value ||
      !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)) return null;
  const parts = value.split('.').map(Number);
  return parts.every(Number.isSafeInteger) ? parts : null;
}

function compareVersions(left, right) {
  return left[0] - right[0] || left[1] - right[1] || left[2] - right[2];
}

function newestUpdate(releases, installed) {
  let newest = null;
  let highest = versionParts(installed);
  if (!highest || !Array.isArray(releases)) return null;
  for (const release of releases) {
    if (release?.draft !== false || !Array.isArray(release.assets) ||
        typeof release.tag_name !== 'string' || !release.tag_name.startsWith('v')) continue;
    const version = release.tag_name.slice(1);
    const parts = versionParts(version);
    if (!parts || compareVersions(parts, highest) <= 0) continue;
    const expected = releasesPage + '/download/v' + version + '/' + installer;
    if (!release.assets.some(asset => asset?.name === installer && asset.state === 'uploaded' &&
        asset.browser_download_url === expected)) continue;
    highest = parts;
    newest = { version, prerelease: release.prerelease === true };
  }
  return newest;
}

function createUpdateCheck(installed, fetchRelease) {
  let result;
  let available;

  async function check() {
    try {
      const response = await fetchRelease(releasesApi, {
        headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
        credentials: 'omit',
        redirect: 'error',
        signal: AbortSignal.timeout(6000)
      });
      if (response.ok) available = newestUpdate(await response.json(), installed);
    } catch {} // Update checks are optional when GitHub or the network is unavailable.
    return available ?? null;
  }

  return {
    check: () => result ??= check(),
    releasePage: () => available ? releasesPage + '/tag/v' + available.version : null
  };
}

module.exports = { createUpdateCheck };
