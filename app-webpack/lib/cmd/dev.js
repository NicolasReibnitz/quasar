
if (process.env.NODE_ENV === void 0) {
  process.env.NODE_ENV = 'development'
}

const parseArgs = require('minimist')

const { log, warn } = require('../helpers/logger.js')

const argv = parseArgs(process.argv.slice(2), {
  alias: {
    m: 'mode',
    T: 'target', // cordova/capacitor mode only
    e: 'emulator', // cordova-mode only
    p: 'port',
    H: 'hostname',
    i: 'ide',
    h: 'help',
    d: 'devtools'
  },
  boolean: [ 'h', 'i', 'd' ],
  string: [ 'm', 'T', 'H' ],
  default: {
    m: 'spa'
  }
})

if (argv.help) {
  console.log(`
  Description
    Starts the app in development mode (hot-code reloading, error
    reporting, etc)

  Usage
    $ quasar dev
    $ quasar dev -p <port number>

    $ quasar dev -m ssr

    # alias for "quasar dev -m cordova -T ios"
    $ quasar dev -m ios

    # alias for "quasar dev -m cordova -T android"
    $ quasar dev -m android

    # passing extra parameters and/or options to
    # underlying "cordova" or "electron" executables:
    $ quasar dev -m ios -- some params --and options --here
    $ quasar dev -m electron -- --no-sandbox --disable-setuid-sandbox
    # when on Windows and using Powershell:
    $ quasar dev -m ios '--' some params --and options --here
    $ quasar dev -m electron '--' --no-sandbox --disable-setuid-sandbox

  Options
    --mode, -m       App mode [spa|ssr|pwa|cordova|capacitor|electron|bex] (default: spa)
    --port, -p       A port number on which to start the application
    --hostname, -H   A hostname to use for serving the application
    --help, -h       Displays this message

    Only for Cordova mode:
    --target, -T     (required) App target
                        [android|ios]
    --emulator, -e   (optional) Emulator name
                        Examples: iPhone-7, iPhone-X
                        iPhone-X,com.apple.CoreSimulator.SimRuntime.iOS-12-2
    --ide, -i        Open IDE (Android Studio / XCode) instead of letting Cordova
                        booting up the emulator, in which case the "--emulator"
                        param will have no effect

    --devtools, -d   Open remote Vue Devtools

    Only for Capacitor mode:
    --target, -T     (required) App target
                        [android|ios]
  `)
  process.exit(0)
}

const { ensureArgv } = require('../helpers/ensure-argv.js')
ensureArgv(argv, 'dev')

const { ensureVueDeps } = require('../helpers/ensure-vue-deps.js')
ensureVueDeps()

console.log(
  require('node:fs').readFileSync(
    require('node:path').join(__dirname, '../../assets/logo.art'),
    'utf8'
  )
)

const { displayBanner } = require('../helpers/banner.js')
displayBanner(argv, 'dev')

const findPort = require('../helpers/net.js').findClosestOpenPort

async function parseAddress ({ host, port }) {
  if (this.chosenHost) {
    host = this.chosenHost
  }
  else if (
    [ 'cordova', 'capacitor' ].includes(argv.mode)
    && (!host || [ '0.0.0.0', 'localhost', '127.0.0.1', '::1' ].includes(host.toLowerCase()))
  ) {
    const { getExternalIP } = require('../helpers/get-external-ip.js')
    host = await getExternalIP()
    this.chosenHost = host
  }

  try {
    const openPort = await findPort(port, host)
    if (port !== openPort) {
      warn()
      warn(`️️Setting port to closest one available: ${ openPort }`)
      warn()

      port = openPort
    }
  }
  catch (e) {
    warn()

    if (e.message === 'ERROR_NETWORK_PORT_NOT_AVAIL') {
      warn('Could not find an open port. Please configure a lower one to start searching with.')
    }
    else if (e.message === 'ERROR_NETWORK_ADDRESS_NOT_AVAIL') {
      warn('Invalid host specified. No network address matches. Please specify another one.')
    }
    else {
      warn('Unknown network error occurred')
      console.log(e)
    }

    warn()

    if (!this.running) {
      process.exit(1)
    }

    return null
  }

  this.running = true
  return { host, port }
}

