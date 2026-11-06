# -*- coding: utf-8 -*-
"""Máy chủ giọng đọc VieNeu-TTS cho app LIVE (chạy trên máy của bạn, không cần Internet sau khi tải model).
Cài:  python -m pip install vieneu
Chạy: python vieneu_server.py 8765
API:  GET  /health            -> {"ok":true,"voices":[...]}
      POST /tts {text, voice, ref_audio, denoise} -> audio/wav
      POST /add_voice {name, path} -> lưu giọng nhân bản
"""
import io, json, os, sys, tempfile, threading, traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
LOCK = threading.Lock()
ENGINE = None
ERR = None
VOICES = []


def hf_cache_dirs():
    out = []
    for env in ("HF_HUB_CACHE", "HUGGINGFACE_HUB_CACHE"):
        if os.environ.get(env):
            out.append(os.environ[env])
    home = os.environ.get("HF_HOME") or os.path.join(os.path.expanduser("~"), ".cache", "huggingface")
    out.append(os.path.join(home, "hub"))
    return [d for d in dict.fromkeys(out) if os.path.isdir(d)]


def unlink_snapshots():
    """onnxruntime mới chặn file .data nằm ngoài thư mục model. Kho Hugging Face trên Windows dùng
    liên kết (symlink) trỏ vào thư mục blobs nên model và file .data bị tách ra 2 nơi -> lỗi
    'External data path escapes model directory'. Thay các liên kết bằng bản sao thật nằm cùng thư mục."""
    import shutil
    n = 0
    for hub in hf_cache_dirs():
        for name in os.listdir(hub):
            if not name.startswith("models--"):
                continue
            snap = os.path.join(hub, name, "snapshots")
            for root, _dirs, files in os.walk(snap):
                for f in files:
                    if not f.lower().endswith((".onnx", ".data", ".onnx_data", ".bin")):
                        continue
                    fp = os.path.join(root, f)
                    real = os.path.realpath(fp)
                    if os.path.islink(fp) or os.path.normcase(real) != os.path.normcase(os.path.abspath(fp)):
                        try:
                            tmp = fp + ".copy"
                            shutil.copyfile(real, tmp)
                            os.remove(fp)
                            os.replace(tmp, fp)
                            n += 1
                        except Exception as e:
                            print("Không sao chép được %s: %s" % (fp, e), flush=True)
    print("Đã thay %d liên kết trong kho model bằng bản sao thật" % n, flush=True)
    return n


def make_engine():
    from vieneu import Vieneu
    try:
        return Vieneu(backend="onnx")  # chạy CPU, không cần card đồ hoạ
    except Exception as e:
        if "External data" in str(e) or "escapes model directory" in str(e):
            raise
        return Vieneu()


def load():
    global ENGINE, ERR, VOICES
    os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")
    try:
        try:
            ENGINE = make_engine()
        except Exception as e:
            if "External data" not in str(e) and "escapes model directory" not in str(e):
                raise
            print("Gặp lỗi đường dẫn model của onnxruntime — đang sửa kho model...", flush=True)
            unlink_snapshots()
            try:
                ENGINE = make_engine()
            except Exception as e2:
                if "External data" not in str(e2) and "escapes model directory" not in str(e2):
                    raise
                print("Vẫn lỗi — cài onnxruntime bản 1.22 (tương thích) rồi thử lại...", flush=True)
                import subprocess
                subprocess.call([sys.executable, "-m", "pip", "install", "onnxruntime==1.22.1"])
                print("Đã cài xong onnxruntime 1.22 — hãy bấm Dừng rồi Khởi động lại VieNeu.", flush=True)
                raise
        try:
            VOICES = [{"label": str(l), "id": str(i)} for l, i in ENGINE.list_preset_voices()]
        except Exception:
            VOICES = []
        print("VieNeu sẵn sàng, %d giọng" % len(VOICES), flush=True)
    except Exception as e:
        ERR = "%s: %s" % (type(e).__name__, e)
        traceback.print_exc()


def synth(text, voice=None, ref_audio=None, denoise=True):
    kw = {}
    if ref_audio and os.path.exists(ref_audio):
        kw["ref_audio"] = ref_audio
        kw["denoise"] = bool(denoise)
    elif voice:
        v = voice
        # chấp nhận cả tên hiển thị lẫn id
        for it in VOICES:
            if voice in (it["label"], it["id"]):
                v = it["id"]
                break
        try:
            kw["voice"] = ENGINE.get_preset_voice(v)
        except Exception:
            kw["voice"] = voice
    with LOCK:
        audio = ENGINE.infer(text, **kw)
        fd, path = tempfile.mkstemp(suffix=".wav")
        os.close(fd)
        try:
            ENGINE.save(audio, path)
            with open(path, "rb") as f:
                return f.read()
        finally:
            try:
                os.remove(path)
            except Exception:
                pass


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _json(self, code, obj):
        b = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def do_GET(self):
        if self.path.startswith("/health"):
            return self._json(200, {"ok": ENGINE is not None, "loading": ENGINE is None and ERR is None, "error": ERR, "voices": VOICES, "python": sys.executable})
        self._json(404, {"error": "not found"})

    def do_POST(self):
        try:
            n = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(n) or b"{}")
        except Exception:
            return self._json(400, {"error": "bad json"})
        if ENGINE is None:
            return self._json(503, {"error": ERR or "đang tải model"})
        try:
            if self.path.startswith("/tts"):
                text = (body.get("text") or "").strip()
                if not text:
                    return self._json(400, {"error": "empty text"})
                wav = synth(text, body.get("voice"), body.get("ref_audio"), body.get("denoise", True))
                self.send_response(200)
                self.send_header("Content-Type", "audio/wav")
                self.send_header("Content-Length", str(len(wav)))
                self.end_headers()
                self.wfile.write(wav)
                return
            if self.path.startswith("/add_voice"):
                with LOCK:
                    ENGINE.add_voice(body["name"], body["path"])
                    ENGINE.save_voices()
                    try:
                        VOICES[:] = [{"label": str(l), "id": str(i)} for l, i in ENGINE.list_preset_voices()]
                    except Exception:
                        pass
                return self._json(200, {"ok": True, "voices": VOICES})
            self._json(404, {"error": "not found"})
        except Exception as e:
            traceback.print_exc()
            self._json(500, {"error": "%s: %s" % (type(e).__name__, e)})


if __name__ == "__main__":
    threading.Thread(target=load, daemon=True).start()
    print("VieNeu server http://127.0.0.1:%d" % PORT, flush=True)
    ThreadingHTTPServer(("127.0.0.1", PORT), H).serve_forever()
