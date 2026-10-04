# Immagine del computer di bordo per LiveKit Cloud (lk agent deploy)
FROM ghcr.io/astral-sh/uv:python3.13-bookworm-slim
ENV PYTHONUNBUFFERED=1 UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --locked --no-dev --no-install-project
COPY . .
# i modelli dei plugin si scaricano nel build, non a ogni avvio
RUN uv run --no-sync agent.py download-files
CMD ["uv", "run", "--no-sync", "agent.py", "start"]
