# AI Companion

Desktop AI companion for Windows: an image (PNG/JPG/GIF) lives on top of the desktop, a global hotkey opens a chat with an LLM, and responses are streamed and optionally spoken aloud

## Build

| Command | Description |
| --- | --- |
| npm install | Install dependencies |
| npx tauri icon app-icon.png | Required before the first build, generates src-tauri/icons/* |
| npm run tauri dev | Run in development mode |
| npm run tauri build | Build NSIS/MSI installer |

## Storage

| Path (%APPDATA%/com.aicompanion.desktop/) | Description |
| --- | --- |
| settings.json | LLM connection, TTS, system prompt, hotkey, and image filenames (API keys encrypted with Windows DPAPI) |
| images/ | Imported copies of companion images |
| memory.json | Sliding window of the last 15 chat messages, plus long-term facts extracted from conversations |

## License

[MIT](LICENSE)
