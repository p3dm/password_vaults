import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    projects: [
      {
        test: {
          name: 'unit',
          environment: 'node',
          include: ['tests/unit/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'ipc',
          environment: 'node',
          include: ['tests/ipc/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'native-host',
          environment: 'node',
          include: ['tests/native-host/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'windows',
          environment: 'node',
          include: ['tests/windows/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'integration',
          environment: 'node',
          include: ['tests/integration/**/*.test.ts'],
        },
      },
    ],
  },
});
