const appPaths = require('../app-paths.js')
const { getPackagePath } = require('../helpers/get-package-path.js')
const getPackageMajorVersion = require('../helpers/get-package-major-version.js')

module.exports.capBin = getPackagePath('@capacitor/cli/bin/capacitor', appPaths.capacitorDir)

module.exports.capVersion = getPackageMajorVersion('@capacitor/cli', appPaths.capacitorDir)
