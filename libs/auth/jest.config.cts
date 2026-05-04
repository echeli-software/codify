module.exports = {
  displayName: 'auth',
  preset: '../../jest.preset.js',
  setupFilesAfterEnv: ['<rootDir>/src/test-setup.ts'],
  coverageDirectory: 'test-output/jest/coverage',
  // Override the preset's ts-jest with jest-preset-angular so TestBed +
  // signal-based DI work in specs.
  transform: {
    '^.+\\.(ts|js|mts|mjs|cts|cjs|html)$': [
      'jest-preset-angular',
      {
        tsconfig: '<rootDir>/tsconfig.spec.json',
        stringifyContentPathRegex: '\\.(html|svg)$',
      },
    ],
  },
  // Angular ships fesm2022 .mjs builds — let jest-preset-angular transform them.
  transformIgnorePatterns: [
    'node_modules/(?!(?:.*\\.mjs$|.*@angular|.*@ionic|.*ionicons|.*@stencil))',
  ],
  snapshotSerializers: [
    'jest-preset-angular/build/serializers/no-ng-attributes',
    'jest-preset-angular/build/serializers/ng-snapshot',
    'jest-preset-angular/build/serializers/html-comment',
  ],
};
