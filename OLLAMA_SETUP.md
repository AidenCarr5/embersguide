# Ember Badge Studio Local AI Setup

This app uses Ollama for free local AI chat. Ollama runs on the user's own computer, so there is no per-message OpenAI API cost.

## Install Ollama

Windows:

```powershell
irm https://ollama.com/install.ps1 | iex
```

macOS:

Download Ollama from:

```text
https://ollama.com/download
```

Linux:

```bash
curl -fsSL https://ollama.com/install.sh | sh
```

## Download The Default Model

```bash
ollama pull gemma3:1b
```

## Start Ember Badge Studio

```bash
node server.js
```

Then open:

```text
http://127.0.0.1:8765/
```

## Optional Model Choice

To use a different local model:

Windows PowerShell:

```powershell
$env:OLLAMA_MODEL="gemma3:4b"
node server.js
```

macOS/Linux:

```bash
OLLAMA_MODEL="gemma3:4b" node server.js
```

The app falls back to the built-in badge matcher if Ollama is not installed, not running, or the model has not been downloaded yet.
