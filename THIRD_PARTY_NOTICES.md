# Third-party notices

ImmerseFree distributes the following third-party components:

- Mozilla PDF.js (`pdfjs-dist`) — Apache License 2.0. The full license is included as `PDFJS_LICENSE.txt` in each browser extension build.
- Phosphor Icons (`@phosphor-icons/web`) — MIT License. The full license is included as `PHOSPHOR_LICENSE.txt` in each browser extension build.
- fflate — MIT License. Vendored as `vendor/fflate/fflate.js` in each browser extension build and used to read and write EPUB archives; the full license is included as `FFLATE_LICENSE.txt`.
- yihong0618/bilingual_book_maker (commit `d21f0f6a2d8e2f91a536aed14df95abfed6db48b`) — MIT License. The bilingual EPUB sibling-insertion behavior in `Extension/core/epub-core.js` is ported from `book_maker/loader/epub_loader.py` of that project. The full license text is reproduced in [`Extension/THIRD_PARTY_NOTICES.md`](Extension/THIRD_PARTY_NOTICES.md).
- Node.js runtime — distributed under the Node.js license. Each platform package includes `Runtime/NODE_LICENSE.txt` and a pinned source/version record in `Runtime/NODE_VERSION.txt`.

The source repository's dependency manifests remain the authoritative list of development dependencies. [`Extension/THIRD_PARTY_NOTICES.md`](Extension/THIRD_PARTY_NOTICES.md) ships inside every extension build and carries the same list plus the full reproduced license texts.
