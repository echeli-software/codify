// Public surface of @codify/ui-core. Pure TS; no DOM, no Angular.
// See docs/03-shared-libraries.md. Each module is also published as its own
// entry point (`@codify/ui-core/format`, `/level`, `/validate`, `/color`,
// `/random`) so consumers can import only what they need.

export * from './lib/format/index.js';
export * from './lib/level/index.js';
export * from './lib/validate/index.js';
export * from './lib/color/index.js';
export * from './lib/random/index.js';
