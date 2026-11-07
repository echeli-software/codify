const { NxAppWebpackPlugin } = require('@nx/webpack/app-plugin');
const { join } = require('path');

module.exports = {
  output: {
    path: join(__dirname, 'dist'),
    clean: true,
    ...(process.env.NODE_ENV !== 'production' && {
      devtoolModuleFilenameTemplate: '[absolute-resource-path]',
    }),
  },
  // Bundle pure workspace libs from source. NxAppWebpackPlugin's tsc
  // compiler doesn't apply tsconfig `paths`, and these libs ship as
  // ESM-only — so we alias them to their TS entrypoint and let webpack
  // pull them into the (CJS) bundle. `extensionAlias` resolves the
  // NodeNext-style `.js` import specifiers inside those libs to `.ts`.
  resolve: {
    alias: {
      '@codify/domain': join(__dirname, '../../libs/domain/src/index.ts'),
      '@codify/ui-core': join(__dirname, '../../libs/ui-core/src/index.ts'),
      '@codify/lesson-schema': join(
        __dirname,
        '../../libs/lesson-schema/src/index.ts',
      ),
    },
    extensions: ['.ts', '.js'],
    extensionAlias: {
      '.js': ['.ts', '.js'],
    },
  },
  plugins: [
    new NxAppWebpackPlugin({
      target: 'node',
      compiler: 'tsc',
      main: './src/main.ts',
      tsConfig: './tsconfig.app.json',
      assets: ['./src/assets'],
      optimization: false,
      outputHashing: 'none',
      generatePackageJson: false,
      sourceMap: true,
    }),
  ],
};
