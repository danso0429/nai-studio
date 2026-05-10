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
