-- Skema basis data Ijazah Bersuara
CREATE EXTENSION IF NOT EXISTS vector;

-- Pemilik suara: pejabat penanda tangan (Rektor, Dekan, ...) atau orang lain yang suaranya direkam
CREATE TABLE IF NOT EXISTS speakers (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  role        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Setiap rekaman suara. embedding dihitung dari audio hasil round-trip Codec 2
CREATE TABLE IF NOT EXISTS voice_recordings (
  id             SERIAL PRIMARY KEY,
  speaker_id     INT NOT NULL REFERENCES speakers(id) ON DELETE CASCADE,
  purpose        TEXT NOT NULL CHECK (purpose IN ('enrollment', 'issuance')),
  upload_mime    TEXT,
  upload_bytes   BYTEA,          -- berkas asli dari peramban (mis. webm/opus)
  original_wav   BYTEA NOT NULL, -- PCM 8 kHz mono
  codec_mode     TEXT NOT NULL,
  codec_bits     BYTEA NOT NULL, -- bitstream Codec 2 (yang disematkan ke QR)
  decoded_wav    BYTEA NOT NULL, -- hasil dekode Codec 2
  duration_s     REAL NOT NULL,
  embedding      vector(256) NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS voice_recordings_embedding_idx
  ON voice_recordings USING hnsw (embedding vector_cosine_ops);

-- Kunci penerbit Ed25519 (kunci privat disimpan di berkas, bukan di basis data)
CREATE TABLE IF NOT EXISTS issuer_keys (
  key_id      BYTEA PRIMARY KEY,  -- 4 byte awal SHA-256(kunci publik mentah)
  public_key  BYTEA NOT NULL,     -- 32 byte kunci publik mentah
  active      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS diplomas (
  id                 SERIAL PRIMARY KEY,
  nomor_ijazah       TEXT NOT NULL UNIQUE,
  nama               TEXT NOT NULL,
  nim                TEXT NOT NULL,
  tempat_lahir       TEXT NOT NULL,
  tanggal_lahir      DATE NOT NULL,
  program_studi      TEXT NOT NULL,
  fakultas           TEXT NOT NULL,
  gelar              TEXT NOT NULL,
  tanggal_lulus      DATE NOT NULL,
  signer_speaker_id  INT NOT NULL REFERENCES speakers(id),
  recording_id       INT NOT NULL REFERENCES voice_recordings(id),
  canonical_json     TEXT NOT NULL,   -- data yang di-hash (urutan kunci tetap)
  doc_hash           BYTEA NOT NULL,  -- SHA-256(canonical_json)
  key_id             BYTEA NOT NULL REFERENCES issuer_keys(key_id),
  payload            BYTEA NOT NULL,  -- isi biner kode QR (sudah ditandatangani)
  qr_version         INT NOT NULL,
  revoked            BOOLEAN NOT NULL DEFAULT false,
  issued_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Jejak audit setiap verifikasi
CREATE TABLE IF NOT EXISTS verifications (
  id           SERIAL PRIMARY KEY,
  diploma_id   INT REFERENCES diplomas(id),
  valid        BOOLEAN NOT NULL,
  result       JSONB NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
