const fs = require('node:fs')
const { join } = require('node:path')
const webpack = require('webpack')
const WebpackDevServer = require('webpack-dev-server')
const chokidar = require('chokidar')
const express = require('express')

const createRenderer = require('@quasar/ssr-helpers/create-renderer.js')
const { getClientManifest } = require('./webpack/ssr/plugin.client-side.js')
const { getServerManifest } = require('./webpack/ssr/plugin.server-side.js')
const { doneExternalWork } = require('./webpack/plugin.progress.js')
const { webpackNames } = require('./webpack/symbols.js')

const appPaths = require('./app-paths.js')
const { getPackage } = require('./helpers/get-package.js')
const { renderToString } = getPackage('vue/server-renderer')
const { openBrowser } = require('./helpers/open-browser.js')

const banner = '[Quasar Dev Webserver]'
const compiledMiddlewareFile = appPaths.resolve.app('.quasar/ssr/compiled-middlewares.js')

let renderSSRError
const renderError = ({ err, req, res }) => {
  console.log()
  console.error(`${ banner } ${ req.url } -> error during render`)
  console.error(err.stack)

  renderSSRError({ err, req, res })
}

const doubleSlashRE = /\/\//g

let appUrl
let openedBrowser = false

module.exports.DevServer = class DevServer {
  constructor (quasarConfFile) {
    this.quasarConfFile = quasarConfFile
    this.setInitialState()
  }

  setInitialState () {
    this.handlers = []

    this.htmlWatcher = null
    this.webpackServer = null
  }

  async listen () {
    const cfg = this.quasarConfFile.quasarConf
    const webpackConf = this.quasarConfFile.webpackConf

    const webserverCompiler = webpack(webpackConf.webserver)
    const serverCompiler = webpack(webpackConf.serverSide)

    let clientCompiler, serverManifest, clientManifest, renderTemplate, renderWithVue, webpackServerListening = false

    if (renderSSRError === void 0) {
      const { default: render } = await import('@quasar/render-ssr-error')
      renderSSRError = render
    }

    async function startClient () {
      if (clientCompiler) {
        clientManifest = void 0
        await new Promise(resolve => {
          clientCompiler.close(resolve)
        })
      }

      clientCompiler = webpack(webpackConf.clientSide)
      clientCompiler.hooks.thisCompilation.tap('quasar-ssr-server-plugin', compilation => {
        compilation.hooks.processAssets.tapAsync(
          { name: 'quasar-ssr-server-plugin', state: webpack.Compilation.PROCESS_ASSETS_STAGE_ADDITIONAL },
          (_, callback) => {
            if (compilation.errors.length === 0) {
              clientManifest = getClientManifest(compilation)
              update()
            }

            callback()
          }
        )
      })
    }

    let tryToFinalize = () => {
      if (serverManifest && clientManifest && webpackServerListening === true) {
        tryToFinalize = () => {}

        if (openedBrowser === false || appUrl !== cfg.build.APP_URL) {
          appUrl = cfg.build.APP_URL
          openedBrowser = true

          if (cfg.__devServer.open) {
            openBrowser({ url: appUrl, opts: cfg.__devServer.openOptions })
          }
        }
      }
    }

    const publicPath = cfg.build.publicPath
    const resolveUrlPath = publicPath === '/'
      ? url => url || '/'
      : url => (url ? (publicPath + url).replace(doubleSlashRE, '/') : publicPath)

    const rootFolder = appPaths.appDir
    const publicFolder = appPaths.resolve.app('public')

    function resolvePublicFolder () {
      return join(publicFolder, ...arguments)
    }

    const serveStatic = (path, opts = {}) => {
      return express.static(resolvePublicFolder(path), {
        ...opts,
        maxAge: opts.maxAge === void 0
          ? cfg.ssr.maxAge
          : opts.maxAge
      })
    }

    const { getIndexHtml } = require('./ssr/html-template.js')
    const templatePath = appPaths.resolve.app(cfg.sourceFiles.indexHtmlTemplate)

    function updateTemplate () {
      renderTemplate = getIndexHtml(fs.readFileSync(templatePath, 'utf-8'), cfg)
    }

    this.htmlWatcher = chokidar.watch(templatePath).on('change', () => {
      updateTemplate()
      console.log(`${ banner } index.template.html template updated.`)
    })

    updateTemplate()

    const renderOptions = {
      vueRenderToString: renderToString,
      basedir: appPaths.resolve.app('.'),
      manualStoreSerialization: cfg.ssr.manualStoreSerialization === true
    }

    const update = () => {
      if (serverManifest && clientManifest) {
        Object.assign(renderOptions, {
          serverManifest,
          clientManifest
        })

        const renderer = createRenderer(renderOptions)

        renderWithVue = ssrContext => {
          const startTime = Date.now()

          return renderer(ssrContext, renderTemplate)
            .then(html => {
              console.log(`${ banner } ${ ssrContext.req.url } -> request took: ${ Date.now() - startTime }ms`)
              return html
            })
        }

        tryToFinalize()
      }
    }

    webserverCompiler.hooks.done.tap('done-compiling', stats => {
      if (stats.hasErrors() === false) {
        delete require.cache[ compiledMiddlewareFile ]
        const injectMiddleware = require(compiledMiddlewareFile)

        startWebpackServer()
          .then(app => {
            if (this.destroyed === true) { return }

            return injectMiddleware({
              app,
              resolve: {
                urlPath: resolveUrlPath,
                root () { return join(rootFolder, ...arguments) },
                public: resolvePublicFolder
              },
              publicPath,
              folders: {
                root: rootFolder,
                public: publicFolder
              },
              render: ssrContext => renderWithVue(ssrContext),
              serve: {
                static: serveStatic,
                error: renderError
              }
            })
          })
          .then(() => {
            if (this.destroyed === true) { return }

            webpackServerListening = true
            tryToFinalize()
            doneExternalWork(webpackNames.ssr.webserver)
          })
      }
    })

    this.handlers.push(
      webserverCompiler.watch({}, () => {})
    )

    serverCompiler.hooks.thisCompilation.tap('quasar-ssr-server-plugin', compilation => {
      compilation.hooks.processAssets.tapAsync(
        { name: 'quasar-ssr-server-plugin', state: webpack.Compilation.PROCESS_ASSETS_STAGE_ADDITIONAL },
        (_, callback) => {
          if (compilation.errors.length === 0) {
            serverManifest = getServerManifest(compilation)
            update()
          }

          callback()
        }
      )
    })

    this.handlers.push(
      serverCompiler.watch({}, () => {})
    )

    const startWebpackServer = async () => {
      if (this.destroyed === true) { return }

      if (this.webpackServer !== null) {
        const server = this.webpackServer
        this.webpackServer = null
        webpackServerListening = false

        await server.stop()
      }

      if (this.destroyed === true) { return }

      await startClient()

      if (this.destroyed === true) { return }

      return new Promise(resolve => {
        this.webpackServer = new WebpackDevServer({
          ...cfg.devServer,

          setupMiddlewares: (middlewares, opts) => {
            const { app } = opts

            if (cfg.build.ignorePublicFolder !== true) {
              app.use(resolveUrlPath('/'), serveStatic('.', { maxAge: 0 }))
            }

            const newMiddlewares = cfg.devServer.setupMiddlewares(middlewares, opts)

            if (this.destroyed !== true) {
              resolve(app)
            }

            return newMiddlewares
          }
        }, clientCompiler)

        this.webpackServer.start()
      })
    }
  }

  stop () {
    this.destroyed = true

    if (this.htmlWatcher !== null) {
      this.htmlWatcher.close()
    }

    if (this.webpackServer !== null) {
      this.handlers.push({
        // normalize to syntax of the other handlers
        close: doneFn => {
          this.webpackServer.stop().finally(() => { doneFn() })
        }
      })
    }

    return Promise.all(
      this.handlers.map(handler => new Promise(resolve => { handler.close(resolve) }))
    ).finally(() => {
      this.setInitialState()
    })
  }
}
