# Dzongkha Assistant

A chat app: accounts, saved history, file upload (PDF/TXT), summaries and Q&A.
Input in Dzongkha or English. Every answer is in Dzongkha.

## Run (Windows PowerShell, inside this folder)
    venv\Scripts\activate
    pip install -r requirements.txt
    ollama pull qwen2.5:3b-instruct      (once; Ollama must be running)
    python -m pytest -q                  (optional: 16 tests, no internet needed)
    python server.py

Open http://127.0.0.1:8000, choose "Create account", then chat.
You can delete the old app.py. It is replaced by server.py and static/index.html.

## AI Models and Requirements

This project uses the following models:

1. Qwen 2.5 3B Instruct
   - Conversational response generation.
   - Runs locally through Ollama.

2. BAAI BGE Small English v1.5
   - Text embedding generation.
   - Used for semantic document retrieval.

3. Kinley Rabgay's Dzongkha Models
   - Used for Dzongkha language processing.
   - Requires the corresponding model files and dependencies.

Note:
Model weights are not included in this repository.
Download and configure the required models before running the application.

## Files
- server.py: accounts, chat history, uploads, background jobs
- pipeline.py: translate -> LLM -> translate, summaries, search in the document
- text_utils.py: Dzongkha detection, shad/tsheg handling, PDF line repair
- translate.py: Google translation backend + cache. To use DzoNext for Dz->En, change
  the first argument of Translator(...) in build_engine() in server.py.
- llm.py: Ollama. Change the model with the DZO_MODEL environment variable.
- static: the whole front end

## Data
dzo_chat.db holds users (passwords are hashed), chats, messages and documents.
translations.db caches translations. Delete either file to start fresh.