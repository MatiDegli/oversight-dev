"""Run-scoped credential masking; discovered values stay only in memory."""

import re
from threading import RLock

FRAGMENT = 8  # a run of this many characters of the key is as good as the key
REDACTED = "[redacted]"
# What looks like a credential whoever it belongs to: a bearer token, an sk-style key, or a long
# run of letters and digits mixed (hyphens and underscores split words, so slugs and field names
# are left alone). Only repository diagnostics exempt hexadecimal object ids/content hashes.
KEY_LIKE = re.compile(
    r"Bearer\s+[A-Za-z0-9._~+/=-]{6,}"
    r"|\b(?:sk|pk|rk)[-_][A-Za-z0-9_-]{8,}"
    r"|\b(?=[A-Za-z0-9]*\d)(?=[A-Za-z0-9]*[A-Za-z])[A-Za-z0-9]{24,}\b",
    re.IGNORECASE,
)


class Redactor:
    """Mask credentials before model requests, event publication and probe reports.

    It removes the key, every run of FRAGMENT or more characters that appears in the key (so a
    reflected piece of it goes too, not only the whole), and anything shaped like a credential.
    Calling it on its own output changes nothing.
    """

    def __init__(self, key: str | None, *other_keys: str | None) -> None:
        self._lock = RLock()
        self._withheld = False
        self._windows: dict[int, set[str]] = {}
        self._values: set[str] = set()
        for text in (key, *other_keys):
            if text:
                self.remember(text)

    def withhold(self) -> None:
        """An incomplete inventory must never let repository text through later in this run."""
        with self._lock:
            self._withheld = True

    def remember(self, text: str, *, fragments: bool = True) -> None:
        """Retain matching windows, never persist or report the discovered value."""
        width = min(FRAGMENT, len(text))
        if not width:
            return
        with self._lock:
            if not fragments:
                self._values.add(text)
                return
            self._windows.setdefault(width, set()).update(
                text[i : i + width] for i in range(len(text) - width + 1)
            )

    def remember_file(self, name: str, content: str) -> None:
        """Literal dotenv assignments, or key/PEM body lines and their joined body.

        Quoted single-line values and export assignments are supported. No interpolation,
        escape decoding or encoded variants are inferred.
        """
        dotenv = any(part.casefold().startswith(".env") for part in name.split("/"))
        pem = "-----BEGIN " in content
        body: list[str] = []
        for line in content.splitlines():
            line = line.strip()
            if not line or line.startswith(("#", "-----BEGIN ", "-----END ")):
                continue
            match = None if pem else re.fullmatch(r"(?:export\s+)?[\w]+\s*=\s*(.*?)\s*", line)
            if match is not None:
                value = match[1]
                if value.startswith(("'", '"')):
                    value = value[1:].split(value[0], 1)[0]
                else:
                    value = re.split(r"\s+#", value, maxsplit=1)[0].rstrip()
                if len(value) >= FRAGMENT:
                    self.remember(value, fragments=KEY_LIKE.search(value) is not None)
            elif pem or not dotenv:
                body.append(line)
        for value in [*body, "".join(body)]:
            if len(value) >= FRAGMENT:
                self.remember(value)

    def __call__(self, text: str, *, preserve_hex: bool = False) -> str:
        with self._lock:
            if self._withheld:
                return REDACTED if text else text
            return REDACTED.join(self._mask(piece, preserve_hex) for piece in text.split(REDACTED))

    def _mask(self, text: str, preserve_hex: bool) -> str:
        spans: list[list[int]] = []
        for start in range(len(text)):
            width = max(
                (
                    *(
                        w
                        for w, windows in self._windows.items()
                        if text[start : start + w] in windows
                    ),
                    *(len(value) for value in self._values if text.startswith(value, start)),
                ),
                default=0,
            )
            if width:
                if spans and start <= spans[-1][1]:
                    spans[-1][1] = max(spans[-1][1], start + width)
                else:
                    spans.append([start, start + width])
        pieces: list[str] = []
        done = 0
        for begin, end in spans:
            pieces += [text[done:begin], REDACTED]
            done = end
        pieces.append(text[done:])
        return KEY_LIKE.sub(
            lambda match: (
                match[0]
                if preserve_hex and re.fullmatch(r"[a-f0-9]+", match[0], re.IGNORECASE)
                else REDACTED
            ),
            "".join(pieces),
        )
