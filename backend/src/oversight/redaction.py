"""Run-scoped credential masking; discovered values stay only in memory."""

import re
from threading import RLock

FRAGMENT = 8  # a run of this many characters of the key is as good as the key
REDACTED = "[redacted]"
# What looks like a credential whoever it belongs to: a bearer token, an sk-style key, or a long
# run of letters and digits mixed (hyphens and underscores split words, so slugs and field names
# are left alone). Hex-only object ids/content hashes are exempt from this heuristic, never
# from the explicitly known secret windows.
KEY_LIKE = re.compile(
    r"Bearer\s+[A-Za-z0-9._~+/=-]{6,}"
    r"|\b(?:sk|pk|rk)[-_][A-Za-z0-9_-]{8,}"
    r"|\b(?![a-f0-9]+\b)(?=[A-Za-z0-9]*\d)(?=[A-Za-z0-9]*[A-Za-z])[A-Za-z0-9]{24,}\b",
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
        for text in (key, *other_keys):
            if text:
                self.remember(text)

    def withhold(self) -> None:
        """An incomplete inventory must never let repository text through later in this run."""
        with self._lock:
            self._withheld = True

    def remember(self, text: str) -> None:
        """Retain matching windows, never persist or report the discovered value."""
        width = min(FRAGMENT, len(text))
        if not width:
            return
        with self._lock:
            self._windows.setdefault(width, set()).update(
                text[i : i + width] for i in range(len(text) - width + 1)
            )

    def remember_file(self, name: str, content: str) -> None:
        """Literal dotenv assignments, or key/PEM body lines and their joined body.

        Quoted single-line values and export assignments are supported. No interpolation,
        escape decoding or encoded variants are inferred.
        """
        if name.rsplit("/", 1)[-1].casefold().startswith(".env"):
            values: list[str] = []
            for line in content.splitlines():
                match = re.fullmatch(r"\s*(?:export\s+)?[\w]+\s*=\s*(.*?)\s*", line)
                if match is None:
                    continue
                value = match[1]
                if value.startswith(("'", '"')):
                    value = value[1:].split(value[0], 1)[0]
                else:
                    value = re.split(r"\s+#", value, maxsplit=1)[0].rstrip()
                values.append(value)
        else:
            values = [
                line.strip()
                for line in content.splitlines()
                if line.strip() and not line.strip().startswith(("-----BEGIN ", "-----END "))
            ]
            values.append("".join(values))
        for value in values:
            if len(value) >= FRAGMENT:
                self.remember(value)

    def __call__(self, text: str) -> str:
        with self._lock:
            if self._withheld:
                return REDACTED if text else text
            return REDACTED.join(self._mask(piece) for piece in text.split(REDACTED))

    def _mask(self, text: str) -> str:
        spans: list[list[int]] = []
        for start in range(len(text)):
            width = max(
                (w for w, windows in self._windows.items() if text[start : start + w] in windows),
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
        return KEY_LIKE.sub(REDACTED, "".join(pieces))
