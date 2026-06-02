# Third-Party Licenses

This project (SDStudio Remote) is a server-based fork of an Electron desktop
application. It incorporates code from the following projects under their
respective licenses.

---

## SDStudio (upstream)

**Source**: https://github.com/Dd154663/SDStudio
**License**: MIT
**Used in**: frontend (`frontend/`)

The frontend code in `frontend/src/` is forked from Dd154663/SDStudio,
which is itself a fork of sunho/SDStudio. Modifications by SDStudio Remote
are licensed under PolyForm Noncommercial 1.0.0 (see LICENSE).

The original SDStudio author has explicitly confirmed that the MIT license
grants downstream forks full freedom to choose their own licensing terms,
which is the basis for this project's PolyForm Noncommercial licensing of
modifications.

The original MIT license terms below apply to the upstream code:

    MIT License

    Copyright (c) Dd154663 and contributors
    Copyright (c) sunho and contributors

    Permission is hereby granted, free of charge, to any person obtaining a copy
    of this software and associated documentation files (the "Software"), to deal
    in the Software without restriction, including without limitation the rights
    to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
    copies of the Software, and to permit persons to whom the Software is
    furnished to do so, subject to the following conditions:

    The above copyright notice and this permission notice shall be included in all
    copies or substantial portions of the Software.

    THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
    IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
    FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
    AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
    LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
    OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
    SOFTWARE.

---

## NPM Dependencies

Server (`server.js`) and frontend (`frontend/package.json`) use various
open-source packages. See respective `package.json` files for the full list.
Each package is governed by its own license, listed in
`node_modules/<package>/LICENSE` after `npm install`.

Most dependencies are permissive (MIT / ISC / Apache-2.0 / BSD). The
following production dependencies carry copyleft-style terms and are noted
here explicitly. None of them transmit their copyleft to this project's own
code: the components are used as unmodified, dynamically-loaded /
file-scoped dependencies and are not statically linked or bundled into this
project's source.

### sharp / libvips (native binaries)

**Packages**: `@img/sharp-libvips-*` (e.g. `@img/sharp-libvips-linux-arm64`,
`@img/sharp-libvips-linuxmusl-arm64`)
**License**: LGPL-3.0-or-later
**Source**: https://github.com/lovell/sharp-libvips, https://github.com/libvips/libvips

This project's own code links to `sharp` only at the Node module boundary,
which is dynamic (`require('sharp')`); it does not statically link or bundle
libvips into this project's source. sharp's own prebuilt binaries may link
libvips internally as part of sharp's distribution — that arrangement is
governed by sharp's own LGPL compliance and does not affect this project's
code. libvips is kept as an ordinary, separable npm dependency, so that a
user may substitute their own (modified) build, which supports the LGPL
relinking requirement.

### exifreader

**License**: MPL-2.0
**Source**: https://github.com/mattiasw/ExifReader

Used as an unmodified npm dependency. MPL-2.0 is file-scoped copyleft: its
obligations apply only to modifications of ExifReader's own files, which this
project does not make.
