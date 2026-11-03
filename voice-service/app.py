"""
Layanan suara (voice service) untuk aplikasi Ijazah Bersuara.

Tugas:
  * menormalkan rekaman apa pun (webm/opus, wav, mp3, ...) menjadi PCM 8 kHz mono
  * mengodekan suara dengan Codec 2 (c2enc) dan mendekodenya kembali (c2dec)
  * menghitung embedding penutur (WeSpeaker ResNet34, 256 dimensi) untuk pencocokan suara

Embedding SELALU dihitung dari audio hasil round-trip Codec 2, baik untuk rekaman
yang disimpan di basis data maupun untuk suara yang dibaca dari QR. Dengan begitu
keduanya dibandingkan dalam kondisi yang sama (pada pengujian, ini menaikkan skor
penutur yang sama dari rata-rata 0,79 menjadi 0,87 tanpa menaikkan skor penutur lain).
"""
import base64
import io
import os
import subprocess
import tempfile

import numpy as np
import sherpa_onnx
import soundfile as sf
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from scipy.signal import butter, sosfilt

SR = 8000
MAX_SECONDS = float(os.environ.get("MAX_SECONDS", "4.0"))
MODEL_PATH = os.environ.get("SPEAKER_MODEL", "/models/wespeaker_en_voxceleb_resnet34_LM.onnx")
VALID_MODES = {"3200", "2400", "1600", "1400", "1300", "1200"}

app = FastAPI(title="Voice service - Ijazah Bersuara")
_extractor = None
_hpf = butter(2, 80, "hp", fs=SR, output="sos")


def extractor():
    global _extractor
    if _extractor is None:
        cfg = sherpa_onnx.SpeakerEmbeddingExtractorConfig(model=MODEL_PATH, num_threads=2)
        _extractor = sherpa_onnx.SpeakerEmbeddingExtractor(cfg)
    return _extractor


def to_pcm8k(data: bytes) -> np.ndarray:
    """Dekode berkas audio apa pun dengan ffmpeg menjadi float32 8 kHz mono."""
    with tempfile.NamedTemporaryFile(suffix=".in", delete=False) as f:
        f.write(data)
        src = f.name
    try:
        out = subprocess.run(
            ["ffmpeg", "-hide_banner", "-loglevel", "error", "-i", src,
             "-ac", "1", "-ar", str(SR), "-f", "s16le", "-"],
            check=True, capture_output=True).stdout
    except subprocess.CalledProcessError as e:
        raise HTTPException(400, f"Audio tidak dapat dibaca: {e.stderr.decode(errors='ignore')[:200]}")
    finally:
        os.unlink(src)
    x = np.frombuffer(out, dtype="<i2").astype(np.float32) / 32768.0
    if x.size < SR // 2:
        raise HTTPException(400, "Rekaman terlalu pendek (kurang dari 0,5 detik).")
    return x[: int(MAX_SECONDS * SR)]


def precondition(x: np.ndarray) -> np.ndarray:
    """High-pass 80 Hz + normalisasi puncak ke -1 dBFS sebelum Codec 2."""
    y = sosfilt(_hpf, x).astype(np.float32)
    peak = float(np.max(np.abs(y))) or 1.0
    return y * (0.89 / peak)


def c2_run(args, data: bytes) -> bytes:
    with tempfile.TemporaryDirectory() as d:
        i, o = os.path.join(d, "in"), os.path.join(d, "out")
        with open(i, "wb") as f:
            f.write(data)
        subprocess.run(args + [i, o], check=True, capture_output=True)
        with open(o, "rb") as f:
            return f.read()


def codec2_encode(x: np.ndarray, mode: str) -> bytes:
    pcm = (np.clip(x, -1, 1) * 32767).astype("<i2").tobytes()
    return c2_run(["c2enc", mode], pcm)


def codec2_decode(bits: bytes, mode: str) -> np.ndarray:
    raw = c2_run(["c2dec", mode], bits)
    return np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768.0


def embed(x: np.ndarray) -> list:
    ex = extractor()
    s = ex.create_stream()
    s.accept_waveform(SR, x.astype(np.float32))
    s.input_finished()
    e = np.array(ex.compute(s), dtype=np.float64)
    return (e / (np.linalg.norm(e) or 1.0)).round(6).tolist()


def wav_b64(x: np.ndarray) -> str:
    buf = io.BytesIO()
    sf.write(buf, np.clip(x, -1, 1), SR, format="WAV", subtype="PCM_16")
    return base64.b64encode(buf.getvalue()).decode()


def check_mode(mode: str) -> str:
    if mode not in VALID_MODES:
        raise HTTPException(400, f"Mode Codec 2 tidak didukung: {mode}")
    return mode


@app.get("/health")
def health():
    return {"ok": True, "model": os.path.basename(MODEL_PATH), "dim": extractor().dim}


@app.post("/process")
async def process(file: UploadFile = File(...), mode: str = Form("3200")):
    """Rekaman mentah -> (asli 8 kHz, bit Codec 2, hasil dekode, embedding)."""
    check_mode(mode)
    x = to_pcm8k(await file.read())
    pre = precondition(x)
    bits = codec2_encode(pre, mode)
    dec = codec2_decode(bits, mode)
    return {
        "mode": mode,
        "duration_s": round(x.size / SR, 3),
        "codec_b64": base64.b64encode(bits).decode(),
        "codec_bytes": len(bits),
        "original_wav_b64": wav_b64(x),
        "decoded_wav_b64": wav_b64(dec),
        "embedding": embed(dec),
    }


class DecodeReq(BaseModel):
    codec_b64: str
    mode: str = "3200"


@app.post("/decode")
def decode(req: DecodeReq):
    """Bit Codec 2 dari QR -> audio hasil sintesis + embedding."""
    check_mode(req.mode)
    bits = base64.b64decode(req.codec_b64)
    dec = codec2_decode(bits, req.mode)
    return {"duration_s": round(dec.size / SR, 3), "decoded_wav_b64": wav_b64(dec), "embedding": embed(dec)}
