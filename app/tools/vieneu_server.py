# -*- coding: utf-8 -*-
"""Máy chủ giọng đọc VieNeu-TTS cho Chùa Live (chạy trên máy của bạn, không cần Internet sau khi tải model).
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


def load():
    global ENGINE, ERR, VOICES
    try:
        from vieneu import Vieneu
        try:
            ENGINE = Vieneu(backend="onnx")  # chạy CPU, không cần card đồ hoạ
        except Exception:
            ENGINE = Vieneu()
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
