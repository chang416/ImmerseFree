# Third-party notices

ImmerseFree distributes the following third-party components:

- Mozilla PDF.js (`pdfjs-dist`) — Apache License 2.0. The full license is included as `PDFJS_LICENSE.txt` in each browser extension build.
- Phosphor Icons (`@phosphor-icons/web`) — MIT License. The full license is included as `PHOSPHOR_LICENSE.txt` in each browser extension build.
- Node.js runtime — distributed under the Node.js license. Each platform package includes `Runtime/NODE_LICENSE.txt` and a pinned source/version record in `Runtime/NODE_VERSION.txt`.

The source repository's dependency manifests remain the authoritative list of development dependencies.

## EPUB support (W3-4)

- fflate — MIT License. Vendored as `vendor/fflate/fflate.js` in each browser
  extension build; the full license is included as `FFLATE_LICENSE.txt`
  alongside the other third-party license files.
- yihong0618/bilingual_book_maker (commit
  `d21f0f6a2d8e2f91a536aed14df95abfed6db48b`) — MIT License. The bilingual
  EPUB sibling-insertion behavior in `core/epub-core.js` is ported from
  `book_maker/loader/epub_loader.py:1073-1136` of that project. Full license
  text:

```
MIT License

Copyright (c) 2023 yihong

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
```
