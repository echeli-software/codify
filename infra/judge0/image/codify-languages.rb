# Codify runtimes (docs/12 §4), appended to Judge0's language seed.
# Ids are Codify's own (outside the CE range); the API defaults to them and
# JUDGE0_LANGUAGE_IDS overrides them.
@languages ||= []
@languages +=
[
  {
    id: 222,
    name: "JavaScript (Node.js 22)",
    is_archived: false,
    source_file: "script.js",
    run_cmd: "/usr/local/node-22/bin/node script.js"
  },
  {
    id: 223,
    name: "TypeScript (Node.js 22, type stripping)",
    is_archived: false,
    source_file: "script.ts",
    run_cmd: "/usr/local/node-22/bin/node --experimental-strip-types --no-warnings script.ts"
  },
  {
    id: 312,
    name: "Python (3.12)",
    is_archived: false,
    source_file: "script.py",
    run_cmd: "/usr/local/python-3.12/bin/python3 script.py"
  }
]