function startVueDevtools () {
  const { spawn } = require('../helpers/spawn.js')
  const { getPackagePath } = require('../helpers/get-package-path.js')

  let vueDevtoolsBin = getPackagePath('@vue/devtools/bin.js')

  function run () {
    log('Booting up remote Vue Devtools...')
    spawn(vueDevtoolsBin, [], {})
  }

  if (vueDevtoolsBin !== void 0) {
    run()
    return
  }

  const { nodePackager } = require('../helpers/node-packager.js')
  nodePackager.installPackage('@vue/devtools', { isDevDependency: true })

  // a small delay is a must, otherwise require.resolve
  // after a yarn/npm install will fail
  return new Promise(resolve => {
    vueDevtoolsBin = getPackagePath('@vue/devtools/bin.js')
    run()
    resolve()
  })
}

async function goLive () {
  if (argv.mode !== 'spa') {
    const { installMissing } = require('../mode/install-missing.js')
    await installMissing(argv.mode, argv.target)
  }

  const { DevServer } = argv.mode === 'ssr'
    ? require('../dev-server-ssr.js')
    : require('../dev-server-regular.js')
  const { QuasarConfigFile } = require('../quasar-config-file.js')
  const { Generator } = require('../generator.js')
  const { getQuasarCtx } = require('../helpers/get-quasar-ctx.js')
  const { extensionsRunner } = require('../app-extension/extensions-runner.js')
  const regenerateTypesFeatureFlags = require('../helpers/types-feature-flags.js')

  const ctx = getQuasarCtx({
    mode: argv.mode,
    target: argv.target,
    emulator: argv.emulator,
    dev: true,
    vueDevtools: argv.devtools
  })

  // register app extensions
  await extensionsRunner.registerExtensions(ctx)

  const quasarConfFile = new QuasarConfigFile(ctx, {
    port: argv.port,
    host: argv.hostname,
    onAddress: parseAddress,
    watch: {
      onBuildChange () {
        log('Rebuilding app due to quasar.config file changes...')
        dev = dev.then(startDev)
      },
      onAppChange () {
        log('Regenerating entry files due to quasar.config changes...')
        generator.build()
      }
    }
  })

  const { quasarConf } = await quasarConfFile.read()

  regenerateTypesFeatureFlags(quasarConf)

  if (quasarConf.__vueDevtools !== false) {
    await startVueDevtools()
  }

  if (typeof quasarConf.build.beforeDev === 'function') {
    await quasarConf.build.beforeDev({ quasarConf })
  }

  // run possible beforeDev hooks
  await extensionsRunner.runHook('beforeDev', async hook => {
    log(`Extension(${ hook.api.extId }): Running beforeDev hook...`)
    await hook.fn(hook.api, { quasarConf })
  })

  const generator = new Generator(quasarConfFile)
  let runMode

  if ([ 'cordova', 'capacitor', 'electron', 'bex', 'pwa', 'ssr' ].includes(argv.mode)) {
    const ModeRunner = require('../' + (argv.mode === 'ssr' ? 'pwa' : argv.mode) + '/index.js')
    ModeRunner.init(ctx)
    runMode = () => ModeRunner.run(quasarConfFile, argv)
  }
  else {
    runMode = () => {}
  }

  function startDev (oldDevServer) {
    let devServer

    const runMain = async () => {
      if (oldDevServer !== void 0) {
        await oldDevServer.stop()
        oldDevServer = void 0
      }

      generator.build() // Update generated files
      devServer = new DevServer(quasarConfFile) // Create new devserver

      return devServer.listen() // Start listening
    }

    let promise = Promise.resolve()

    // using quasarConfFile.ctx instead of argv.mode
    // because SSR might also have PWA enabled but we
    // can only know it after parsing the quasar.config file
    promise = quasarConfFile.ctx.mode.pwa === true
      ? promise.then(runMode).then(runMain)
      : promise.then(runMain).then(runMode)

    return promise.then(() => devServer) // Pass new builder to watch chain
  }

  let dev = startDev().then(async (payload) => {
    if (typeof quasarConf.build.afterDev === 'function') {
      await quasarConf.build.afterDev({ quasarConf })
    }
    // run possible afterDev hooks
    await extensionsRunner.runHook('afterDev', async hook => {
      log(`Extension(${ hook.api.extId }): Running afterDev hook...`)
      await hook.fn(hook.api, { quasarConf })
    })

    quasarConfFile.watch()

    return payload
  })
}

goLive()
