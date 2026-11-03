# Ubuntu 24.04: sama dengan lingkungan pengujian (codec2 1.2, ffmpeg 6.1)
FROM ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 python3-venv codec2 ffmpeg libsndfile1 curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN python3 -m venv /venv
ENV PATH="/venv/bin:$PATH"
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
# Model embedding penutur WeSpeaker ResNet34 (VoxCeleb, ~26 MB) dari rilis sherpa-onnx
RUN mkdir -p /models && curl -fsSL -o /models/wespeaker_en_voxceleb_resnet34_LM.onnx \
    https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/wespeaker_en_voxceleb_resnet34_LM.onnx
COPY app.py .
ENV SPEAKER_MODEL=/models/wespeaker_en_voxceleb_resnet34_LM.onnx
EXPOSE 8001
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=10 CMD curl -fs http://127.0.0.1:8001/health || exit 1
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8001"]
