const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', '..');
const pkg = JSON.parse(fs.readFileSync(path.join(DIR, 'package.json'), 'utf8'));
const lock = JSON.parse(fs.readFileSync(path.join(DIR, 'package-lock.json'), 'utf8'));

describe('version and installer identity', () => {
  it('the app is version 0.1.1, the same in package.json and package-lock.json', () => {
    assert.equal(pkg.version, '0.1.1');
    assert.equal(lock.version, pkg.version);
    assert.equal(lock.packages[''].version, pkg.version);
  });

  it('the installer is named from productName and version: Seed Management Setup 0.1.1.exe', () => {
    // electron-builder's NSIS default is "${productName} Setup ${version}.${ext}";
    // nothing overrides it, so the version above is the only input.
    assert.equal(pkg.build.nsis.artifactName, undefined);
    assert.equal(pkg.build.win.artifactName, undefined);
    assert.equal(pkg.build.artifactName, undefined);
    assert.equal(pkg.build.extraMetadata, undefined, 'no second version source');
    assert.equal(`${pkg.build.productName} Setup ${pkg.version}.exe`, 'Seed Management Setup 0.1.1.exe');
  });

  it('keeps the identity that lets a new version install over the old one', () => {
    assert.equal(pkg.build.appId, 'com.daptariagro.seedmanagement');
    assert.equal(pkg.build.productName, 'Seed Management');
    assert.equal(pkg.name, 'weighingdesktop', 'the per-user data folder is named after this');
    assert.equal(pkg.build.nsis.perMachine, false);
  });

  it('the server address still comes only from production.config.json', () => {
    const cfg = JSON.parse(fs.readFileSync(path.join(DIR, 'production.config.json'), 'utf8'));
    assert.deepEqual(Object.keys(cfg), ['apiUrl']);
    assert.equal(cfg.apiUrl, 'https://weighingqrauto-backend.onrender.com');
    assert.ok(pkg.build.files.includes('production.config.json'));
  });

  it('the UI shows the version the main process reports (app.getVersion), next to the configured server', () => {
    const main = fs.readFileSync(path.join(DIR, 'electron', 'main.js'), 'utf8');
    assert.match(main, /'app\.info': \(\) => \(\{ \.\.\.core\.getColumns\(\), version: app\.getVersion\(\), apiUrl: core\.apiUrl,/);
  });
});
