
const fs = require('node:fs')
const fse = require('fs-extra')

const appPaths = require('../../app-paths.js')
const { log, warn } = require('../../helpers/logger.js')
const nodePackager = require('../../helpers/node-packager.js')
const hasTypescript = require('../../helpers/has-typescript.js')
const { hasEslint } = require('../../helpers/has-eslint.js')

const defaultVersion = '^6.5.0'

const pwaDeps = {
  'workbox-core': defaultVersion,
  'workbox-routing': defaultVersion,
  'workbox-strategies': defaultVersion,
  'workbox-expiration': defaultVersion,
  'workbox-precaching': defaultVersion,
  'workbox-cacheable-response': defaultVersion,
  'workbox-build': defaultVersion
}

function isInstalled () {
  return fs.existsSync(appPaths.pwaDir)
}

function add (silent) {
  if (isInstalled()) {
    if (silent !== true) {
      warn('PWA support detected already. Aborting.')
    }
    return
  }

  nodePackager.installPackage(
    Object.entries(pwaDeps).map(([ name, version ]) => `${ name }@${ version }`),
    { isDevDependency: true, displayName: 'PWA dependencies' }
  )

  log('Creating PWA source folder...')

  const format = hasTypescript ? 'ts' : 'default'
  fse.copySync(
    appPaths.resolve.cli(`templates/pwa/${ format }`),
    appPaths.pwaDir,
    // Copy .eslintrc.js only if the app has ESLint
    hasEslint === true && format === 'ts' ? { filter: src => !src.endsWith('/.eslintrc.js') } : void 0
  )

  fse.copySync(
    appPaths.resolve.cli('templates/pwa/pwa-flag.d.ts'),
    appPaths.resolve.pwa('pwa-flag.d.ts')
  )

  log('Copying PWA icons to /public/icons/ (if they are not already there)...')
  fse.copySync(
    appPaths.resolve.cli('templates/pwa-icons'),
    appPaths.resolve.app('public/icons'),
    { overwrite: false }
  )

  log('PWA support was added')
}

function remove () {
  if (!isInstalled()) {
    warn('No PWA support detected. Aborting.')
    return
  }

  log('Removing PWA source folder')
  fse.removeSync(appPaths.pwaDir)

  nodePackager.uninstallPackage(Object.keys(pwaDeps), {
    displayName: 'PWA dependencies'
  })

  log('PWA support was removed')
}

module.exports = {
  isInstalled,
  add,
  remove
}
