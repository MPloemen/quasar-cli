const
  path = require('path'),
  webpack = require('webpack'),
  WebpackChain = require('webpack-chain'),
  VueLoaderPlugin = require('vue-loader/lib/plugin'),
  WebpackProgress = require('./plugin.progress')

const
  appPaths = require('../app-paths'),
  injectStyleRules = require('./inject.style-rules')

module.exports = function (cfg, configName) {
  const
    chain = new WebpackChain(),
    needsHash = !cfg.ctx.dev && !['electron', 'cordova'].includes(cfg.ctx.modeName),
    fileHash = needsHash ? '.[hash:8]' : '',
    chunkHash = needsHash ? '.[contenthash:8]' : '',
    resolveModules = [
      'node_modules',
      appPaths.node_modules,
      appPaths.resolve.cli('node_modules')
    ]

  chain.entry('app').add(appPaths.resolve.app('.quasar/client-entry.js'))
  chain.mode(cfg.ctx.dev ? 'development' : 'production')
  chain.devtool(cfg.build.sourceMap ? cfg.build.devtool : false)

  if (cfg.ctx.prod || cfg.ctx.mode.ssr) {
    chain.output
      .path(
        cfg.ctx.mode.ssr
          ? path.join(cfg.build.distDir, 'www')
          : cfg.build.distDir
      )
      .publicPath(cfg.build.publicPath)
      .filename(`js/[name]${fileHash}.js`)
      .chunkFilename(`js/[name]${chunkHash}.js`)
  }

  chain.resolve.symlinks(false)

  chain.resolve.extensions
    .merge([ `.${cfg.ctx.themeName}.js`, '.js', '.vue' ])

  chain.resolve.modules
    .merge(resolveModules)

  chain.resolve.alias
    .merge({
      quasar: cfg.framework.all !== true
        ? `quasar-framework`
        : appPaths.resolve.node_modules(`quasar-framework/dist/quasar.${cfg.ctx.themeName}.esm.js`),
      src: appPaths.srcDir,
      app: appPaths.appDir,
      components: appPaths.resolve.src(`components`),
      layouts: appPaths.resolve.src(`layouts`),
      pages: appPaths.resolve.src(`pages`),
      assets: appPaths.resolve.src(`assets`),
      plugins: appPaths.resolve.src(`plugins`),
      variables: appPaths.resolve.app(`.quasar/variables.styl`),

      // CLI using these ones:
      'quasar-app-styl': appPaths.resolve.app(`.quasar/app.styl`),
      'quasar-app-variables': appPaths.resolve.src(`css/themes/variables.${cfg.ctx.themeName}.styl`),
      'quasar-styl': `quasar-framework/dist/quasar.${cfg.ctx.themeName}.styl`,
      'quasar-addon-styl': cfg.framework.cssAddon
        ? `quasar-framework/src/css/flex-addon.styl`
        : appPaths.resolve.app(`.quasar/empty.styl`)
    })

  if (cfg.build.vueCompiler) {
    chain.resolve.alias.set('vue$', 'vue/dist/vue.esm.js')
  }

  chain.resolveLoader.modules
    .merge(resolveModules)

  chain.module.noParse(/^(vue|vue-router|vuex|vuex-router-sync)$/)

  chain.module.rule('vue')
    .test(/\.vue$/)
    .use('vue-loader')
      .loader('vue-loader')
      .options({
        productionMode: cfg.ctx.prod,
        compilerOptions: {
          preserveWhitespace: false
        },
        transformAssetUrls: {
          video: 'src',
          source: 'src',
          img: 'src',
          image: 'xlink:href'
        }
      })

  chain.module.rule('babel')
    .test(/\.jsx?$/)
    .exclude
      .add(filepath => {
        // always transpile js(x) in Vue files
        if (/\.vue\.jsx?$/.test(filepath)) {
          return false
        }

        if (cfg.build.transpileDependencies.some(dep => filepath.match(dep))) {
          return false
        }

        // Don't transpile anything else in node_modules
        return /[\\/]node_modules[\\/]/.test(filepath)
      })
      .end()
    .use('babel-loader')
      .loader('babel-loader')
        .options({
          extends: appPaths.resolve.app('.babelrc'),
          plugins: cfg.framework.all !== true ? [
            [
              'transform-imports', {
                quasar: {
                  transform: `quasar-framework/dist/babel-transforms/imports.${cfg.ctx.themeName}.js`,
                  preventFullImport: true
                }
              }
            ]
          ] : []
        })

  chain.module.rule('images')
    .test(/\.(png|jpe?g|gif|svg)(\?.*)?$/)
    .use('url-loader')
      .loader('url-loader')
      .options({
        limit: 10000,
        name: `img/[name]${fileHash}.[ext]`
      })

  chain.module.rule('fonts')
    .test(/\.(woff2?|eot|ttf|otf)(\?.*)?$/)
    .use('url-loader')
      .loader('url-loader')
      .options({
        limit: 10000,
        name: `fonts/[name]${fileHash}.[ext]`
      })

  chain.module.rule('media')
    .test(/\.(mp4|webm|ogg|mp3|wav|flac|aac)(\?.*)?$/)
    .use('url-loader')
      .loader('url-loader')
      .options({
        limit: 10000,
        name: `media/[name]${fileHash}.[ext]`
      })

  injectStyleRules(chain, {
    rtl: cfg.build.rtl,
    sourceMap: cfg.build.sourceMap,
    extract: cfg.build.extractCSS,
    minify: cfg.build.minify
      ? !cfg.build.extractCSS
      : false
  })

  chain.plugin('vue-loader')
    .use(VueLoaderPlugin)

  chain.plugin('define')
    .use(webpack.DefinePlugin, [ cfg.build.env ])

  if (cfg.build.showProgress) {
    chain.plugin('progress')
      .use(WebpackProgress, [{ name: configName }])
  }

  chain.performance
    .hints(false)
    .maxAssetSize(500000)

  // DEVELOPMENT build
  if (cfg.ctx.dev) {
    const
      FriendlyErrorsPlugin = require('friendly-errors-webpack-plugin'),
      { devCompilationSuccess } = require('../helpers/banner')

    chain.optimization
      .noEmitOnErrors(true)

    chain.plugin('friendly-errors')
      .use(FriendlyErrorsPlugin, [{
        clearConsole: true,
        compilationSuccessInfo: ['spa', 'pwa', 'ssr'].includes(cfg.ctx.modeName)
          ? { notes: [ devCompilationSuccess(cfg.ctx, cfg.build.APP_URL) ] }
          : undefined
      }])
  }
  // PRODUCTION build
  else {
    // keep module.id stable when vendor modules does not change
    chain.plugin('hashed-module-ids')
      .use(webpack.HashedModuleIdsPlugin, [{
        hashDigest: 'hex'
      }])

    // keep chunk ids stable so async chunks have consistent hash
    const hash = require('hash-sum')
    chain
      .plugin('named-chunks')
        .use(webpack.NamedChunksPlugin, [
          chunk => chunk.name || hash(
            Array.from(chunk.modulesIterable, m => m.id).join('_')
          )
        ])

    if (configName !== 'Server') {
      const
        add = cfg.vendor.add,
        rem = cfg.vendor.remove,
        regex = /[\\/]node_modules[\\/]/

      chain.optimization
        .splitChunks({
          cacheGroups: {
            vendors: {
              name: 'vendor',
              chunks: 'initial',
              priority: -10,
              // a module is extracted into the vendor chunk if...
              test: add || rem
                ? module => {
                  if (module.resource) {
                    if (add && add.test(module.resource)) { return true }
                    if (rem && rem.test(module.resource)) { return false }
                  }
                  return regex.test(module.resource)
                }
                : module => regex.test(module.resource)
            },
            common: {
              name: `chunk-common`,
              minChunks: 2,
              priority: -20,
              chunks: 'initial',
              reuseExistingChunk: true
            }
          }
        })

      // extract webpack runtime and module manifest to its own file in order to
      // prevent vendor hash from being updated whenever app bundle is updated
      if (cfg.build.webpackManifest) {
        chain.optimization.runtimeChunk('single')
      }

      // copy statics to dist folder
      const CopyWebpackPlugin = require('copy-webpack-plugin')
      chain.plugin('copy-webpack')
        .use(CopyWebpackPlugin, [
          [{
            from: appPaths.resolve.src('statics'),
            to: 'statics',
            ignore: ['.*']
          }]
        ])
    }

    // Scope hoisting ala Rollupjs
    if (cfg.build.scopeHoisting) {
      chain.optimization
        .concatenateModules(true)
    }

    if (cfg.ctx.debug) {
      // reset default webpack 4 minimizer
      chain.optimization.minimizer([])
    }
    else if (cfg.build.minify) {
      const UglifyJSPlugin = require('uglifyjs-webpack-plugin')

      chain.optimization
        .minimizer([
          new UglifyJSPlugin({
            uglifyOptions: cfg.build.uglifyOptions,
            cache: true,
            parallel: true,
            sourceMap: cfg.build.sourceMap
          })
        ])
    }

    // configure CSS extraction & optimize
    if (cfg.build.extractCSS) {
      const MiniCssExtractPlugin = require('mini-css-extract-plugin')

      // extract css into its own file
      chain.plugin('mini-css-extract')
        .use(MiniCssExtractPlugin, [{
          filename: 'css/[name].[contenthash:8].css'
        }])

      // dedupe & minify CSS (only if extracted)
      if (cfg.build.minify) {
        const OptimizeCSSPlugin = require('optimize-css-assets-webpack-plugin')

        const cssProcessorOptions = {
          parser: require('postcss-safe-parser'),
          autoprefixer: { disable: true },
          mergeLonghand: false
        }
        if (cfg.build.sourceMap) {
          cssProcessorOptions.map = { inline: false }
        }

        // We are using this plugin so that possible
        // duplicated CSS = require(different components) can be deduped.
        chain.plugin('optimize-css')
          .use(OptimizeCSSPlugin, [{
            canPrint: false,
            cssProcessor: require('cssnano'),
            cssProcessorOptions
          }])
      }
    }

    if (configName !== 'Server') {
      // also produce a gzipped version
      if (cfg.build.gzip) {
        const CompressionWebpackPlugin = require('compression-webpack-plugin')
        chain.plugin('compress-webpack')
          .use(CompressionWebpackPlugin, [ cfg.build.gzip ])
      }

      if (cfg.build.analyze) {
        const BundleAnalyzerPlugin = require('webpack-bundle-analyzer').BundleAnalyzerPlugin
        chain.plugin('bundle-analyzer')
          .use(BundleAnalyzerPlugin, [ Object.assign({}, cfg.build.analyze) ])
      }
    }
  }

  return chain
}
