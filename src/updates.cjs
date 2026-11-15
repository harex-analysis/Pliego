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
  let lastResult;
  let inFlight;
  let lastManualCheck = -Infinity;
  let available;

  async function request() {
    try {
      const response = await fetchRelease(releasesApi, {
        headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
        credentials: 'omit',
        redirect: 'error',
        signal: AbortSignal.timeout(6000)
      });
      if (response.ok) {
        const releases = await response.json();
        if (Array.isArray(releases)) {
          available = newestUpdate(releases, installed);
          return available ? { status: 'available', update: available } : { status: 'current' };
        }
      }
    } catch {} // Update checks are optional when GitHub or the network is unavailable.
    return { status: 'unavailable' };
  }

  function check(manual = false) {
    if (inFlight) return inFlight;
    const now = Date.now();
    if (lastResult && (!manual || now - lastManualCheck < 750)) return Promise.resolve(lastResult);
    if (manual) lastManualCheck = now;
    inFlight = request().then(result => {
      lastResult = result;
      inFlight = undefined;
      return result;
    });
    return inFlight;
  }

  return {
    check: async () => (await check()).update ?? null,
    refresh: () => check(true),
    releasePage: () => available ? releasesPage + '/tag/v' + available.version : null,
    notesPage: () => releasesPage
  };
}

module.exports = { createUpdateCheck };
