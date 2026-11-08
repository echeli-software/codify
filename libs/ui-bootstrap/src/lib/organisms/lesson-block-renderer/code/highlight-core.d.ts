// highlight.js ships types for its root entry and languages but not for the
// `lib/core` subpath this lib imports lazily (to register only the grammars
// lessons use).
declare module 'highlight.js/lib/core' {
  import hljs from 'highlight.js';
  export default hljs;
}
