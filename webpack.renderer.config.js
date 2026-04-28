const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const webpack = require('webpack');

module.exports = {
  name: 'renderer',
  entry: './src/renderer/index.tsx',
  target: 'electron-renderer',
  mode: 'development',
  devtool: 'source-map',
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
      {
        test: /\.(png|jpg|jpeg|gif|svg)$/i,
        type: 'asset/resource',
        generator: {
          filename: 'images/[name][ext]',
        },
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
    publicPath: './',
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
    port: 3100,
    hot: false,
    liveReload: false,
    client: false,
    static: [
      {
        directory: path.join(__dirname, 'dist'),
      },
      {
        directory: path.join(__dirname, 'images'),
        publicPath: '/images',
      },
    ],
  },
};
