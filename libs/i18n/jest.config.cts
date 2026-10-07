module.exports = {
  displayName: 'i18n',
  preset: '../../jest.preset.js',
  setupFilesAfterEnv: ['<rootDir>/src/test-setup.ts'],
  coverageDirectory: 'test-output/jest/coverage',
  // Override the preset's ts-jest transform with jest-preset-angular so we
  // can use Angular's TestBed (signals + DI) inside specs.
  transform: {
    '^.+\\.(ts|js|mts|mjs|cts|cjs|html)$': [
      'jest-preset-angular',
      {
        tsconfig: '<rootDir>/tsconfig.spec.json',
        stringifyContentPathRegex: '\\.(html|svg)$',
      },
    ],
  },
  // Angular ships fesm2022 .mjs builds — transform them so jest can load
  // them as CJS via jest-preset-angular.
  transformIgnorePatterns: [
    'node_modules/(?!(?:.*\\.mjs$|.*@angular|.*@ionic|.*ionicons|.*@stencil))',
  ],
  snapshotSerializers: [
    'jest-preset-angular/build/serializers/no-ng-attributes',
    'jest-preset-angular/build/serializers/ng-snapshot',
    'jest-preset-angular/build/serializers/html-comment',
  ],
};
