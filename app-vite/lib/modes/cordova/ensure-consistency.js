const fs = require('node:fs')
const fse = require('fs-extra')

const appPaths = require('../../app-paths.js')
const { spawnSync } = require('../../helpers/spawn.js')
const { log, fatal } = require('../../helpers/logger.js')

function ensureWWW (forced) {
  const www = appPaths.resolve.cordova('www')

  forced === true && fse.removeSync(www)

  if (!fs.existsSync(www)) {
    fse.copySync(
      appPaths.resolve.cli('templates/cordova'),
      appPaths.cordovaDir
    )
  }
}

function ensureDeps () {
  if (fs.existsSync(appPaths.resolve.cordova('node_modules'))) {
    return
  }

  log('Installing dependencies in /src-cordova')
  spawnSync(
    'npm',
    [ 'install' ],
    { cwd: appPaths.cordovaDir, env: { ...process.env, NODE_ENV: 'development' } },
    () => {
      fatal('npm failed installing dependencies in /src-cordova', 'FAIL')
    }
  )
}

module.exports = function () {
  ensureWWW()
  ensureDeps()
}

module.exports.ensureWWW = ensureWWW
module.exports.ensureDeps = ensureDeps
