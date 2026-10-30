# WebM uploads

POST /api/tracks accepts MP3, WAV and WebM within MAX_UPLOAD_MB (default 50 MiB).
Install FFmpeg, including ffprobe, on the backend server before using WebM:

```sh
# macOS
brew install ffmpeg
# Debian/Ubuntu
sudo apt-get install ffmpeg
ffprobe -version
```

The backend verifies the EBML WebM DocType and probes the actual streams with a
15-second timeout, bounded output and pipe-only protocols. At least one Opus or
Vorbis audio stream is required. Video-only, malformed or spoofed WebM is rejected
with 415; a missing probe executable returns 503. An optional video track is
preserved in the original file and served as video/webm; audio-only uses audio/webm.

Original bytes are stored without transcoding. audioHash is SHA-256 of those exact
bytes; playback, download and IPFS upload retain the same original. The AI HTTP
adapter sends a filename with the actual audio extension, rather than the private
storage .audio extension. The existing FastAPI accepts WebM, hashes original bytes
and uses its FFmpeg/fingerprint decoding pipeline to extract audio for analysis.
No converted-file hash replaces the original identity. AI model end-to-end
inference still needs the actual configured model/corpus environment.

GET /api/tracks/{id}/audio supports byte ranges and ?download=true for WebM as for
MP3/WAV. Existing authentication/visibility rules are unchanged. Browser codec
support can vary; accepting a file does not guarantee every browser can play it.
