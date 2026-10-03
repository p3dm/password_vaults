import type { Configuration } from 'webpack';
import { rules } from './webpack.rules.config.js';

export const mainConfig: Configuration = {
  entry: './src/desktop/main.ts',
  module: {
    rules,
  },
  resolve: {
    extensions: ['.js', '.ts', '.jsx', '.tsx', '.css', '.json'],
  },
  externals: {
    koffi: 'commonjs koffi',
    mariadb: 'commonjs mariadb',
  },
};
