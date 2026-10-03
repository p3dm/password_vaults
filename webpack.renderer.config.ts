import type { Configuration } from 'webpack';
import { rules } from './webpack.rules.config.js';

export const rendererConfig: Configuration = {
  module: {
    rules,
  },
  resolve: {
    extensions: ['.js', '.ts', '.jsx', '.tsx', '.css'],
  },
};
