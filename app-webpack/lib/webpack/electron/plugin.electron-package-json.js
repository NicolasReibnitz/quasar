const { sources } = require('webpack')
const { merge } = require('webpack-merge')

const { appPkg } = require('../../app-pkg.js')
const { getFixedDeps } = require('../../helpers/get-fixed-deps.js')

module.exports.ElectronPackageJsonPlugin = class ElectronPackageJsonPlugin {
  constructor (cfg = {}) {
    this.cfg = cfg

    const pkg = merge({}, appPkg)

    if (pkg.dependencies) {
      pkg.dependencies = getFixedDeps(pkg.dependencies)
      delete pkg.dependencies[ '@quasar/extras' ]
    }

    // we don't need this (also, faster install time & smaller bundles)
    delete pkg.devDependencies
    delete pkg.browserslist
    delete pkg.scripts

    pkg.main = './electron-main.js'

    if (this.cfg.electron.extendPackageJson) {
      this.cfg.electron.extendPackageJson(pkg)
    }

    this.source = JSON.stringify(pkg)
  }

  apply (compiler) {
    compiler.hooks.thisCompilation.tap('package.json', compilation => {
      compilation.emitAsset('package.json', new sources.RawSource(this.source))
    })
  }
}
