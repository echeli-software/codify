module.exports = {
  displayName: 'student',
  preset: '../../jest.preset.js',
  setupFilesAfterEnv: ['<rootDir>/src/test-setup.ts'],
  coverageDirectory: 'test-output/jest/coverage',
  transform: {
    '^.+\\.(ts|mjs|js|html)$': [
      'jest-preset-angular',
      {
        tsconfig: '<rootDir>/tsconfig.spec.json',
        stringifyContentPathRegex: '\\.(html|svg)$',
      },
    ],
  },
  // Ionic + ionicons + @stencil ship native ESM `.js` files that Jest
  // can't parse without transformation. The match needs to allow pnpm's
  // `.pnpm/@ionic+angular@…` layout, hence the wildcard before each.
  transformIgnorePatterns: [
    'node_modules/(?!(?:.*\\.mjs$|.*@ionic|.*ionicons|.*@stencil))',
  ],
  snapshotSerializers: [
    'jest-preset-angular/build/serializers/no-ng-attributes',
    'jest-preset-angular/build/serializers/ng-snapshot',
    'jest-preset-angular/build/serializers/html-comment',
  ],
};
