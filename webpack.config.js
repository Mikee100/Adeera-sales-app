const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const webpack = require('webpack');

module.exports = (env, argv) => {
  const isProduction = argv.mode === 'production';

  return [
    // Main process configuration
    {
      name: 'main',
      entry: './src/main/main.ts',
      target: 'electron-main',
      mode: isProduction ? 'production' : 'development',
      devtool: isProduction ? false : 'source-map',
      externals: {
        // Exclude serialport and its native bindings from webpack bundling
        // These will be loaded at runtime from node_modules
        'serialport': 'commonjs serialport',
        '@serialport/bindings-cpp': 'commonjs @serialport/bindings-cpp',
      },
      module: {
        rules: [
          {
            test: /\.ts$/,
            exclude: /node_modules/,
            use: [
              {
                loader: 'ts-loader',
                options: {
                  transpileOnly: true,
                },
              },
            ],
          },
        ],
      },
      resolve: {
        extensions: ['.ts', '.js'],
      },
      output: {
        path: path.resolve(__dirname, 'dist'),
        filename: 'main.js',
        library: {
          type: 'commonjs2',
        },
      },
    },
    // Renderer process configuration
    {
      name: 'renderer',
      entry: './src/renderer/index.tsx',
      target: 'electron-renderer',
      mode: isProduction ? 'production' : 'development',
      devtool: isProduction ? false : 'source-map',
      module: {
        rules: [
          {
            test: /\.tsx?$/,
            exclude: /node_modules/,
            use: [
              {
                loader: 'ts-loader',
                options: {
                  transpileOnly: true,
                },
              },
            ],
          },
          {
            test: /\.css$/,
            use: ['style-loader', 'css-loader'],
          },
        ],
      },
      resolve: {
        extensions: ['.tsx', '.ts', '.js'],
        fallback: {
          "events": false,
          "buffer": false,
          "crypto": false,
          "stream": false,
          "util": false,
          "path": false,
          "querystring": false,
          "url": false,
          "fs": false,
          "os": false,
          "http": false,
          "https": false,
          "zlib": false,
          "assert": false,
          "constants": false,
          "timers": false,
          "process": false
        }
      },
      output: {
        path: path.resolve(__dirname, 'dist'),
        filename: 'renderer.js',
        globalObject: 'this',
      },
      plugins: [
        new HtmlWebpackPlugin({
          template: './src/renderer/index.html',
          filename: 'index.html',
        }),
        new webpack.ProvidePlugin({
          global: 'globalThis',
        }),
      ],
      devServer: {
        host: '127.0.0.1',
        port: 3000,
        hot: false,
        liveReload: false,
        client: false,
        static: {
          directory: path.join(__dirname, 'dist'),
        },
      },
    },
    // Preload process configuration
    {
      name: 'preload',
      entry: './src/main/preload.ts',
      target: 'electron-preload',
      mode: isProduction ? 'production' : 'development',
      devtool: isProduction ? false : 'source-map',
      module: {
        rules: [
          {
            test: /\.ts$/,
            exclude: /node_modules/,
            use: [
              {
                loader: 'ts-loader',
                options: {
                  transpileOnly: true,
                },
              },
            ],
          },
        ],
      },
      resolve: {
        extensions: ['.ts', '.js'],
      },
      output: {
        path: path.resolve(__dirname, 'dist'),
        filename: 'preload.js',
      },
    },
  ];
};
