# Third-party notices

## xqnode/codex-zh-CN

This project imports the MIT-licensed `xqnode/codex-zh-CN` release v0.1.2 at
commit `0e39c30a381c712c16e49c8e72c8eca40c3b2299`. Its license is included in
`UPSTREAM-LICENSE`; import details are in `UPSTREAM.md`.

## Node.js runtime

The offline Windows x64 runtime is Node.js v24.19.0, downloaded at build time
only from https://nodejs.org/download/release/v24.19.0/node-v24.19.0-win-x64.zip.
Its required SHA-256 is
`57f71ab3652e797d84acddc79c81cc9ff1c6ddb2a1974cdb83f00fee9bff4c73`.
`runtime/SHASUMS256.txt` is the matching official release checksum list, and
`runtime/NODE-LICENSE.txt` is from
https://raw.githubusercontent.com/nodejs/node/v24.19.0/LICENSE.

The product performs no runtime download and does not use a package manager;
the included archive is verified before use so the release can operate offline.

## Security and affiliation

Patching a Codex executable changes its bytes and invalidates its original
Authenticode signature. Windows SmartScreen, WDAC, AppLocker, enterprise
endpoint controls, or other policy may block the patched copy. This project
does not attempt to bypass those protections.

This is an independent project. It is not affiliated with, endorsed by, or
sponsored by OpenAI, Node.js, or xqnode.
