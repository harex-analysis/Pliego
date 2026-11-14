import { packager } from '@electron/packager';
import { flipFuses, FuseVersion, FuseV1Options } from '@electron/fuses';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { prepareVendor } from './vendor.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
await prepareVendor();
const outputs = await packager({
  dir: root,
  out: path.join(root, 'dist'),
  name: 'Pliego',
  platform: 'win32',
  arch: 'x64',
  overwrite: true,
  asar: true,
  icon: path.join(root, 'assets', 'pliego.ico'),
  extraResource: ['vendor', 'licenses', 'THIRD-PARTY.md'].map(name => path.join(root, name)),
  ignore: filename => filename === '/assets/giro-de-pagina.gif' ||
    (filename !== '' && !/^\/(?:src(?:\/|$)|assets(?:\/|$)|LICENSE$|package\.json$|node_modules(?:\/|$))/.test(filename)),
  win32metadata: {
    FileDescription: 'Pliego · Lector de cómics',
    ProductName: 'Pliego'
  }
});
for (const output of outputs) {
  await flipFuses(path.join(output, 'Pliego.exe'), {
    version: FuseVersion.V1,
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
    [FuseV1Options.OnlyLoadAppFromAsar]: true
  });
}
console.log(outputs.map(output => path.join(output, 'Pliego.exe')).join('\n'));
