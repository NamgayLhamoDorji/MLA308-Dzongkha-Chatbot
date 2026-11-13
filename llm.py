"""Local LLM through Ollama's HTTP API (http://localhost:11434)."""
import os
import requests

MODEL = os.environ.get("DZO_MODEL", "qwen2.5:3b-instruct")
SYSTEM = ("You are a careful assistant. Follow each request exactly, including the length, "
          "format and number of paragraphs it asks for. When given a text, use only the facts in that text.")


def ask(prompt: str, system: str = SYSTEM, history=None, model: str = MODEL) -> str:
    """history: list of {"role": "user"|"assistant", "content": str}"""
    messages = [{"role": "system", "content": system}] + (history or []) + [{"role": "user", "content": prompt}]
    r = requests.post(
        "http://localhost:11434/api/chat",
        json={"model": model, "stream": False, "messages": messages,
              "options": {"temperature": float(os.environ.get("DZO_TEMP", "0.2")), "seed": 7, "num_ctx": 4096}},
        timeout=900,
    )
    r.raise_for_status()
    return r.json()["message"]["content"].strip()