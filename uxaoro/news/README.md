# Uxaoro News Configuration (`https://fourtexec.site/uxaoro/news/`)

Upload the files in this folder (`config.json`, `news.md`, `popup-welcome.html`, `article-beta.html`, and any additional `.html` or `.md` files) to:

```
https://fourtexec.site/uxaoro/news/
```

## 1. `config.json` Structure

```json
{
  "base_url": "https://fourtexec.site/uxaoro/news/",
  "md_file": "news.md",
  "popups": [
    {
      "id": "uxaoro-beta-0.1.0-popup",
      "type": "popup",
      "title": "Welcome to Uxaoro v0.1.0 Beta",
      "html": "popup-welcome.html",
      "appear_on_enter": true,
      "closable": false,
      "fullscreen": false,
      "allow_fullscreen": true,
      "once": true,
      "platforms": ["android", "desktop", "web"],
      "versions": ["0.1.0"]
    }
  ],
  "tab": [
    {
      "id": "uxaoro-beta-launch-html",
      "type": "tab",
      "title": "Uxaoro v0.1.0 Beta — Official Launch Overview",
      "date": "2026-10-01",
      "badge": "Featured HTML",
      "summary": "Interactive HTML overview of Uxaoro v0.1.0 Beta.",
      "html": "article-beta.html",
      "platforms": ["android", "desktop", "web"],
      "versions": ["0.1.0", "*"]
    }
  ]
}
```

### Filtering by Platform & Version
- `platforms`: Array of `"android"`, `"desktop"`, `"web"` (or `"all"` / `"*"`). If omitted, shown on all platforms.
- `versions`: Array of version strings such as `["0.1.0"]` or `["0.1.0", "0.1.1"]` (leading `v` is ignored so `"0.1.0"` and `"v0.1.0"` both match), or `"*"` / `"all"` for all versions.

### Popup News Options (`popups`)
- `appear_on_enter` (boolean, default `true`): Show automatically when the user enters the app.
- `closable` (boolean, default `false`):
  - When `false`, the host close (`×`) button and backdrop click are disabled — the popup **closes only when the HTML page itself requests close**.
  - When `true`, the user can also close it via the header `×` button.
- `fullscreen` (boolean, default `false`): Start the popup in full-screen mode immediately.
- `allow_fullscreen` (boolean, default `true`): Allow toggling full-screen mode.
- `once` (boolean, default `true`): Remember once closed so it only appears once per `id` (set `false` to show on every app launch).

### HTML Page JS Bridge (inside popup HTML)
Inside your popup `.html` file, you can close the popup or toggle full-screen at any time:
```js
// Close the popup:
if (window.UxaoroNews && window.UxaoroNews.close) window.UxaoroNews.close();
window.parent.postMessage({ type: "uxaoro-news-close" }, "*");
// Or navigate to: uxaoro://news/close

// Toggle or set full-screen:
if (window.UxaoroNews && window.UxaoroNews.fullscreen) window.UxaoroNews.fullscreen(true);
window.parent.postMessage({ type: "uxaoro-news-fullscreen", value: true }, "*");
// Or navigate to: uxaoro://news/fullscreen
```

### Tab News (`tab` + `news.md`)
- Tab news items come from both the `tab` array in `config.json` AND the Markdown file `news.md` (sections separated by `---`).
- Any tab item with `"html": "some-page.html"` renders that HTML page inside the News tab (with an option to open it full-screen).
- Any tab item with `"markdown": "..."` or `"md": "some-file.md"` renders formatted Markdown inside the News tab.
